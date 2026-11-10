import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as c from '../.agents/skills/business-logic-qa/scripts/campaign.mjs';
import * as qa from '../.agents/skills/business-logic-qa/scripts/qa.mjs';

const save = (p, v) => fs.writeFile(p, JSON.stringify(v));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-campaign-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'campaign');
  await c.initCampaign(dir, { id: 'product-audit', title: 'Application audit' });
  const config = path.join(root, 'profile.json');
  await save(config, { project: 'sample', environment: 'local', allowed_origins: ['http://localhost:19001'], targets: { api: 'http://localhost:19001' }, actors: { tester: {} }, permissions: ['read'], limits: { request_timeout_ms: 1000, max_requests: 10, max_parallel: 1 }, budget_seconds: 100 });
  const run = path.join(root, 'run');
  await qa.initRun({ config, mode: 'observation', out: run });
  await c.registerRun(dir, { id: 'r1', path: run, versions: { app: 'v1' } });
  await fs.writeFile(path.join(run, 'evidence.txt'), 'Synthetic observation');
  await qa.journal(run, { id: 'result1', mode: 'observation', question: 'What was saved?', outcome: 'observed', summary: 'Object saved', attachments: ['evidence.txt'] });
  return { root, dir, run };
}
const scenario = (id = 'objects.create') => ({ id, title: 'Create an object', components: ['app'], remaining: ['Check persistence'], oracle: { kind: 'unknown', question: 'Which fields are required?' } });
async function executed(f, id = 'e1', extra = {}) {
  await c.beginExecution(f.dir, { id, scenario_id: 'objects.create', run_id: 'r1', novelty: 'First persistence observation' });
  return c.finishExecution(f.dir, id, { results: ['result1'], remaining: [], ...extra });
}

test('campaign keeps stable identities, observations, remaining work and immutable history', async t => {
  const f = await fixture(t);
  await c.addScenario(f.dir, scenario());
  const e = await executed(f, 'e1', { status: 'partial', remaining: ['Read through another session'] });
  assert.equal(e.status, 'partial');
  await c.updateScenario(f.dir, 'objects.create', { title: 'Create and read object' });
  const state = await c.readCampaign(f.dir);
  assert.equal(state.executions.e1.results[0], 'result1');
  assert.deepEqual(state.scenarios['objects.create'].remaining, ['Read through another session']);
  assert.equal(state.scenarios['objects.create'].status, 'partial');
  assert.equal(state.scenarios['objects.create'].oracle.kind, 'unknown');
  await assert.rejects(c.finishExecution(f.dir, 'e1', { results: ['result1'] }), /finished/);
  await assert.rejects(c.addScenario(f.dir, scenario()), /exists/);
  await assert.rejects(c.addScenario(f.dir, scenario('../escape')), /ID/);
  assert.equal(state.events.length, 5);
});

test('concurrent campaign writers retain every scenario and interrupted locks are visible', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => c.addScenario(f.dir, scenario('case.' + i))));
  assert.equal(Object.keys((await c.readCampaign(f.dir)).scenarios).length, 12);
  await fs.mkdir(path.join(f.dir, 'campaign.lock'));
  await assert.rejects(c.addScenario(f.dir, scenario('locked'), { lock_timeout_ms: 30 }), /lock/);
  const report = await c.reportCampaign(f.dir);
  assert.ok(report.issues.some(i => i.kind === 'interrupted_writer'));
  assert.equal(report.reconciled, false);
});

test('report includes all run results, broken attachments, uncertain actions and unfinished executions', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario());
  let report = await c.reportCampaign(f.dir);
  assert.ok(report.issues.some(i => i.kind === 'unassigned_result'));
  assert.equal(report.reconciled, false);
  await executed(f);
  report = await c.reportCampaign(f.dir);
  assert.equal(report.reconciled, true);
  assert.equal(report.scenarios[0].status, 'observed');
  assert.equal(report.source_inventory.some(s => s.path.endsWith('evidence.txt') && s.sha256), true);
  await c.beginExecution(f.dir, { id: 'interrupted', scenario_id: 'objects.create', run_id: 'r1', novelty: 'Additional independent session' });
  await fs.mkdir(path.join(f.run, 'claims', 'interrupted-native'));
  await fs.unlink(path.join(f.run, 'evidence.txt'));
  report = await c.reportCampaign(f.dir);
  for (const kind of ['missing_evidence', 'unfinished_execution', 'uncertain_claim']) assert.ok(report.issues.some(i => i.kind === kind), kind);
  assert.equal(report.reconciled, false);
  assert.match(await fs.readFile(path.join(f.dir, 'report.md'), 'utf8'), /interrupted-native/);
  await assert.rejects(c.reportCampaign(f.dir, { require_reconciled: true }), /reconcil/);
  assert.ok((await fs.stat(path.join(f.dir, 'report.json'))).isFile());
});

