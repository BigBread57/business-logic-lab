#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import * as qa from '../.agents/skills/business-logic-qa/scripts/qa.mjs';
import * as campaign from '../.agents/skills/business-logic-qa/scripts/campaign.mjs';
import { createAdapter, createChain, saveEvidence } from '../.agents/skills/business-logic-qa/scripts/adapters.mjs';
import { prepareEnvironment } from '../.agents/skills/business-logic-qa/scripts/lifecycle.mjs';
import { doctor, snapshot } from '../.agents/skills/business-logic-qa/scripts/environment.mjs';
import { runTestCommand } from '../.agents/skills/business-logic-qa/scripts/test-artifacts.mjs';

const save = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
export async function runDemo(out) {
  await fs.mkdir(out, { mode: 0o700 }); // Exclusive: never overwrite a prior example.
  const objects = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/objects') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const object = { id: 'synthetic-' + objects.size, ...JSON.parse(Buffer.concat(chunks)) };
      objects.set(object.id, object); res.writeHead(201); res.end(JSON.stringify(object)); return;
    }
    const object = objects.get(req.url.split('/').at(-1));
    res.writeHead(object ? 200 : 404); res.end(JSON.stringify(object ?? { error: 'missing' }));
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  try {
    const origin = 'http://localhost:' + server.address().port;
    const runs = path.join(out, 'runs'); await fs.mkdir(runs);
    const dir = path.join(out, 'campaign'), run = path.join(runs, 'first');
    await campaign.initCampaign(dir, { id: 'object-audit', title: 'Generic object workflow', run_roots: [runs] });
    const profile = path.join(out, 'profile.json'), knowledge = path.join(out, 'knowledge.json'), approval = path.join(out, 'approval.json');
    await save(profile, { project: 'object-demo', environment: 'local', targets: { api: origin }, allowed_origins: [origin], actors: { tester: {} }, permissions: ['read', 'mutate'], budget_seconds: 120, limits: { request_timeout_ms: 5000, max_requests: 20, max_parallel: 2 }, adapters: { observer: { transport: 'native', resources: ['objects'], permissions: ['read'] } } });
    const rule = { id: 'R1', statement: 'Created object remains readable', status: 'approved', sources: ['demo-contract'] };
    await save(knowledge, { project: 'object-demo', sources: [{ id: 'demo-contract', statement: 'The example stores created objects in memory for its lifetime' }], rules: [rule] });
    await qa.approveKnowledge(knowledge, approval, 'Example author: fixture contract only');
    await qa.initRun({ config: profile, knowledge, approval, out: run });
    await campaign.registerRun(dir, { id: 'first', path: run, versions: { fixture: 'demo-v1', node: process.versions.node } });
    await campaign.addScenario(dir, { id: 'objects.create-read', title: 'Create and read an object', components: ['fixture'], remaining: ['Create object', 'Read object'], oracle: { kind: 'approved_rule', rule_id: 'R1', statement: rule.statement, source: 'demo-contract' } });
    await campaign.beginExecution(dir, { id: 'http-e1', scenario_id: 'objects.create-read', run_id: 'first', novelty: 'First create/read control' });
    const result = await qa.executeScenario(run, { id: 'create-read', rules: ['R1'], steps: [
      { target: 'api', actor: 'tester', method: 'POST', path: '/objects', body: { name: 'example' }, capture: { object_id: '$.id' }, assert: [{ rule: 'R1', path: '$status', op: 'eq', value: 201 }] },
      { target: 'api', actor: 'tester', path: '/objects/' + '$' + '{object_id}', assert: [{ rule: 'R1', path: '$status', op: 'eq', value: 200 }, { rule: 'R1', path: '$.name', op: 'eq', value: 'example' }] }
    ] });
    await campaign.finishExecution(dir, 'http-e1', { results: [result.id], remaining: [] });
    await campaign.addScenario(dir, { id: 'objects.native-read', title: 'Read through injected observer', components: ['fixture'], remaining: ['Observe stored object'], oracle: { kind: 'unknown', question: 'What does the independent observer see?' } });
    await campaign.beginExecution(dir, { id: 'native-e1', scenario_id: 'objects.native-read', run_id: 'first', novelty: 'Independent client adapter and correlated chain' });
    const chain = createChain(run, { correlation: { object_id: 'synthetic-0' }, stages: ['created', 'observed'] });
    await chain.checkpoint();
    await chain.observe('created', { state: 'present', provenance: 'results/create-read.json' });
    const adapter = createAdapter({ run, actor: 'tester', adapter: 'observer', resource: 'objects', client: { documentRead: async (_input, { signal }) => (await fetch(origin + '/objects/synthetic-0', { signal })).json() } });
    const object = await adapter.documentRead({ id: 'synthetic-0' });
    const evidence = await saveEvidence(run, 'object-read', object);
    const receipt = await chain.observe('observed', { state: 'present', provenance: evidence });
    await qa.journal(run, { id: 'native-read', mode: 'observation', question: 'What does the independent observer see?', outcome: 'observed', summary: 'Observer read the same synthetic object', attachments: [evidence, receipt.evidence] });
    await campaign.finishExecution(dir, 'native-e1', { results: ['native-read'], remaining: [] });
    await campaign.registerArtifact(dir, { id: 'chain', kind: 'chain', path: path.join(run, 'evidence/adapters'), scenarios: ['objects.native-read'], summary: 'Exact stage checkpoints and observer readback' });
    await campaign.addScenario(dir, { id: 'objects.delete', title: 'Delete and restore an object', components: ['fixture'], remaining: ['Agree restore semantics', 'Check deletion and restore'], oracle: { kind: 'unknown', question: 'Is restoration supported?' } });
    await campaign.recordQuestion(dir, { id: 'Q-restore', question: 'Should deletion permit restoration?', scenarios: ['objects.delete'] });
    const fixtures = path.join(out, 'fixtures'); await fs.mkdir(fixtures);
    const testFile = path.join(fixtures, 'object.test.mjs');
    await fs.writeFile(testFile, "import test from 'node:test'; import assert from 'node:assert/strict';\n" +
      "test('created object is readable', async () => { const body = await (await fetch(" + JSON.stringify(origin + '/objects/synthetic-0') + ")).json(); assert.equal(body.name, 'example'); });\n" +
      "test('restricted-role access', {skip: 'No restricted-role fixture in this example'}, () => {});\n");
    const nativeOut = path.join(out, 'native-tests'), junit = path.join(nativeOut, 'source.xml');
    await runTestCommand({ out: nativeOut, junit, timeout: 10000, versions: { fixture: 'demo-v1', node: process.versions.node }, command: [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=' + junit, testFile] });
    await campaign.registerArtifact(dir, { id: 'native-suite', kind: 'native-tests', path: nativeOut, scenarios: ['objects.create-read'], summary: 'Actual Node test run including an explicitly skipped role check' });
    await campaign.registerArtifact(dir, { id: 'fixtures', kind: 'other', path: fixtures, summary: 'Native test source' });
    const session = path.join(out, 'environment');
    await prepareEnvironment({ retention: 'preserve', resources: [{ id: 'marker', owner: '$' + '{namespace}' }], prepare: [{ id: 'marker', argv: [process.execPath, '-e', "require('fs').writeFileSync('marker','ready')"], timeout_ms: 5000 }], cleanup: [], doctor: [{ id: 'marker', argv: [process.execPath, '-e', "require('assert').equal(require('fs').readFileSync('marker','utf8'),'ready')"], timeout_ms: 5000 }] }, session);
    await doctor(session);
    const state = await snapshot(session);
    await campaign.registerArtifact(dir, { id: 'environment', kind: 'environment', path: state, summary: 'Retained fixture environment and successful named diagnostic' });
    const report = await campaign.reportCampaign(dir);
    if (!report.reconciled) throw new Error('Example reconciliation incomplete: ' + JSON.stringify(report.issues));
    const context = await campaign.resumeCampaign(dir);
    return { report: path.join(dir, 'report.md'), reconciled: report.reconciled, operations: report.runs[0].operations, next: context.next.map(s => s.scenario_id), native_tests: report.native_tests[0].counts };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') { console.error('Usage: node examples/campaign-demo.mjs --out NEW_DIRECTORY'); process.exitCode = 1; }
  else runDemo(path.resolve(args[1])).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
