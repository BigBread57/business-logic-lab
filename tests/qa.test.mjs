import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { approveKnowledge, initRun, executeScenario, loadScenario, journal, confirmFinding, reportRun, generateRegression, verifyRegression, validateProfile } from '../.agents/skills/business-logic-qa/scripts/qa.mjs';

const exec = promisify(execFile);
const save = async (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2));
const load = async p => JSON.parse(await fs.readFile(p, 'utf8'));
async function setup(t, handler, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'business-qa-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = http.createServer(handler ?? ((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ count: 1 })); }));
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://localhost:${server.address().port}`;
  const profile = { project: 'test', environment: 'local', targets: { api: origin }, allowed_origins: [origin], actors: { a: {}, b: {} }, permissions: ['read', 'mutate', 'load'], budget_seconds: 20, limits: { request_timeout_ms: 1000, max_requests: 50, max_parallel: 4, load_iterations: 5 }, ...overrides };
  const knowledge = { project: 'test', sources: [{ id: 'business', path: 'process', revision: '1', kind: 'business' }], rules: [{ id: 'R1', statement: 'Count does not exceed one', sources: ['business'], status: 'approved' }, { id: 'R2', statement: 'Second rule not yet exercised', sources: ['business'], status: 'approved' }], gaps: [{ id: 'G1', statement: 'Retry semantics unknown' }] };
  const config = path.join(root, 'profile.json');
  const bundle = path.join(root, 'knowledge.json'); const approval = path.join(root, 'approval.json'); const dir = path.join(root, 'run');
  await save(config, profile); await save(bundle, knowledge); await approveKnowledge(bundle, approval, 'test fixture author');
  await initRun({ config, knowledge: bundle, approval, out: dir });
  const scenario = { id: 'check', rules: ['R1'], steps: [{ target: 'api', actor: 'a', path: '/', assert: [{ rule: 'R1', path: '$.count', op: 'lte', value: 1 }] }] };
  return { root, config, bundle, approval, dir, profile, knowledge, scenario, origin };
}

test('observes actual HTTP behavior, approved-rule coverage and persistent gaps', async t => {
  const f = await setup(t);
  const result = await executeScenario(f.dir, f.scenario);
  assert.equal(result.outcome, 'pass'); assert.equal(result.evidence[0].body.count, 1);
  const report = await reportRun(f.dir);
  assert.equal(report.coverage[0].untested, false); assert.equal(report.coverage[1].untested, true);
  assert.equal(report.gaps[0].id, 'G1'); assert.match(await fs.readFile(path.join(f.dir, 'report.md'), 'utf8'), /R2.*not-run/);
});

test('stale approval and existing run cannot reset the deadline', async t => {
  const f = await setup(t);
  const before = (await load(path.join(f.dir, 'run.json'))).deadline;
  await assert.rejects(initRun({ config: f.config, knowledge: f.bundle, approval: f.approval, out: f.dir }), /EEXIST/);
  assert.equal((await load(path.join(f.dir, 'run.json'))).deadline, before);
  await fs.appendFile(f.bundle, ' ');
  await assert.rejects(initRun({ config: f.config, knowledge: f.bundle, approval: f.approval, out: path.join(f.root, 'new') }), /stale/);
});

test('unknown/unapproved rules and assertion-free scenarios are rejected before requests', async t => {
  const f = await setup(t);
  await assert.rejects(executeScenario(f.dir, { ...f.scenario, rules: ['unknown'] }), /unapproved/);
  const scenario = structuredClone(f.scenario); delete scenario.steps[0].assert;
  await assert.rejects(executeScenario(f.dir, scenario), /assertion/);
  assert.equal((await load(path.join(f.dir, 'meter.json'))).requests, 0);
});

test('dev mutation prohibition is checked before any step is sent', async t => {
  let calls = 0;
  const f = await setup(t, (_req, res) => { calls++; res.end('{}'); }, { environment: 'dev', permissions: ['read'] });
  const scenario = structuredClone(f.scenario); scenario.steps.push({ target: 'api', actor: 'a', path: '/', method: 'POST' });
  await assert.rejects(executeScenario(f.dir, scenario), /forbids mutate/); assert.equal(calls, 0);
});