test('report detects result changes and refuses pass without conformance evidence', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario());
  await c.beginExecution(f.dir, { id: 'e1', scenario_id: 'objects.create', run_id: 'r1', novelty: 'First observation' });
  await assert.rejects(c.finishExecution(f.dir, 'e1', { results: ['result1'], status: 'passed' }), /pass|observation/i);
  await c.finishExecution(f.dir, 'e1', { results: ['result1'], remaining: [] });
  const file = path.join(f.run, 'results/result1.json'); const result = JSON.parse(await fs.readFile(file, 'utf8'));
  result.summary = 'Changed after execution'; await save(file, result);
  await fs.writeFile(path.join(f.run, 'evidence.txt'), 'Replaced evidence after execution');
  const report = await c.reportCampaign(f.dir);
  assert.ok(report.issues.some(i => i.kind === 'changed_result'));
  assert.ok(report.issues.some(i => i.kind === 'changed_evidence'));
});

test('defect resolution needs a passing linked regression and retains version-specific observations', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario()); await executed(f);
  const defect = { id: 'D-1', title: 'Object disappears', severity: 'high', confidence: 'candidate', basis: { kind: 'technical_invariant', statement: 'Committed data survives a new read', source: 'Storage contract section 2' }, executions: ['e1'], rationale: 'Independent read lost the committed object' };
  await assert.rejects(c.addDefect(f.dir, { ...defect, confidence: 'confirmed' }), /confirmed violation/);
  await c.addDefect(f.dir, defect);
  await assert.rejects(c.updateDefect(f.dir, 'D-1', { status: 'resolved', execution_id: 'e1', rationale: 'Retested' }), /passing/);
  await c.updateDefect(f.dir, 'D-1', { status: 'needs_verification', rationale: 'Implementation changed; verification pending' });
  const state = await c.readCampaign(f.dir);
  assert.equal(state.defects['D-1'].status, 'needs_verification');
  assert.equal(state.defects['D-1'].history.length, 2);
  assert.deepEqual(state.runs.r1.versions, { app: 'v1' });
});

test('plans explain novelty, version impact, blockers and exclusions without repeating completed work', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario()); await executed(f);
  await c.addScenario(f.dir, scenario('objects.delete'));
  await c.addScenario(f.dir, scenario('objects.export'));
  await c.updateScenario(f.dir, 'objects.export', { status: 'excluded', reason: 'User limited scope to persistence', authority: 'User request 2026-11-09' });
  const plan = await c.planCampaign(f.dir);
  assert.deepEqual(plan.queue.map(p => p.scenario_id), ['objects.delete']);
  const impacted = await c.planCampaign(f.dir, { versions: { app: 'v2' } });
  assert.equal(impacted.queue.find(p => p.scenario_id === 'objects.create').reason, 'changed_version');
  assert.equal(impacted.queue.some(p => p.scenario_id === 'objects.export'), false);
  await c.beginExecution(f.dir, { id: 'e2', scenario_id: 'objects.delete', run_id: 'r1', novelty: 'New deletion path' });
  const resumed = await c.resumeCampaign(f.dir);
  assert.ok(resumed.unfinished.some(p => p.id === 'e2'));
  assert.ok(resumed.next.some(p => p.scenario_id === 'objects.delete') === false);
  assert.match(await fs.readFile(path.join(f.dir, 'context.md'), 'utf8'), /Reconcile/);
});

test('workers, unresolved questions and source snapshot metadata survive continuation', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario());
  await c.recordQuestion(f.dir, { id: 'Q1', question: 'Can a deleted object be restored?', scenarios: ['objects.create'] });
  await c.assignWorker(f.dir, { id: 'worker1', scenarios: ['objects.create'], namespace: 'campaign-worker1', deadline: new Date(Date.now() + 60000).toISOString(), result_path: 'worker1.json', charter: 'Observe persistence only' });
  const context = await c.resumeCampaign(f.dir);
  assert.equal(context.questions.length, 1);
  assert.equal(context.workers.length, 1);
  const src = path.join(f.root, 'source'); await fs.mkdir(src); await fs.writeFile(path.join(src, 'package-lock.json'), '{}');
  const captured = await c.snapshotSources([{ id: 'app', path: src, files: ['package-lock.json'] }]);
  assert.equal(captured[0].git.available, false);
  assert.equal(captured[0].files[0].sha256.length, 64);
});

