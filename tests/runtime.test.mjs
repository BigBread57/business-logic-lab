import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as qa from '../.agents/skills/business-logic-qa/scripts/qa.mjs';

const save = (p, value) => fs.writeFile(p, JSON.stringify(value));
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
async function fixture(t, handler, overrides = {}, mode = 'observation') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = http.createServer(handler ?? ((_req, res) => res.end('{"accepted":true}')));
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://localhost:${server.address().port}`;
  const profile = { project: 'runtime', environment: 'local', targets: { api: origin }, allowed_origins: [origin], actors: { a: {}, b: {} }, permissions: ['read', 'mutate'], budget_seconds: 120, limits: { request_timeout_ms: 5000, max_requests: 30, max_parallel: 2 }, ...overrides };
  const config = path.join(root, 'profile.json'); const dir = path.join(root, 'run');
  await save(config, profile);
  const knowledge = path.join(root, 'knowledge.json'); const approval = path.join(root, 'approval.json');
  await save(knowledge, { project: 'runtime', sources: [{ id: 'human' }], rules: [{ id: 'R1', statement: 'Accepted is false', status: 'approved', sources: ['human'] }] });
  await qa.approveKnowledge(knowledge, approval, 'fixture author');
  await qa.initRun({ config, out: dir, mode, ...(mode === 'conformance' ? { knowledge, approval } : {}) });
  const scenario = { id: 'observe', mode: 'observation', question: 'How does this endpoint behave?', steps: [{ target: 'api', actor: 'a', path: '/' }] };
  return { root, dir, config, knowledge, approval, profile, scenario };
}

test('observation-only runs execute and journal without inventing business rules', async t => {
  const f = await fixture(t);
  const result = await qa.executeScenario(f.dir, f.scenario);
  assert.equal(result.outcome, 'observed'); assert.deepEqual(result.rules, []);
  assert.equal(result.evidence[0].body.accepted, true);
  await fs.writeFile(path.join(f.dir, 'native.txt'), 'Observed UI state');
  const entry = await qa.journal(f.dir, { id: 'ui', mode: 'observation', outcome: 'observed', question: 'Who sees this?', summary: 'UI showed the object', attachments: ['native.txt'] });
  assert.deepEqual(entry.rules, []);
  const report = await qa.reportRun(f.dir);
  assert.deepEqual(report.coverage, []); assert.equal(report.observations.length, 2);
  await assert.rejects(qa.confirmFinding(f.dir, result.id, 'This has no approved oracle'), /Only observed violations/);
  await assert.rejects(qa.executeScenario(f.dir, { ...f.scenario, id: 'fake', steps: [{ ...f.scenario.steps[0], assert: [{ path: '$status', op: 'eq', value: 200 }] }] }), /Observation.*assertions/);
  await assert.rejects(qa.journal(f.dir, { id: 'fake', mode: 'observation', outcome: 'pass', summary: 'fake', attachments: ['native.txt'] }), /Observation/);
  const run = await read(path.join(f.dir, 'run.json'));
  assert.equal(run.mode, 'observation'); assert.equal(run.approval, null);
});

test('conformance runs accept explicit observations but retain approval and assertion gates', async t => {
  const f = await fixture(t, undefined, {}, 'conformance');
  assert.equal((await qa.executeScenario(f.dir, f.scenario)).outcome, 'observed');
  await assert.rejects(qa.executeScenario(f.dir, { ...f.scenario, id: 'unchecked', mode: 'conformance', rules: ['R1'] }), /assertion/);
  await assert.rejects(qa.executeScenario(f.dir, { ...f.scenario, id: 'unapproved', mode: 'conformance', rules: ['unknown'] }), /unapproved/);
  assert.equal((await qa.reportRun(f.dir)).coverage[0].untested, true);
  await assert.rejects(qa.initRun({ config: f.config, out: path.join(f.root, 'bad'), mode: 'unknown' }), /mode/);
});

const adapters = Object.fromEntries(['browser', 'kafka', 'db'].map(transport => [transport, { transport, resources: [`lab-${transport}`], permissions: ['read', 'mutate'] }]));
const action = (adapter, id) => ({ id, adapter, actor: 'a', resource: `lab-${adapter}`, permission: 'read', operation: 'inspect' });