test('target escapes and redirects do not reach an unapproved host', async t => {
  const f = await setup(t, (_req, res) => { res.writeHead(302, { Location: 'http://outside.invalid/' }); res.end(); });
  const escaped = structuredClone(f.scenario); escaped.steps[0].path = 'http://outside.invalid/';
  assert.equal((await executeScenario(f.dir, escaped, 'escaped')).outcome, 'blocked');
  assert.equal((await load(path.join(f.dir, 'meter.json'))).requests, 0);
  const redirected = await executeScenario(f.dir, f.scenario, 'redirect');
  assert.equal(redirected.outcome, 'blocked'); assert.match(redirected.error, /Redirect refused/);
});

test('independent actors overlap on one shared business resource', async t => {
  let active = 0; let peak = 0; const auth = [];
  let release; const barrier = new Promise(resolve => { release = resolve; });
  process.env.QA_ACTOR_A = 'Bearer synthetic-a'; process.env.QA_ACTOR_B = 'Bearer synthetic-b';
  t.after(() => { delete process.env.QA_ACTOR_A; delete process.env.QA_ACTOR_B; });
  const f = await setup(t, async (req, res) => {
    auth.push(req.headers.authorization); active++; peak = Math.max(peak, active);
    if (active === 2) release();
    await barrier; active--; res.end('{"count":1}');
  }, { limits: { request_timeout_ms: 5000, max_requests: 50, max_parallel: 4, load_iterations: 5 }, actors: { a: { headers_env: { Authorization: 'QA_ACTOR_A' } }, b: { headers_env: { Authorization: 'QA_ACTOR_B' } } } });
  const check = f.scenario.steps[0];
  const scenario = { ...f.scenario, steps: [{ parallel: [{ ...check, actor: 'a' }, { ...check, actor: 'b' }] }] };
  const result = await executeScenario(f.dir, scenario);
  assert.equal(result.outcome, 'pass'); assert.equal(peak, 2); assert.equal(new Set(auth).size, 2);
  const stored = JSON.stringify(result); assert.ok(!stored.includes('synthetic-a') && !stored.includes('synthetic-b'));
});

test('bounded polling observes eventual state without repeating writes', async t => {
  let calls = 0;
  const f = await setup(t, (_req, res) => res.end(JSON.stringify({ count: ++calls < 3 ? 2 : 1 })));
  f.scenario.steps[0].within_ms = 500; f.scenario.steps[0].poll_ms = 5;
  const result = await executeScenario(f.dir, f.scenario);
  assert.equal(result.outcome, 'pass'); assert.equal(calls, 3); assert.equal(result.evidence.length, 3);
});

test('eventual mismatch becomes a violation after its observation window', async t => {
  const f = await setup(t, (_req, res) => res.end('{"count":2}'));
  // One completed observation followed by the agreed window; no near-deadline network race.
  f.scenario.steps[0].within_ms = 250; f.scenario.steps[0].poll_ms = 250;
  const result = await executeScenario(f.dir, f.scenario);
  assert.equal(result.outcome, 'violation'); assert.ok(result.assertions.some(a => !a.passed));
});

test('captures correlate IDs across service targets', async t => {
  const paths = [];
  const f = await setup(t, (req, res) => { paths.push(req.url); res.end(req.url === '/create' ? '{"id":"uuid-123"}' : '{"count":1}'); });
  f.scenario.steps.unshift({ target: 'api', actor: 'a', method: 'POST', path: '/create', capture: { dialog_id: '$.id' } });
  f.scenario.steps[1].path = '/dialogs/${dialog_id}';
  assert.equal((await executeScenario(f.dir, f.scenario)).outcome, 'pass'); assert.deepEqual(paths, ['/create', '/dialogs/uuid-123']);
});