test('registered native artifacts are inventoried with missing and changed files exposed', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario());
  const artifacts = path.join(f.root, 'native'); await fs.mkdir(artifacts);
  await fs.writeFile(path.join(artifacts, 'cases.xml'), '<testsuite/>');
  await save(path.join(artifacts, 'manifest.json'), { cases: [{ name: 'case-a', status: 'skipped', reason: 'No role configured' }], missing: { coverage: true }, command: ['test'], versions: { app: 'v1' } });
  await c.registerArtifact(f.dir, { id: 'suite1', path: artifacts, kind: 'native-tests', scenarios: ['objects.create'], summary: 'Native test cases and collection evidence' });
  let report = await c.reportCampaign(f.dir);
  assert.equal(report.artifacts.length, 1);
  assert.equal(report.native_tests[0].counts.skipped, 1);
  assert.ok(report.source_inventory.some(f => f.path.endsWith('cases.xml')));
  await fs.writeFile(path.join(artifacts, 'extra.txt'), 'Unregistered output');
  report = await c.reportCampaign(f.dir);
  assert.ok(report.issues.some(i => i.kind === 'changed_artifact'));
  await fs.unlink(path.join(artifacts, 'cases.xml'));
  report = await c.reportCampaign(f.dir);
  assert.ok(report.issues.some(i => i.kind === 'missing_artifact_file'));
});

test('interrupted result claims can be reconciled after deadline without deleting history', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.run, 'claims', 'lost'));
  const manifest = JSON.parse(await fs.readFile(path.join(f.run, 'run.json'), 'utf8'));
  manifest.deadline = Date.now() - 1; await save(path.join(f.run, 'run.json'), manifest);
  await qa.reconcileClaim(f.run, 'lost', { summary: 'Read back the target and confirmed the accepted operation', attachments: ['evidence.txt'], result_id: 'result1' });
  const report = await qa.reportRun(f.run);
  assert.deepEqual(report.uncertain, []);
  assert.equal(report.reconciled_claims[0].id, 'lost');
  assert.ok((await fs.stat(path.join(f.run, 'claims', 'lost'))).isDirectory());
  await assert.rejects(qa.reconcileClaim(f.run, 'lost', { summary: 'Repeated reconciliation should be refused', attachments: ['evidence.txt'], result_id: 'result1' }), /already/);
  assert.equal((await c.reportCampaign(f.dir)).issues.some(i => i.kind === 'uncertain_claim'), false);
});

test('remaining obligations survive observations and blocked results cannot become observations', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario());
  await c.beginExecution(f.dir, { id: 'e1', scenario_id: 'objects.create', run_id: 'r1', novelty: 'Observe one step' });
  const e = await c.finishExecution(f.dir, 'e1', { results: ['result1'] });
  assert.deepEqual(e.remaining, ['Check persistence']);
  assert.equal(e.status, 'partial');
  assert.equal((await c.planCampaign(f.dir)).queue[0].reason, 'remaining_obligations');
  await qa.journal(f.run, { id: 'blocked', mode: 'observation', question: 'Can it be read?', outcome: 'blocked', summary: 'Access unavailable', attachments: ['evidence.txt'] });
  await c.beginExecution(f.dir, { id: 'e2', scenario_id: 'objects.create', run_id: 'r1', novelty: 'Try another observation channel' });
  await assert.rejects(c.finishExecution(f.dir, 'e2', { results: ['blocked'], status: 'observed', remaining: [] }), /blocked|inconclusive/);
  await c.finishExecution(f.dir, 'e2', { results: ['blocked'] });
  assert.equal((await c.planCampaign(f.dir)).held[0].scenario_id, 'objects.create');
  await c.updateScenario(f.dir, 'objects.create', { status: 'not_run', reason: 'Access restored; unfinished work authorized' });
  assert.equal((await c.planCampaign(f.dir)).queue[0].reason, 'explicitly_reopened');
});

