import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { importTestArtifacts, runTestCommand } from '../.agents/skills/business-logic-qa/scripts/test-artifacts.mjs';

test('imports exact cases and sanitized immutable source with hashes and missing metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact test '));
  const source = path.join(dir, 'results.xml');
  await writeFile(source, '<testsuites><testsuite name="suite"><testcase classname="A" name="ok &amp; yes"/><testcase name="skip"><skipped message="not ready"/></testcase><testcase name="fail"><failure message="bad">detail</failure></testcase><testcase name="err"><error>broken</error></testcase></testsuite></testsuites>');
  const result = await importTestArtifacts({ out: path.join(dir, 'out'), junit: source, command: ['node', 'a b'], versions: { node: '1' } });
  assert.deepEqual(result.cases.map(x => x.status), ['passed', 'skipped', 'failed', 'error']);
  assert.equal(result.cases[0].name, 'ok & yes');
  assert.equal(result.cases[1].reason, 'not ready');
  assert.deepEqual(result.command, ['node', 'a b']);
  assert.equal(result.collection, null);
  assert.equal(result.coverage, null);
  assert.match(result.junit.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(importTestArtifacts({ out: path.join(dir, 'out'), junit: source }));
});

test('rejects malformed and unsafe XML', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-invalid-'));
  for (const [i, xml] of ['<!DOCTYPE x><testsuite/>', '<testsuite><testcase></testsuite>', '<testsuite><testcase name="&evil;"/></testsuite>', '<testsuite><testcase name="x"><failure/><error/></testcase></testsuite>'].entries()) {
    const source = path.join(dir, `${i}.xml`); await writeFile(source, xml);
    await assert.rejects(importTestArtifacts({ out: path.join(dir, `out${i}`), junit: source }));
  }
});

test('runs argv without a shell and records optional evidence and secrets safely', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-run-'));
  const xml = path.join(dir, 'suite.xml'); const list = path.join(dir, 'collection.txt'); const coverage = path.join(dir, 'coverage.json');
  const script = `const fs = require('fs'); fs.writeFileSync(process.argv[1], '<testsuite><testcase name="Bearer abc123"/></testsuite>'); fs.writeFileSync(process.argv[2], 'case one'); fs.writeFileSync(process.argv[3], '{"branches":1}')`;
  const result = await runTestCommand({ out: path.join(dir, 'out'), junit: xml, command: [process.execPath, '-e', script, xml, list, coverage], versions: { node: process.version }, collection: list, coverage });
  assert.equal(result.exit.code, 0);
  assert.equal(result.cases[0].name, 'Bearer [REDACTED]');
  assert.match(await readFile(path.join(dir, 'out', result.junit.artifact), 'utf8'), /REDACTED/);
  assert.ok(result.collection.sha256 && result.coverage.sha256);
});

test('redacts configured secret values and records a failing process', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-secret-'));
  const xml = path.join(dir, 'suite.xml');
  process.env.TEST_ARTIFACT_SECRET = 'unique-private-value';
  try {
    const script = 'require("fs").writeFileSync(process.argv[1], `<testsuite><testcase name="unique-private-value"/></testsuite>`); process.exit(3)';
    const result = await runTestCommand({ out: path.join(dir, 'out'), junit: xml, command: [process.execPath, '-e', script, xml, 'unique-private-value'] });
    assert.equal(result.exit.code, 3);
    assert.equal(result.command[4], '[REDACTED]');
    assert.equal(result.cases[0].name, '[REDACTED]');
    assert.doesNotMatch(await readFile(path.join(dir, 'out', result.junit.artifact), 'utf8'), /unique-private-value/);
    assert.equal(result.missing.versions, true);
  } finally { delete process.env.TEST_ARTIFACT_SECRET; }
});