test('an exploration window without an approved SLA is inconclusive, not a defect', async t => {
  const f = await setup(t, (_req, res) => res.end('{"count":2}'));
  Object.assign(f.scenario.steps[0], { within_ms: 250, poll_ms: 250, expiry_outcome: 'inconclusive' });
  const result = await executeScenario(f.dir, f.scenario);
  assert.equal(result.outcome, 'inconclusive'); assert.match(result.error, /without an approved SLA/);
  assert.equal((await reportRun(f.dir)).coverage[0].untested, false);
});

test('parallel transport failure does not erase an independently observed business violation', async t => {
  const f = await setup(t, (req, res) => { if (req.url === '/broken') res.end('{"count":2}'); }, { limits: { request_timeout_ms: 100, max_requests: 10, max_parallel: 2, load_iterations: 2 } });
  const check = f.scenario.steps[0];
  const result = await executeScenario(f.dir, { ...f.scenario, steps: [{ parallel: [{ ...check, path: '/broken' }, { ...check, path: '/timeout', actor: 'b' }] }] });
  assert.equal(result.outcome, 'violation'); assert.ok(result.assertions.some(a => !a.passed));
  assert.equal(result.branch_errors.length, 1);
  assert.equal((await reportRun(f.dir)).coverage[0].untested, false);
  assert.equal((await confirmFinding(f.dir, 'check', 'Completed independent count observation violates capacity despite sibling timeout')).confirmed, true);
});

test('poll delay releases the global slot so another worker can advance business state', async t => {
  let count = 2; let firstRead;
  const observed = new Promise(resolve => { firstRead = resolve; });
  const f = await setup(t, (req, res) => { if (req.method === 'POST') count = 1; res.end(JSON.stringify({ count })); if (req.method === 'GET') firstRead(); }, { limits: { request_timeout_ms: 500, max_requests: 20, max_parallel: 1, load_iterations: 2 } });
  const observer = structuredClone(f.scenario); Object.assign(observer.steps[0], { within_ms: 1000, poll_ms: 100 });
  const pending = executeScenario(f.dir, observer, 'observer');
  await observed;
  const writer = structuredClone(f.scenario); writer.steps[0].method = 'POST';
  const writeResult = await executeScenario(f.dir, writer, 'writer');
  assert.equal(writeResult.outcome, 'pass'); assert.equal((await pending).outcome, 'pass');
});

test('redirect response streams are cancelled instead of kept open after refusal', async t => {
  let closed;
  const close = new Promise(resolve => { closed = resolve; });
  const f = await setup(t, (_req, res) => {
    res.on('close', closed); res.writeHead(302, { Location: 'http://outside.invalid/' }); res.write('redirect stream');
  });
  const result = await executeScenario(f.dir, f.scenario);
  assert.equal(result.outcome, 'blocked');
  await Promise.race([close, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Redirect stream was not cancelled')), 500); timer.unref(); })]);
  assert.deepEqual((await load(path.join(f.dir, 'meter.json'))).active, []);
});

test('uncertain mutation claims are visible and cannot be silently replayed', async t => {
  let calls = 0; const f = await setup(t, (_req, res) => { calls++; res.end('{"count":1}'); });
  await fs.mkdir(path.join(f.dir, 'claims', 'check'));
  await assert.rejects(executeScenario(f.dir, f.scenario), /EEXIST/);
  assert.equal(calls, 0); assert.deepEqual((await reportRun(f.dir)).uncertain, ['check']);
});

test('request cap is shared across concurrent workers and prevents excess requests', async t => {
  let calls = 0; const f = await setup(t, (_req, res) => { calls++; res.end('{"count":1}'); }, { limits: { request_timeout_ms: 1000, max_requests: 2, max_parallel: 4, load_iterations: 5 } });
  const results = await Promise.all([0, 1, 2, 3].map(i => executeScenario(f.dir, f.scenario, `worker-${i}`)));
  assert.equal(calls, 2); assert.equal(results.filter(r => r.outcome === 'blocked').length, 2);
  assert.equal((await load(path.join(f.dir, 'meter.json'))).requests, 2);
});

test('global in-flight cap applies across separate experiment invocations', async t => {
  let active = 0; let peak = 0;
  const f = await setup(t, async (_req, res) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 20)); active--; res.end('{"count":1}'); }, { limits: { request_timeout_ms: 1000, max_requests: 10, max_parallel: 1, load_iterations: 5 } });
  const results = await Promise.all([0, 1, 2].map(i => executeScenario(f.dir, f.scenario, `worker-${i}`)));
  assert.ok(results.every(r => r.outcome === 'pass')); assert.equal(peak, 1);
});