test('confirmed findings resolve only after independent passing verification of the same approved rule', async t => {
  const f = await fixture(t);
  const config = path.join(f.root, 'profile.json'), knowledge = path.join(f.root, 'knowledge.json'), approval = path.join(f.root, 'approval.json');
  await save(knowledge, { project: 'sample', sources: [{ id: 'contract' }], rules: [{ id: 'R1', status: 'approved', statement: 'Committed object remains readable', sources: ['contract'] }] });
  await qa.approveKnowledge(knowledge, approval, 'Contract owner');
  const second = path.join(f.root, 'conformance'); await qa.initRun({ config, knowledge, approval, out: second });
  await c.registerRun(f.dir, { id: 'r2', path: second, versions: { app: 'v2' } });
  await fs.writeFile(path.join(second, 'read.txt'), 'Independent readback');
  await qa.journal(second, { id: 'bad', rules: ['R1'], outcome: 'violation', summary: 'Object unreadable', attachments: ['read.txt'], checks: [{ rule: 'R1', expected: true, actual: false, passed: false }] });
  await qa.confirmFinding(second, 'bad', 'Independent read contradicts the approved persistence contract');
  await qa.journal(second, { id: 'old-good', rules: ['R1'], outcome: 'pass', summary: 'Passing evidence before finding registration', attachments: ['read.txt'], checks: [{ rule: 'R1', expected: true, actual: true, passed: true }] });
  await c.addScenario(f.dir, { ...scenario(), oracle: { kind: 'approved_rule', rule_id: 'R1', statement: 'Committed object remains readable', source: 'contract' } });
  await c.beginExecution(f.dir, { id: 'bad-e', scenario_id: 'objects.create', run_id: 'r2', novelty: 'First conformance read' });
  await c.finishExecution(f.dir, 'bad-e', { results: ['bad'], remaining: ['Verify correction'] });
  const confirmed = { id: 'D1', title: 'Lost committed object', severity: 'high', confidence: 'confirmed', basis: { kind: 'approved_rule', rule_id: 'R1', statement: 'Committed object remains readable', source: 'contract' }, executions: ['bad-e'], rationale: 'Readback proves violation of R1' };
  await fs.writeFile(path.join(second, 'read.txt'), 'Modified finding evidence');
  await assert.rejects(c.addDefect(f.dir, confirmed), /attachment changed/);
  await fs.writeFile(path.join(second, 'read.txt'), 'Independent readback');
  await c.addDefect(f.dir, confirmed);
  await c.addDefect(f.dir, { id: 'C1', title: 'Candidate read failure', severity: 'medium', confidence: 'candidate', basis: { kind: 'technical_invariant', statement: 'Read storage after commit', source: 'Technical observation' }, executions: ['bad-e'], rationale: 'Pending agreement of the exact rule' });
  await c.updateScenario(f.dir, 'objects.create', { status: 'needs_verification', reason: 'Fix ready' });
  await c.beginExecution(f.dir, { id: 'stale-e', scenario_id: 'objects.create', run_id: 'r2', novelty: 'Try linking an old result as verification' });
  await c.finishExecution(f.dir, 'stale-e', { results: ['old-good'], remaining: [] });
  await assert.rejects(c.updateDefect(f.dir, 'D1', { status: 'resolved', execution_id: 'stale-e', rationale: 'This old result must not close the defect' }), /predates/);
  const changedKnowledge = path.join(f.root, 'changed-knowledge.json'), changedApproval = path.join(f.root, 'changed-approval.json');
  await save(changedKnowledge, { project: 'sample', sources: [{ id: 'contract' }], rules: [{ id: 'R1', status: 'approved', statement: 'A different rule with the same ID', sources: ['contract'] }] });
  await qa.approveKnowledge(changedKnowledge, changedApproval, 'Changed rule owner');
  const wrongRun = path.join(f.root, 'wrong-rule'); await qa.initRun({ config, knowledge: changedKnowledge, approval: changedApproval, out: wrongRun });
  await c.registerRun(f.dir, { id: 'wrong', path: wrongRun, versions: { app: 'v3' } });
  await fs.writeFile(path.join(wrongRun, 'read.txt'), 'Different rule evidence');
  await qa.journal(wrongRun, { id: 'wrong-pass', rules: ['R1'], outcome: 'pass', summary: 'Unrelated check passed', attachments: ['read.txt'], checks: [{ rule: 'R1', expected: true, actual: true, passed: true }] });
  await c.addScenario(f.dir, { ...scenario('objects.changed-rule'), regression_for: 'D1', oracle: { kind: 'approved_rule', rule_id: 'R1', statement: 'A different rule with the same ID', source: 'contract' } });
  await c.beginExecution(f.dir, { id: 'wrong-e', scenario_id: 'objects.changed-rule', run_id: 'wrong', novelty: 'Try a reused rule ID with different meaning' });
  await c.finishExecution(f.dir, 'wrong-e', { results: ['wrong-pass'], remaining: [] });
  await assert.rejects(c.updateDefect(f.dir, 'D1', { status: 'resolved', execution_id: 'wrong-e', rationale: 'Different rule must not resolve original defect' }), /meaning/);
  await qa.journal(second, { id: 'good', rules: ['R1'], outcome: 'pass', summary: 'Object readable', attachments: ['read.txt'], checks: [{ rule: 'R1', expected: true, actual: true, passed: true }] });
  await c.beginExecution(f.dir, { id: 'good-e', scenario_id: 'objects.create', run_id: 'r2', novelty: 'Verify corrected read' });
  await c.finishExecution(f.dir, 'good-e', { results: ['good'], remaining: [] });
  await fs.writeFile(path.join(second, 'read.txt'), 'Modified verification evidence');
  await assert.rejects(c.updateDefect(f.dir, 'D1', { status: 'resolved', execution_id: 'good-e', rationale: 'Changed attachment must block resolution' }), /attachment changed/);
  await fs.writeFile(path.join(second, 'read.txt'), 'Independent readback');
  await c.updateDefect(f.dir, 'D1', { status: 'resolved', execution_id: 'good-e', rationale: 'Independent passing verification of R1 on v2' });
  await c.updateDefect(f.dir, 'C1', { status: 'not_reproduced', basis: { kind: 'approved_rule', rule_id: 'R1', statement: 'Committed object remains readable', source: 'contract' }, execution_id: 'good-e', rationale: 'Candidate now linked to the agreed exact rule and fresh readback' });
  const d = (await c.readCampaign(f.dir)).defects.D1;
  assert.equal(d.status, 'resolved'); assert.equal(d.history.length, 2);
  assert.equal((await c.readCampaign(f.dir)).defects.C1.status, 'not_reproduced');
  assert.equal((await c.reportCampaign(f.dir)).reconciled, false); // original observation result still unassigned
});