test('native and HTTP actions share caps across processes and report immutable receipts', async t => {
  const f = await fixture(t, undefined, { adapters, limits: { request_timeout_ms: 1000, max_requests: 3, max_parallel: 2 } });
  const lease = await qa.beginAction(f.dir, action('browser', 'click'));
  const moduleURL = pathToFileURL(path.resolve('.agents/skills/business-logic-qa/scripts/qa.mjs')).href;
  const script = `import {beginAction,completeAction} from ${JSON.stringify(moduleURL)}; const lease = await beginAction(process.argv[1], ${JSON.stringify(action('db', 'query'))}); await completeAction(process.argv[1],lease,{status:'completed',summary:'Read row'});`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, f.dir]);
  await qa.completeAction(f.dir, lease, { status: 'completed', summary: 'UI action finished' });
  assert.equal((await qa.executeScenario(f.dir, f.scenario)).outcome, 'observed');
  await assert.rejects(qa.beginAction(f.dir, action('kafka', 'consume')), /limit/);
  await assert.rejects(qa.completeAction(f.dir, lease, { status: 'completed' }), /already/);
  const report = await qa.reportRun(f.dir);
  assert.equal(report.operations, 3); assert.deepEqual(report.by_transport, { browser: 1, db: 1, http: 1 });
  assert.equal(report.actions.length, 3); assert.deepEqual(report.uncertain_actions, []);
});

test('uncertain adapter leases survive restart and require evidence to reconcile', async t => {
  const f = await fixture(t, undefined, { adapters, limits: { request_timeout_ms: 1000, max_requests: 5, max_parallel: 1 } });
  const lease = await qa.beginAction(f.dir, action('kafka', 'publish'));
  await assert.rejects(qa.beginAction(f.dir, { ...action('db', 'wrong'), resource: 'production' }), /resource/);
  await assert.rejects(qa.completeAction(f.dir, { ...lease, token: 'wrong' }, { status: 'completed' }), /lease/);
  await qa.completeAction(f.dir, lease, { status: 'uncertain', summary: 'Producer disconnected after send' });
  assert.deepEqual((await qa.reportRun(f.dir)).uncertain_actions, ['publish']);
  await assert.rejects(qa.beginAction(f.dir, action('kafka', 'publish')), /already/);
  await assert.rejects(qa.reconcileAction(f.dir, 'publish', { summary: 'Checked correlation' }), /evidence/);
  await fs.writeFile(path.join(f.dir, 'offset.txt'), 'Committed message correlation');
  await qa.reconcileAction(f.dir, 'publish', { summary: 'Read committed message by correlation', attachments: ['offset.txt'] });
  assert.equal((await qa.executeScenario(f.dir, f.scenario)).outcome, 'observed');
  assert.equal((await qa.reportRun(f.dir)).operations, 2);
  assert.deepEqual((await qa.reportRun(f.dir)).uncertain_actions, []);
});

test('adapter SDK shares concurrency, cancels at timeout and retains uncertainty', async t => {
  const f = await fixture(t, undefined, { adapters, limits: { request_timeout_ms: 5000, max_requests: 10, max_parallel: 1 } });
  let active = 0; let peak = 0;
  const run = id => qa.performAction(f.dir, action('db', id), async ({ signal }) => {
    assert.equal(signal.aborted, false); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15)); active--; return { rows: 1 };
  });
  await Promise.all([run('one'), run('two'), run('three')]); assert.equal(peak, 1);
  const hung = await fixture(t, undefined, { adapters, limits: { request_timeout_ms: 100, max_requests: 5, max_parallel: 1 } });
  await assert.rejects(qa.performAction(hung.dir, action('browser', 'hung'), async () => new Promise(() => {})), /timeout|abort/i);
  assert.deepEqual((await qa.reportRun(hung.dir)).uncertain_actions, ['hung']);
  const manifest = await read(path.join(f.dir, 'run.json')); manifest.deadline = Date.now() - 1; await save(path.join(f.dir, 'run.json'), manifest);
  await assert.rejects(qa.beginAction(f.dir, action('db', 'late')), /deadline/);
});

