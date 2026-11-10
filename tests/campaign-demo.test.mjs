import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDemo } from '../examples/campaign-demo.mjs';

test('generic product example reconciles real HTTP, native tests and retained diagnostics', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-demo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'example'), result = await runDemo(out);
  assert.equal(result.reconciled, true);
  assert.equal(result.operations, 3);
  assert.deepEqual(result.next, ['objects.delete']);
  assert.equal(result.native_tests.passed, 1);
  assert.equal(result.native_tests.skipped, 1);
  const report = JSON.parse(await fs.readFile(path.join(out, 'campaign/report.json')));
  assert.equal(report.scenarios.find(s => s.id === 'objects.delete').status, 'not_run');
  assert.equal(report.native_tests[0].missing.coverage, true);
  await assert.rejects(runDemo(out), /EEXIST/);
});