test('configured discovery roots expose unregistered runs and detached evidence', async t => {
  const f = await fixture(t);
  const manifestFile = path.join(f.dir, 'campaign.json');
  // Configure discovery before any events in a fresh campaign.
  const other = path.join(f.root, 'discovery');
  await c.initCampaign(other, { id: 'all-runs', title: 'All scoped runs', run_roots: [f.run] });
  const report = await c.reportCampaign(other);
  assert.ok(report.issues.some(i => i.kind === 'unregistered_run'));
  await c.registerRun(other, { id: 'r1', path: f.run, versions: { app: 'v1' } });
  await fs.mkdir(path.join(f.run, 'evidence')); await fs.writeFile(path.join(f.run, 'evidence/detached.txt'), 'Unassigned diagnostic');
  const next = await c.reportCampaign(other);
  assert.equal(next.issues.some(i => i.kind === 'unregistered_run'), false);
  assert.ok(next.issues.some(i => i.kind === 'unassigned_artifact'));
  assert.ok((await c.discoverRuns([f.run])).found.length === 1);
  await fs.access(manifestFile);
});

test('worker handoff stays unfinished until assigned executions and its result are accounted for', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario()); await executed(f);
  await c.assignWorker(f.dir, { id: 'reader', scenarios: ['objects.create'], namespace: 'reader-data', deadline: new Date(Date.now() + 60000).toISOString(), result_path: 'reader.json', charter: 'Observe independent read' });
  assert.ok((await c.reportCampaign(f.dir)).issues.some(i => i.kind === 'unfinished_worker'));
  await assert.rejects(c.finishWorker(f.dir, 'reader', { executions: ['e1'], summary: 'Worker completed assigned observation' }), /ENOENT/);
  await fs.writeFile(path.join(f.dir, 'reader.json'), '{"execution":"e1"}');
  await c.finishWorker(f.dir, 'reader', { executions: ['e1'], summary: 'Worker completed assigned observation' });
  assert.equal((await c.reportCampaign(f.dir)).reconciled, true);
});

test('changed run snapshots cannot supply an oracle for new verdicts', async t => {
  const f = await fixture(t); await c.addScenario(f.dir, scenario());
  await c.beginExecution(f.dir, { id: 'e1', scenario_id: 'objects.create', run_id: 'r1', novelty: 'Snapshot-integrity check' });
  const file = path.join(f.run, 'run.json'), manifest = JSON.parse(await fs.readFile(file));
  manifest.profile.budget_seconds += 10; await save(file, manifest);
  await assert.rejects(c.finishExecution(f.dir, 'e1', { results: ['result1'], remaining: [] }), /manifest changed/);
  await c.addScenario(f.dir, scenario('objects.another'));
  await assert.rejects(c.beginExecution(f.dir, { id: 'e2', scenario_id: 'objects.another', run_id: 'r1', novelty: 'Must not use modified run' }), /manifest changed/);
  assert.ok((await c.reportCampaign(f.dir)).issues.some(i => i.kind === 'changed_manifest'));
});