test('multipart and binary uploads preserve exact bytes and portable regression fixtures', async t => {
  const requests = []; let fixed = false;
  const f = await fixture(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ type: req.headers['content-type'], bytes: Buffer.concat(chunks) });
    res.end(JSON.stringify({ accepted: fixed, object_id: 'object-' + requests.length }));
  }, {}, 'conformance');
  const root = path.join(f.root, 'uploads'); await fs.mkdir(root);
  const bytes = Buffer.from([0, 255, 128, 10, 34, 0]); await fs.writeFile(path.join(root, 'data.bin'), bytes);
  const profile = { ...f.profile, upload: { root: './uploads', max_bytes: 1024 } };
  await save(f.config, profile);
  const dir = path.join(f.root, 'upload-run'); await qa.initRun({ config: f.config, knowledge: f.knowledge, approval: f.approval, out: dir });
  const scenario = { id: 'upload', rules: ['R1'], steps: [{ target: 'api', actor: 'a', path: '/create', method: 'POST', capture: { object_id: '$.object_id' } }, { target: 'api', actor: 'a', path: '/', method: 'POST', upload: { type: 'multipart', fields: { label: 'Пример', object_id: '${object_id}' }, files: [{ field: 'document', path: 'data.bin', filename: 'sample.bin', content_type: 'application/octet-stream' }] }, assert: [{ rule: 'R1', path: '$.accepted', op: 'eq', value: true }] }] };
  const result = await qa.executeScenario(dir, scenario);
  assert.equal(result.outcome, 'violation'); assert.match(requests[1].type, /^multipart\/form-data; boundary=/);
  assert.ok(requests[1].bytes.includes(bytes)); assert.ok(requests[1].bytes.includes(Buffer.from('Пример')));
  assert.ok(requests[1].bytes.includes(Buffer.from('object-1')));
  assert.equal(result.evidence[1].uploads[0].bytes, bytes.length);
  await qa.confirmFinding(dir, scenario.id, 'Server rejected a valid uploaded binary fixture');
  await fs.writeFile(path.join(root, 'data.bin'), 'changed');
  await assert.rejects(qa.generateRegression(dir, scenario.id, path.join(f.root, 'changed.test.mjs')), /fixture changed/);
  await fs.writeFile(path.join(root, 'data.bin'), bytes);
  const out = path.join(f.root, 'portable.test.mjs'); await qa.generateRegression(dir, scenario.id, out);
  await fs.rm(root, { recursive: true });
  const verified = await qa.verifyRegression(dir, scenario.id);
  assert.equal(verified.status, 'failed');
  assert.match(await fs.readFile(path.join(dir, verified.evidence), 'utf8'), /Expected approved business behavior/);
  const parentReplay = (await qa.reportRun(dir)).results.find(result => result.id.startsWith('regression-'));
  assert.equal(parentReplay.outcome, 'violation'); assert.equal(parentReplay.evidence[1].body.accepted, false);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const exec = (file, args) => promisify(execFile)(file, args, { env });
  await assert.rejects(exec(process.execPath, ['--test', out]), /Command failed/);
  fixed = true; await exec(process.execPath, ['--test', out]);
  const copied = await read(`${out}.fixtures/scenario.json`);
  copied.steps[1].upload = { type: 'binary', path: copied.steps[1].upload.files[0].path };
  copied.id = 'binary';
  const config = path.join(`${out}.fixtures`, 'profile.json');
  const binaryRun = path.join(f.root, 'binary-run');
  await qa.initRun({ config, knowledge: `${out}.fixtures/knowledge.json`, approval: `${out}.fixtures/approval.json`, out: binaryRun });
  assert.equal((await qa.executeScenario(binaryRun, copied)).outcome, 'pass');
  assert.deepEqual(requests.at(-1).bytes, bytes);
});

test('upload path escape, symlink, hash mismatch and size limits block before transport', async t => {
  let calls = 0;
  const f = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  const root = path.join(f.root, 'files'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'large'), '12345');
  await fs.symlink(f.config, path.join(root, 'escape'));
  await save(f.config, { ...f.profile, upload: { root, max_bytes: 4 } });
  const dir = path.join(f.root, 'guarded'); await qa.initRun({ config: f.config, mode: 'observation', out: dir });
  for (const [id, file, sha256] of [['traversal', '../profile.json'], ['link', 'escape'], ['large', 'large'], ['hash', 'small', '0'.repeat(64)]]) {
    await fs.writeFile(path.join(root, 'small'), 'ok');
    const result = await qa.executeScenario(dir, { ...f.scenario, id, steps: [{ ...f.scenario.steps[0], method: 'POST', upload: { type: 'binary', path: file, ...(sha256 ? { sha256 } : {}) } }] });
    assert.equal(result.outcome, 'blocked', id);
  }
  const fields = await qa.executeScenario(dir, { ...f.scenario, id: 'large-fields', steps: [{ ...f.scenario.steps[0], method: 'POST', upload: { type: 'multipart', fields: { data: 'x'.repeat(100) }, files: [{ field: 'file', path: 'small' }] } }] });
  assert.equal(fields.outcome, 'blocked');
  assert.equal(calls, 0); assert.equal((await qa.reportRun(dir)).operations, 0);
});

