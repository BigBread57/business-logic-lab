import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { enumeratePaths, minimizeSequence, searchRun } from '../.agents/skills/business-logic-qa/scripts/search.mjs';
import { initRun, approveKnowledge, reportRun } from '../.agents/skills/business-logic-qa/scripts/qa.mjs';

const model = { initial: 'empty', states: ['empty', 'ready', 'published'], transitions: [
  { id: 'create', from: 'empty', to: 'ready' }, { id: 'read', from: 'ready', to: 'ready' },
  { id: 'publish', from: 'ready', to: 'published' }, { id: 'unpublish', from: 'published', to: 'ready' },
] };
test('state search enumerates bounded legal paths with explicit coverage and truncation', () => {
  const result = enumeratePaths(model, { max_depth: 3, max_paths: 6 });
  assert.deepEqual(result.paths[0], ['create']); assert.equal(result.paths.length, 6);
  assert.ok(result.paths.some(p => p.join() === 'create,publish,unpublish'));
  assert.equal(result.truncated, true); assert.deepEqual(new Set(result.transitions), new Set(['create', 'read', 'publish', 'unpublish']));
  assert.throws(() => enumeratePaths({ ...model, transitions: [{ id: 'bad', from: 'missing', to: 'empty' }] }), /state/);
  assert.throws(() => enumeratePaths(model, { max_depth: 10000 }), /bound/);
});

test('shrinking preserves the failure signature, rejects inconclusive candidates and saves trials', async () => {
  const trials = [];
  const result = await minimizeSequence(['noise', 'create', 'blocked', 'publish', 'tail'], async candidate => {
    if (candidate.length === 5) return { outcome: 'violation', signature: 'duplicate' };
    if (candidate.includes('blocked')) return { outcome: 'inconclusive' };
    return candidate.includes('create') && candidate.includes('publish') ? { outcome: 'violation', signature: 'duplicate' } : { outcome: 'violation', signature: 'different-error' };
  }, { signature: 'duplicate', onTrial: trial => trials.push(trial), max_trials: 30 });
  assert.deepEqual(result.sequence, ['create', 'publish']); assert.ok(trials.some(t => t.outcome === 'inconclusive'));
  assert.ok(result.trials <= 30); assert.ok(trials.every(t => Array.isArray(t.sequence)));
  await assert.rejects(minimizeSequence(['x'], async () => ({ outcome: 'pass' }), { signature: 'duplicate', max_trials: 2 }), /reproduce/);
});

test('HTTP state search resets before each trial and reduces a retained defect into a replay', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-search-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let state = 'empty'; let count = 0; let resets = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/reset') { state = 'empty'; count = 0; resets++; }
    if (req.url === '/create') state = 'ready';
    if (req.url === '/publish') { state = 'published'; count = 2; }
    res.end(JSON.stringify({ state, count }));
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://localhost:${server.address().port}`;
  const profile = { project: 'search', environment: 'local', targets: { api: origin }, allowed_origins: [origin], actors: { a: {} }, permissions: ['read', 'mutate', 'reset'], budget_seconds: 120, limits: { request_timeout_ms: 5000, max_requests: 200, max_parallel: 1 } };
  const write = (file, value) => fs.writeFile(path.join(root, file), JSON.stringify(value));
  await write('profile.json', profile);
  await write('knowledge.json', { project: 'search', sources: [{ id: 'human' }], rules: [{ id: 'R1', statement: 'At most one publication', sources: ['human'], status: 'approved' }] });
  await approveKnowledge(path.join(root, 'knowledge.json'), path.join(root, 'approval.json'), 'fixture');
  const dir = path.join(root, 'run'); await initRun({ config: path.join(root, 'profile.json'), knowledge: path.join(root, 'knowledge.json'), approval: path.join(root, 'approval.json'), out: dir });
  const step = endpoint => ({ target: 'api', actor: 'a', path: endpoint });
  const spec = { ...model, transitions: model.transitions.map(tr => ({ ...tr, steps: [{ ...step('/' + tr.id), method: tr.id === 'read' ? 'GET' : 'POST' }] })), reset: { id: 'baseline', rules: ['R1'], steps: [{ ...step('/reset'), method: 'POST', assert: [{ rule: 'R1', path: '$.count', op: 'eq', value: 0 }] }] }, probe: { id: 'check', rules: ['R1'], steps: [{ ...step('/'), assert: [{ rule: 'R1', path: '$.count', op: 'lte', value: 1 }] }] } };
  const result = await searchRun(dir, spec, { max_depth: 3, max_paths: 6, shrink_trials: 20, out: path.join(dir, 'search') });
  assert.ok(result.findings.length > 0); assert.deepEqual(result.findings[0].sequence, ['create', 'publish']);
  assert.ok(resets >= result.trials.length); assert.equal(result.stopped, false);
  const replay = JSON.parse(await fs.readFile(path.join(dir, 'search', result.findings[0].replay), 'utf8'));
  assert.ok(replay.steps.some(s => s.path === '/reset')); assert.ok(replay.steps.some(s => s.path === '/publish'));
  assert.ok((await reportRun(dir)).operations > 10);
});
