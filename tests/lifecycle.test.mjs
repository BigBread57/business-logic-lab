import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareEnvironment, cleanupEnvironment, withEnvironment } from '../.agents/skills/business-logic-qa/scripts/lifecycle.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-lifecycle-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'fixture.mjs');
  await fs.writeFile(script, `import fs from 'node:fs/promises'; import path from 'node:path';
const [phase,dir,namespace] = process.argv.slice(2);
if (phase === 'prepare') { await fs.mkdir(path.join(dir,'data')); await fs.writeFile(path.join(dir,'data','account.json'), JSON.stringify({namespace, id: crypto.randomUUID()})); }
if (phase === 'fail') throw new Error('deliberate fixture failure');
if (phase === 'cleanup') await fs.rm(path.join(dir,'data'),{recursive:true,force:true});
if (phase === 'slow') await new Promise(r => setTimeout(r,10000));
console.log('Bearer private-fixture-token');`);
  const command = phase => ({ id: phase, argv: [process.execPath, script, phase, '${session}', '${namespace}'], timeout_ms: 5000 });
  return { root, recipe: { prepare: [command('prepare')], cleanup: [command('cleanup')] }, command };
}
test('environment lifecycle creates fresh namespaces/accounts, protects snapshots and cleans idempotently', async t => {
  const f = await fixture(t); const first = path.join(f.root, 'one'); const second = path.join(f.root, 'two');
  const a = await prepareEnvironment(f.recipe, first); const b = await prepareEnvironment(f.recipe, second);
  assert.notEqual(a.namespace, b.namespace);
  const account = async dir => JSON.parse(await fs.readFile(path.join(dir, 'data/account.json'), 'utf8'));
  assert.notEqual((await account(first)).id, (await account(second)).id);
  await assert.rejects(prepareEnvironment(f.recipe, first), /EEXIST/);
  assert.ok(!(await fs.readFile(path.join(first, 'prepare-prepare.log'), 'utf8')).includes('private-fixture-token'));
  await cleanupEnvironment(first); await cleanupEnvironment(first);
  await assert.rejects(fs.access(path.join(first, 'data')), /ENOENT/);
  const stateFile = path.join(second, 'environment.json'); const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  state.recipe.cleanup[0].argv = ['invalid']; await fs.writeFile(stateFile, JSON.stringify(state));
  await assert.rejects(cleanupEnvironment(second), /snapshot/);
});
test('partial setup failure and callback failure automatically clean owned resources', async t => {
  const f = await fixture(t); const dir = path.join(f.root, 'failed');
  await assert.rejects(prepareEnvironment({ ...f.recipe, prepare: [...f.recipe.prepare, f.command('fail')] }, dir), /deliberate fixture failure/);
  const state = JSON.parse(await fs.readFile(path.join(dir, 'environment.json'), 'utf8'));
  assert.equal(state.preparation, 'failed'); assert.equal(state.cleanup, 'completed');
  await assert.rejects(fs.access(path.join(dir, 'data')), /ENOENT/);
  const other = path.join(f.root, 'callback');
  await assert.rejects(withEnvironment(f.recipe, other, async () => { throw new Error('check failed'); }), /check failed/);
  await assert.rejects(fs.access(path.join(other, 'data')), /ENOENT/);
});
test('preserve policy retains resources through preparation and callback failures and refuses cleanup', async t => {
  const f = await fixture(t); const dir = path.join(f.root, 'preserved-failure');
  await assert.rejects(prepareEnvironment({ ...f.recipe, retention: 'preserve', prepare: [...f.recipe.prepare, f.command('fail')] }, dir), /deliberate fixture failure/);
  await fs.access(path.join(dir, 'data/account.json'));
  await assert.rejects(cleanupEnvironment(dir), /preserv/i);
  const callback = path.join(f.root, 'preserved-callback');
  await assert.rejects(withEnvironment({ ...f.recipe, retention: 'preserve' }, callback, async () => { throw new Error('callback failed'); }), /callback failed/);
  await fs.access(path.join(callback, 'data/account.json'));
});
test('cleanup failure is retained and retried, while child timeouts are bounded', async t => {
  const f = await fixture(t); const sentinel = path.join(f.root, 'allow-cleanup');
  const cleanup = { id: 'conditional', argv: [process.execPath, '-e', `require('node:fs').accessSync(process.argv[1])`, sentinel], timeout_ms: 5000 };
  const dir = path.join(f.root, 'retry'); await prepareEnvironment({ ...f.recipe, cleanup: [cleanup, ...f.recipe.cleanup] }, dir);
  await assert.rejects(cleanupEnvironment(dir), /ENOENT/);
  await fs.writeFile(sentinel, 'ready'); await cleanupEnvironment(dir);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'environment.json'), 'utf8')).cleanup, 'completed');
  const slow = path.join(f.root, 'timeout');
  await assert.rejects(prepareEnvironment({ ...f.recipe, prepare: [{ ...f.command('slow'), timeout_ms: 30 }] }, slow), /timeout|killed/i);
});