test('refuses preexisting output or JUnit before executing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-stale-'));
  const xml = path.join(dir, 'suite.xml'); const marker = path.join(dir, 'marker');
  const command = [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], "ran")', marker];
  await writeFile(xml, '<testsuite/>');
  await assert.rejects(runTestCommand({ out: path.join(dir, 'out'), junit: xml, command }), /exist/i);
  await assert.rejects(readFile(marker));
  await assert.rejects(runTestCommand({ out: dir, junit: path.join(dir, 'new.xml'), command }), /exist/i);
  await assert.rejects(readFile(marker));
  await assert.rejects(runTestCommand({ out: path.join(dir, 'out2'), junit: path.join(dir, 'new.xml'), coverage: xml, command }), /exist/i);
  await assert.rejects(readFile(marker));
});

test('uses environment references without persisting their values', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-env-'));
  process.env.ARTIFACT_SOURCE = randomUUID();
  try {
    const result = await runTestCommand({ out: path.join(dir, 'out'), cwd: dir, junit: 'result.xml', env: { CHILD_VALUE: 'ARTIFACT_SOURCE' }, command: [process.execPath, '-e', 'console.log(process.env.CHILD_VALUE); require("fs").writeFileSync("result.xml", `<testsuite><testcase name="${process.env.CHILD_VALUE}"/></testsuite>`)'] });
    assert.equal(result.cases[0].name, '[REDACTED]');
    assert.equal((await readFile(path.join(dir, 'out', 'stdout.log'), 'utf8')).trim(), '[REDACTED]');
    assert.ok(!(await readFile(path.join(dir, 'out', 'execution.json'), 'utf8')).includes(process.env.ARTIFACT_SOURCE));
  } finally { delete process.env.ARTIFACT_SOURCE; }
});

test('preserves bounded process evidence without JUnit, including timeout', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-timeout-'));
  const result = await runTestCommand({ out: path.join(dir, 'out'), junit: path.join(dir, 'absent.xml'), cwd: dir, command: [process.execPath, '-e', 'console.log(process.cwd()); console.error("Bearer abc123"); setInterval(() => {}, 1000)'], timeout: 500 });
  assert.equal(result.exit.timed_out, true);
  assert.equal(result.junit, null);
  assert.match(await readFile(path.join(dir, 'out', 'stdout.log'), 'utf8'), /artifact-timeout/);
  assert.match(await readFile(path.join(dir, 'out', 'stderr.log'), 'utf8'), /Bearer \[REDACTED\]/);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out', 'execution.json'), 'utf8')).exit.timed_out, true);
});

test('run CLI reports failing command with nonzero status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-cli-'));
  const cli = fileURLToPath(new URL('../.agents/skills/business-logic-qa/scripts/test-artifacts.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'run', '--out', path.join(dir, 'out'), '--junit', path.join(dir, 'no.xml'), '--command', JSON.stringify([process.execPath, '-e', 'process.exit(7)'])], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).exit.code, 7);
});

test('missing JUnit retains available collection and coverage evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-partial-'));
  const collection = path.join(dir, 'collection.txt'), coverage = path.join(dir, 'coverage.json'), out = path.join(dir, 'out');
  const script = 'const fs = require("fs"); fs.writeFileSync(process.argv[1], "case-a"); fs.writeFileSync(process.argv[2], "{}"); process.exit(2)';
  const result = await runTestCommand({ out, junit: path.join(dir, 'absent.xml'), collection, coverage, command: [process.execPath, '-e', script, collection, coverage] });
  assert.equal(result.missing.junit, true);
  assert.equal(result.missing.collection, false);
  assert.equal(result.missing.coverage, false);
  assert.equal(await readFile(path.join(out, result.collection.artifact), 'utf8'), 'case-a');
});

test('JUnit can be emitted inside the reserved output directory without copy collisions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artifact-inplace-')), out = path.join(dir, 'out');
  const junit = path.join(out, 'junit.xml');
  const result = await runTestCommand({ out, junit, command: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], "<testsuites><testcase name=\\"case-a\\"/></testsuites>")', junit] });
  assert.equal(result.cases[0].status, 'passed');
  assert.notEqual(path.join(out, result.junit.artifact), junit);
});