test('load observes both iteration and combined parallelism caps', async t => {
  const f = await setup(t);
  await assert.rejects(loadScenario(f.dir, f.scenario, { iterations: 6, concurrency: 1 }), /bounds/);
  const result = await loadScenario(f.dir, f.scenario, { iterations: 3, concurrency: 2 });
  assert.equal(result.executed, 3); assert.ok(result.results.every(r => r.outcome === 'pass'));
  const nested = { ...f.scenario, steps: [{ parallel: [f.scenario.steps[0], f.scenario.steps[0], f.scenario.steps[0]] }] };
  await assert.rejects(loadScenario(f.dir, nested, { iterations: 1, concurrency: 2 }), /Combined/);
});

test('expired run blocks sending and never silently renews budget', async t => {
  const f = await setup(t); const manifest = await load(path.join(f.dir, 'run.json'));
  manifest.deadline = Date.now() - 1; await save(path.join(f.dir, 'run.json'), manifest);
  await assert.rejects(executeScenario(f.dir, f.scenario), /deadline/);
  assert.equal((await reportRun(f.dir)).expired, true);
});

test('network timeout is blocked rather than a business violation', async t => {
  const f = await setup(t, (_req, _res) => {}, { limits: { request_timeout_ms: 30, max_requests: 10, max_parallel: 1, load_iterations: 1 } });
  const result = await executeScenario(f.dir, f.scenario); assert.equal(result.outcome, 'blocked');
  assert.deepEqual((await load(path.join(f.dir, 'meter.json'))).active, []);
});

test('blocked attempts do not count as observed rule coverage', async t => {
  const f = await setup(t, undefined, { actors: { a: { headers_env: { Authorization: 'QA_MISSING_CREDENTIAL' } } } });
  assert.equal((await executeScenario(f.dir, f.scenario)).outcome, 'blocked');
  const coverage = (await reportRun(f.dir)).coverage[0];
  assert.equal(coverage.attempted, true); assert.equal(coverage.untested, true);
});

test('journaling cannot take ownership of an active HTTP experiment', async t => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.dir, 'evidence.txt'), 'synthetic evidence');
  await fs.mkdir(path.join(f.dir, 'claims', 'active'));
  await assert.rejects(journal(f.dir, { id: 'active', rules: ['R1'], outcome: 'blocked', summary: 'Do not overwrite active work', attachments: ['evidence.txt'] }), /EEXIST/);
  assert.deepEqual((await reportRun(f.dir)).uncertain, ['active']);
});

test('streamed UTF-8 business values remain intact across chunk boundaries', async t => {
  const text = Buffer.from('{"name":"Привет"}');
  const split = text.indexOf(Buffer.from('П')) + 1;
  const f = await setup(t, (_req, res) => {
    res.write(text.subarray(0, split));
    setTimeout(() => res.end(text.subarray(split)), 10);
  });
  f.scenario.steps[0].assert = [{ rule: 'R1', path: '$.name', op: 'eq', value: 'Привет' }];
  assert.equal((await executeScenario(f.dir, f.scenario)).outcome, 'pass');
});

test('evidence redacts sensitive fields and configured credentials', async t => {
  process.env.QA_PRIVATE = 'private-credential-value'; t.after(() => delete process.env.QA_PRIVATE);
  const f = await setup(t, (_req, res) => res.end('{"count":1,"token":"from-response","echo":"private-credential-value"}'), { actors: { a: { headers_env: { Authorization: 'QA_PRIVATE' } } } });
  const result = await executeScenario(f.dir, f.scenario);
  assert.equal(result.evidence[0].body.token, '[REDACTED]'); assert.equal(result.evidence[0].body.echo, '[REDACTED]');
});

