import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareEnvironment } from '../.agents/skills/business-logic-qa/scripts/lifecycle.mjs';
import { doctor, snapshot, start, stop, resume } from '../.agents/skills/business-logic-qa/scripts/environment.mjs';

test('retained environment diagnostics, snapshots, restart and ownership validation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  const command = (id, code) => ({ id, argv: [process.execPath, '-e', code], timeout_ms: 5000 });
  const recipe = { retention: 'preserve', resources: [{ id: 'data', owner: '${namespace}' }],
    prepare: [command('prepare', "require('fs').writeFileSync('prepared','once',{flag:'wx'})")],
    cleanup: [command('cleanup', "require('fs').rmSync('prepared')")],
    doctor: [command('check', "console.log('probe output');throw Error('diagnostic failure')"), command('second', "console.log('second probe')")],
    start: [command('start', "require('fs').writeFileSync('running','yes')")],
    stop: [command('stop', "require('fs').rmSync('running',{force:true})")] };
  await prepareEnvironment(recipe, dir);
  await assert.rejects(doctor(dir), /diagnostic failure/);
  await assert.rejects(doctor(dir), /diagnostic failure/);
  const diagnosticState = JSON.parse(await fs.readFile(path.join(dir, 'environment.json')));
  assert.equal(diagnosticState.operations.length, 2);
  assert.match(diagnosticState.operations[0].checks.check.output, /probe output/);
  assert.match(diagnosticState.operations[0].checks.second.output, /second probe/);
  assert.notEqual(diagnosticState.operations[0].checks.check.log, diagnosticState.operations[1].checks.check.log);
  await fs.access(path.join(dir, diagnosticState.operations[0].checks.check.log));
  const first = await snapshot(dir); const contents = await fs.readFile(first, 'utf8');
  assert.match(contents, /diagnostic failure/);
  await start(dir); await stop(dir); await resume(dir);
  assert.equal(await fs.readFile(path.join(dir, 'prepared'), 'utf8'), 'once');
  assert.equal(await fs.readFile(path.join(dir, 'running'), 'utf8'), 'yes');
  const second = await snapshot(dir); assert.notEqual(first, second);
  assert.equal(await fs.readFile(first, 'utf8'), contents);
  const statePath = path.join(dir, 'environment.json'); const state = JSON.parse(await fs.readFile(statePath));
  state.namespace = 'bll-00000000-0000-0000-0000-000000000000'; await fs.writeFile(statePath, JSON.stringify(state));
  await assert.rejects(stop(dir), /ownership|snapshot/i);
});

test('unconfigured checks and controls are unavailable; preserved recipes need no cleanup', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-unavailable-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  await prepareEnvironment({ retention: 'preserve', prepare: [{ id: 'ok', argv: [process.execPath, '-e', ''], timeout_ms: 5000 }], cleanup: [] }, dir);
  for (const operation of [doctor, start, stop, resume]) await assert.rejects(operation(dir), /unavailable/i);
  const state = JSON.parse(await fs.readFile(path.join(dir, 'environment.json')));
  assert.equal(state.operation.status, 'unavailable');
});

test('an interrupted lock blocks snapshots and requires reconciliation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-interrupted-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  const command = { id: 'ok', argv: [process.execPath, '-e', ''], timeout_ms: 5000 };
  await prepareEnvironment({ prepare: [command], cleanup: [command] }, dir);
  await fs.mkdir(path.join(dir, 'environment.lock'));
  await assert.rejects(snapshot(dir), /EEXIST/);
  await assert.rejects(snapshot(dir), /EEXIST/);
  await fs.rmdir(path.join(dir, 'environment.lock'));
  const stateFile = path.join(dir, 'environment.json'); const state = JSON.parse(await fs.readFile(stateFile));
  state.operation = { phase: 'start', status: 'active' }; await fs.writeFile(stateFile, JSON.stringify(state));
  await assert.rejects(snapshot(dir), /interrupted.*reconciliation/i);
});

test('concurrent snapshots do not run snapshot commands together', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-snapshot-lock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  const command = (id, code) => ({ id, argv: [process.execPath, '-e', code], timeout_ms: 5000 });
  await prepareEnvironment({ prepare: [command('prepare', '')], cleanup: [command('cleanup', '')], snapshot: [command('capture', "require('fs').writeFileSync('capturing','yes');setTimeout(()=>{},500)")] }, dir);
  const first = snapshot(dir);
  for (let n = 0; n < 100; n++) {
    try { await fs.access(path.join(dir, 'capturing')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  await assert.rejects(snapshot(dir), /EEXIST/);
  await fs.access(await first);
});

test('environment operations serialize and do not run overlapping mutations', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-lock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  const command = (id, code) => ({ id, argv: [process.execPath, '-e', code], timeout_ms: 5000 });
  const recipe = { prepare: [command('prepare', '')], cleanup: [command('cleanup', '')],
    start: [command('start', "require('fs').writeFileSync('started','yes');setTimeout(()=>{},500)")],
    stop: [command('stop', "require('fs').writeFileSync('stopped','yes')")] };
  await prepareEnvironment(recipe, dir);
  const running = start(dir);
  for (let n = 0; n < 100; n++) {
    try { await fs.access(path.join(dir, 'started')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  await assert.rejects(stop(dir), /EEXIST/);
  await running;
  await assert.rejects(fs.access(path.join(dir, 'stopped')), /ENOENT/);
});
