import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as qa from '../.agents/skills/business-logic-qa/scripts/qa.mjs';
import { createAdapter, encodeEnvelope, decodeEnvelope, saveEvidence, createChain, resumeChain } from '../.agents/skills/business-logic-qa/scripts/adapters.mjs';

async function fixture(t, timeout = 1000) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-adapters-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, 'profile.json'), run = path.join(root, 'run');
  await fs.writeFile(config, JSON.stringify({ project: 'adapter', environment: 'local', targets: { api: 'http://localhost:9999' }, allowed_origins: ['http://localhost:9999'], actors: { a: {} }, permissions: ['read', 'mutate', 'fault'], budget_seconds: 60, limits: { request_timeout_ms: timeout, max_requests: 30, max_parallel: 3 }, adapters: { native: { transport: 'native', resources: ['test'], permissions: ['read', 'mutate', 'fault'] } } }));
  await qa.initRun({ config, out: run, mode: 'observation' });
  return run;
}
const options = (run, client) => ({ run, actor: 'a', adapter: 'native', resource: 'test', client });

test('binary envelope preserves nulls, exact bytes and duplicate ordered headers', async t => {
  const run = await fixture(t);
  const message = { key: Buffer.from([0, 255]), value: Buffer.from([128, 0]), headers: [['x', Buffer.from([255])], ['x', Buffer.from([0, 42])], ['empty', null]], partition: 1, offset: '9007199254740993' };
  const encoded = encodeEnvelope(message);
  assert.deepEqual(decodeEnvelope(encoded), message);
  const a = await saveEvidence(run, 'envelope', encoded), b = await saveEvidence(run, 'envelope', encoded);
  assert.notEqual(a, b);
  assert.deepEqual(decodeEnvelope(JSON.parse(await fs.readFile(path.join(run, a)))), message);
});

test('injected clients are admitted per operation and receive abort signal and deadline', async t => {
  const run = await fixture(t), calls = [];
  const invoke = name => async (input, context) => { calls.push([name, input, context]); return { name }; };
  const api = createAdapter(options(run, Object.fromEntries(['publish', 'read', 'offsets', 'query', 'documentRead', 'search', 'metadata', 'injectFault', 'recoverFault'].map(n => [n, invoke(n)]))));
  for (const name of ['publish', 'read', 'offsets', 'query', 'documentRead', 'search', 'metadata', 'injectFault', 'recoverFault']) await api[name]({ item: name, duration_ms: 50 });
  assert.equal((await qa.reportRun(run)).operations, 9);
  for (const [, , context] of calls) { assert.ok(context.signal instanceof AbortSignal); assert.ok(context.deadline > Date.now()); }
});

test('bounded fault recovery is separately admitted even when body fails', async t => {
  const run = await fixture(t), calls = [];
  const api = createAdapter(options(run, { injectFault: async input => { calls.push('inject'); return input; }, recoverFault: async () => { calls.push('recover'); } }));
  await assert.rejects(api.injectFault({ duration_ms: 60001 }), /duration/);
  await assert.rejects(api.withFault({ duration_ms: 25 }, async () => { throw new Error('body failed'); }), /body failed/);
  assert.deepEqual(calls, ['inject', 'recover']);
  assert.equal((await qa.reportRun(run)).operations, 2);
});

test('timeout remains uncertain and abort reaches client', async t => {
  const run = await fixture(t, 80); let aborted = false;
  const api = createAdapter(options(run, { publish: async (_input, { signal }) => new Promise(() => signal.addEventListener('abort', () => { aborted = true; })) }));
  await assert.rejects(api.publish({}), /timeout/i);
  assert.equal(aborted, true);
  assert.equal((await qa.reportRun(run)).uncertain_actions.length, 1);
});

test('chain stores append-only observations with correlations and unfinished stages', async t => {
  const run = await fixture(t);
  const chain = createChain(run, { correlation: { request: 'r1' }, stages: ['sent', 'indexed', 'visible', 'audit'] });
  await chain.observe('sent', { state: 'present', provenance: 'producer offset 12' });
  await chain.observe('indexed', { state: 'absent', provenance: 'search response' });
  await chain.observe('visible', { state: 'not_observable', provenance: 'no access' });
  const receipt = await chain.observe('audit', { state: 'window_elapsed', provenance: 'poll timed out', window_ms: 500 });
  assert.deepEqual(receipt.stages.map(x => x.state), ['present', 'absent', 'not_observable', 'window_elapsed']);
  assert.deepEqual(receipt.incomplete, ['indexed', 'visible', 'audit']);
  assert.deepEqual(receipt.correlation, { request: 'r1' });
  const files = await fs.readdir(path.join(run, 'evidence', 'adapters'));
  assert.equal(files.length, 4);
  await assert.rejects(chain.observe('wrong', { state: 'present', provenance: 'x' }), /stage/);
});

test('real local HTTP-backed injected query honors admission', async t => {
  const run = await fixture(t);
  const server = http.createServer((_req, res) => res.end('{"rows":[1]}'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const api = createAdapter(options(run, { query: async (_input, { signal }) => (await fetch(`http://127.0.0.1:${server.address().port}`, { signal })).json() }));
  assert.deepEqual(await api.query({}), { rows: [1] });
  assert.equal((await qa.reportRun(run)).operations, 1);
});

test('fault permission is required independently from mutation permission', async t => {
  const run = await fixture(t);
  const file = path.join(run, 'run.json'), manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.profile.permissions = ['read', 'mutate']; manifest.profile.adapters.native.permissions = ['read', 'mutate'];
  await fs.writeFile(file, JSON.stringify(manifest));
  const api = createAdapter(options(run, { injectFault: async () => { throw Error('must not be called'); } }));
  await assert.rejects(api.injectFault({ duration_ms: 100 }), /permission/i);
});

test('chain checkpoints resume exact correlation and pending stages after restart', async t => {
  const run = await fixture(t);
  const original = createChain(run, { correlation: { object: 'synthetic-42' }, stages: ['request', 'storage', 'view'] });
  const first = await original.checkpoint();
  assert.deepEqual(first.incomplete, ['request', 'storage', 'view']);
  const one = await original.observe('request', { state: 'present', provenance: 'Admitted request receipt' });
  const continued = await resumeChain(run, one.evidence);
  const two = await continued.observe('storage', { state: 'present', provenance: 'Independent stored-object read' });
  assert.equal(two.id, one.id);
  assert.deepEqual(two.correlation, one.correlation);
  assert.deepEqual(two.incomplete, ['view']);
  await assert.rejects(resumeChain(run, '../profile.json'), /escaped/);
});

test('native-only profiles execute without invented HTTP endpoints', async t => {
  const parent = await fixture(t); const config = path.join(path.dirname(parent), 'native-profile.json'), run = path.join(path.dirname(parent), 'native-run');
  const profile = { project: 'native', environment: 'local', actors: { a: {} }, permissions: ['read'], limits: { request_timeout_ms: 1000, max_requests: 2, max_parallel: 1 }, adapters: { native: { transport: 'native', resources: ['test'], permissions: ['read'] } } };
  await fs.writeFile(config, JSON.stringify(profile));
  await qa.initRun({ config, out: run, mode: 'observation' });
  const api = createAdapter(options(run, { read: async () => ({ visible: true }) }));
  assert.deepEqual(await api.read({}), { visible: true });
  assert.equal((await qa.reportRun(run)).operations, 1);
  assert.throws(() => qa.validateProfile({ ...profile, adapters: {} }), /targets or native/);
});