test('external evidence paths cannot escape the run through traversal or symlinks', async t => {
  const f = await setup(t);
  const record = { id: 'external', rules: ['R1'], outcome: 'violation', summary: 'Browser observed duplicate state', attachments: ['../profile.json'], checks: [{ rule: 'R1', expected: 1, actual: 2, passed: false }] };
  await assert.rejects(journal(f.dir, record), /escaped/);
  await fs.symlink(f.config, path.join(f.dir, 'linked.json'));
  await assert.rejects(journal(f.dir, { ...record, attachments: ['linked.json'] }), /escaped/);
  await fs.writeFile(path.join(f.dir, 'observation.txt'), 'synthetic evidence');
  await journal(f.dir, { ...record, attachments: ['observation.txt'] });
  const confirmed = await confirmFinding(f.dir, 'external', 'Captured browser state establishes duplicate business effect');
  assert.equal(confirmed.confirmed, true);
  await assert.rejects(generateRegression(f.dir, 'external', path.join(f.root, 'external.test.mjs')), /native UI\/broker/);
});

test('generated portable regression fails on a retained defect and passes after behavior is fixed', async t => {
  let count = 2;
  const f = await setup(t, (_req, res) => res.end(JSON.stringify({ count })));
  assert.equal((await executeScenario(f.dir, f.scenario)).outcome, 'violation');
  await assert.rejects(generateRegression(f.dir, 'check', path.join(f.root, 'unconfirmed.test.mjs')), /confirmed/);
  await confirmFinding(f.dir, 'check', 'Observed count 2 contradicts approved R1 on isolated fixture');
  const generated = path.join(f.root, 'regression.test.mjs');
  await generateRegression(f.dir, 'check', generated);
  await fs.rm(f.dir, { recursive: true }); // regression no longer depends on original run
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  await assert.rejects(exec(process.execPath, ['--test', generated], { env }), error => {
    assert.match(error.stdout, /Expected approved business behavior/); return true;
  });
  count = 1;
  const output = await exec(process.execPath, ['--test', generated], { env }); assert.match(output.stdout, /pass 1/);
});

test('redacted scenarios cannot produce silently altered regressions', async t => {
  const f = await setup(t, (_req, res) => res.end('{"count":2}'));
  f.scenario.variables = { password: 'literal-unsafe-value' };
  await executeScenario(f.dir, f.scenario);
  await confirmFinding(f.dir, 'check', 'Evidence proves count exceeds the approved business bound');
  await assert.rejects(generateRegression(f.dir, 'check', path.join(f.root, 'altered.test.mjs')), /redacted/);
});

test('regression verification records failure and uses the original run request budget', async t => {
  const f = await setup(t, (_req, res) => res.end('{"count":2}'));
  await executeScenario(f.dir, f.scenario);
  await confirmFinding(f.dir, 'check', 'Count 2 is observed against the approved capacity bound');
  await generateRegression(f.dir, 'check', path.join(f.root, 'verified.test.mjs'));
  const verification = await verifyRegression(f.dir, 'check');
  assert.equal(verification.status, 'failed');
  assert.match(await fs.readFile(path.join(f.dir, verification.evidence), 'utf8'), /Expected approved business behavior/);
  assert.equal((await load(path.join(f.dir, 'meter.json'))).requests, 2);
});

test('profile rejects credentials in target URLs and unknown environment/permissions', async t => {
  const f = await setup(t);
  assert.throws(() => validateProfile({ ...f.profile, environment: 'production' }), /local and dev/);
  assert.throws(() => validateProfile({ ...f.profile, targets: { api: 'http://name:pass@localhost' } }), /credentials/);
  assert.throws(() => validateProfile({ ...f.profile, permissions: ['all'] }), /permissions/);
});
