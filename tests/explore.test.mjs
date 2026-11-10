import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { generateSamples, validateSchema, appendIntent, appendResult, appendObservation, inspectHistory, readHistory, analyzeHistory } from '../.agents/skills/business-logic-qa/scripts/explore.mjs';

const exec = promisify(execFile);
const helper = new URL('../.agents/skills/business-logic-qa/scripts/explore.mjs', import.meta.url).href;
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'business-explore-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
const intent = id => ({ id, actor: 'user-a', role: 'reader', session: 'session-a', correlation: 'workflow-1', data: { seed: 'seed-a', concrete: { count: 2 } } });

test('composite constants, unique collections and dependent fields generate reproducibly', () => {
  const schema = { type: 'object', required: ['kind', 'values', 'owner'], properties: {
    kind: { const: 'fixture' }, owner: { const: { id: 4 } },
    values: { type: 'array', minItems: 3, maxItems: 3, uniqueItems: true, items: { anyOf: [{ const: 'a' }, { const: 'b' }, { const: 'c' }, { const: null }] } },
    parent: { type: 'integer' }, version: { type: 'integer', minimum: 1 },
  }, dependentRequired: { parent: ['version'], owner: ['version'] } };
  const values = generateSamples(schema, { count: 30, seed: 'composites' });
  assert.deepEqual(values, generateSamples(schema, { count: 30, seed: 'composites' }));
  for (const item of values.samples) {
    assert.equal(item.kind, 'fixture'); assert.deepEqual(item.owner, { id: 4 }); assert.ok(item.version >= 1);
    assert.equal(new Set(item.values).size, 3);
  }
  values.samples[0].owner.id = 99; assert.equal(values.samples[1].owner.id, 4);
  assert.throws(() => generateSamples({ type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { const: 1 } }), /unique/);
  assert.throws(() => generateSamples({ anyOf: [] }), /anyOf/);
  assert.throws(() => generateSamples({ const: 1, type: 'string' }), /const/);
  assert.throws(() => generateSamples({ type: 'object', dependentRequired: { missing: ['x'] } }), /dependent/);
});

test('CLI keeps large histories out of context and saves full analysis on request', async t => {
  const dir = await directory(t);
  await appendIntent(dir, intent('large'));
  await appendResult(dir, { id: 'large', outcome: 'observed', data: { value: 'x'.repeat(5000) } });
  const filename = path.join(dir, 'analysis.json');
  const { stdout } = await exec(process.execPath, [new URL(helper).pathname, 'analyze', '--dir', dir, '--out', filename]);
  const compact = JSON.parse(stdout);
  assert.equal(compact.actions, 1);
  assert.equal(compact.uncertain, 0);
  assert.ok(stdout.length < 1000);
  const full = JSON.parse(await fs.readFile(filename, 'utf8'));
  assert.equal(full.actions[0].results[0].data.value.length, 5000);
});

test('seed replays nested concrete values, while other seeds vary cases', () => {
  const schema = { type: 'object', required: ['n', 'items'], additionalProperties: false, properties: {
    n: { type: 'integer', minimum: -3, maximum: 7 },
    items: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', pattern: '^[A-Z0-9_-]{2,5}$', minLength: 3, maxLength: 4 } },
    optional: { type: 'boolean' }, nullable: { type: 'null' },
  } };
  const first = generateSamples(schema, { seed: 'chosen-seed', count: 100 });
  assert.deepEqual(first, generateSamples(schema, { seed: 'chosen-seed', count: 100 }));
  assert.notDeepEqual(first.samples, generateSamples(schema, { seed: 'other-seed', count: 100 }).samples);
  assert.equal(first.seed, 'chosen-seed'); assert.ok(new Set(first.samples.map(JSON.stringify)).size > 50);
  for (const value of first.samples) {
    assert.ok(Number.isInteger(value.n) && value.n >= -3 && value.n <= 7);
    assert.ok(value.items.length >= 1 && value.items.length <= 4);
    assert.ok(value.items.every(item => /^[A-Z0-9_-]{3,4}$/.test(item)));
    if (Object.hasOwn(value, 'optional')) assert.equal(typeof value.optional, 'boolean');
    if (Object.hasOwn(value, 'nullable')) assert.equal(value.nullable, null);
  }
  assert.ok(first.samples.some(v => Object.hasOwn(v, 'optional')) && first.samples.some(v => !Object.hasOwn(v, 'optional')));
});

test('number bounds, singleton bounds, negative upper bounds and all primitive types', () => {
  const numbers = generateSamples({ type: 'number', minimum: 10, maximum: 11 }, { seed: 42, count: 1000 }).samples;
  assert.ok(numbers.every(n => n >= 10 && n <= 11)); assert.ok(new Set(numbers).size > 900);
  assert.deepEqual(generateSamples({ type: 'number', minimum: 3, maximum: 3 }).samples, [3]);
  assert.ok(generateSamples({ type: 'integer', maximum: -1000 }, { count: 10 }).samples.every(n => n <= -1000));
  assert.ok(generateSamples({ type: 'string', minLength: 5, maxLength: 5 }, { count: 10 }).samples.every(s => s.length === 5));
  assert.deepEqual(generateSamples({ type: 'null' }).samples, [null]);
  assert.equal(new Set(generateSamples({ type: 'boolean' }, { count: 100 }).samples).size, 2);
});

test('enum intersection preserves JSON values, required fields and independent copies', () => {
  const schema = { type: 'object', required: ['x'], additionalProperties: false, properties: { x: { type: 'integer', minimum: 2 } }, enum: [{ x: 1 }, { x: 2 }, { x: 3 }] };
  const samples = generateSamples(schema, { count: 100 }).samples;
  assert.ok(samples.every(v => [2, 3].includes(v.x)));
  samples[0].x = 99; assert.ok(samples.slice(1).every(v => [2, 3].includes(v.x)));
  assert.deepEqual(schema.enum, [{ x: 1 }, { x: 2 }, { x: 3 }]);
  assert.throws(() => generateSamples({ type: 'integer', enum: [1], minimum: 2 }), /no values/);
  assert.throws(() => generateSamples({ type: 'object', enum: [new Date()] }), /JSON values/);
});

test('supported patterns and constraints combine; unsupported constructs fail explicitly', () => {
  for (const pattern of ['^[a-z]+$', '^[0-9]*$', '^[A-Z]?$', '^[a-z]{2}$', '^[a-z]{1,5}$', '^literal_name$', '^$']) {
    for (const value of generateSamples({ type: 'string', pattern }, { count: 30 }).samples) assert.match(value, new RegExp(pattern));
  }
  const literal = 'averylongliteralmorethansixteen';
  assert.deepEqual(generateSamples({ type: 'string', pattern: `^${literal}$` }).samples, [literal]);
  for (const pattern of ['a+', '^(a|b)$', '^\\d+$', '^[^a]+$', '^a.*$', '^[z-a]$', '^[a-z]{3,1}$']) assert.throws(() => generateSamples({ type: 'string', pattern }), /Unsupported pattern/);
  assert.throws(() => generateSamples({ type: 'string', pattern: '^[a-z]{1,2}$', minLength: 3 }), /no values/);
  for (const schema of [{ type: ['string', 'null'] }, { type: 'string', format: 'email' }, { type: 'number', multipleOf: 2 }, { type: 'object', oneOf: [] }, { type: 'array', items: [] }]) assert.throws(() => validateSchema(schema), /Unsupported|supported type/);
});

test('invalid ranges, excess sizes and unknown required properties are rejected', () => {
  for (const schema of [{ type: 'integer', minimum: 0.1, maximum: 0.2 }, { type: 'number', minimum: 2, maximum: 1 }, { type: 'array', items: { type: 'null' }, maxItems: 10001 }, { type: 'object', required: ['missing'] }]) assert.throws(() => generateSamples(schema), /Invalid|required|Integer/);
  assert.throws(() => generateSamples({ type: 'string' }, { count: 0 }), /count/);
  assert.throws(() => generateSamples({ type: 'number' }, { seed: NaN }), /seed/);
});

test('history retains concrete inputs, actor identities and unmatched intents as uncertain', async t => {
  const dir = await directory(t);
  await appendIntent(dir, intent('one'));
  await appendObservation(dir, { id: 'one', data: { count: 2 } });
  await appendResult(dir, { id: 'one', outcome: 'received', data: { status: 200 } });
  await appendIntent(dir, { ...intent('two'), actor: 'user-b', role: 'reviewer', session: 'session-b' });
  const { records } = await readHistory(dir);
  assert.deepEqual(records[0].data, intent('one').data); assert.equal(records[1].correlation, 'workflow-1');
  assert.ok(records.every(r => Number.isFinite(Date.parse(r.time))));
  const summary = await inspectHistory(dir);
  assert.deepEqual(summary.uncertain, ['two']); assert.equal(summary.observations, 1);
  assert.equal(summary.actions[0].status, 'completed'); assert.equal(summary.actions[1].identity.actor, 'user-b');
  assert.deepEqual(summary.reported_outcomes, { received: 1 });
  assert.match(summary.limitation, /not inferred business verdicts/);
});

test('concurrent appends keep complete JSON lines and IDs/results are exclusive', async t => {
  const dir = await directory(t);
  await Promise.all(Array.from({ length: 30 }, (_, i) => appendIntent(dir, intent(`action-${i}`))));
  await Promise.all(Array.from({ length: 30 }, (_, i) => appendResult(dir, { id: `action-${i}`, outcome: 'observed', data: { response: 'x'.repeat(10000) } })));
  const history = await readHistory(dir); assert.equal(history.records.length, 60); assert.deepEqual(history.issues, []);
  const duplicate = await Promise.allSettled([appendIntent(dir, intent('same')), appendIntent(dir, intent('same'))]);
  assert.equal(duplicate.filter(r => r.status === 'fulfilled').length, 1);
  await appendResult(dir, { id: 'same', outcome: 'observed' });
  await assert.rejects(appendResult(dir, { id: 'same' }), /EEXIST/);
  await assert.rejects(appendResult(dir, { id: 'missing' }), /ENOENT/);
  assert.deepEqual((await inspectHistory(dir)).uncertain, []);
});

test('separate processes share history append and exclusive claim protocol', async t => {
  const dir = await directory(t);
  const source = `import {appendIntent,appendResult} from ${JSON.stringify(helper)}; const dir=process.argv[1]; const id=process.argv[2]; await appendIntent(dir,{id,actor:'a',role:'r',session:'s',correlation:'c'}); await appendResult(dir,{id,outcome:'observed'});`;
  await Promise.all(Array.from({ length: 4 }, (_, i) => exec(process.execPath, ['--input-type=module', '-e', source, dir, `process-${i}`])));
  const history = await readHistory(dir); assert.equal(history.records.length, 8); assert.deepEqual(history.issues, []);
  assert.deepEqual((await inspectHistory(dir)).uncertain, []);
});

test('credentials are recursively redacted; conflicting identities cannot corrupt history', async t => {
  const dir = await directory(t);
  await appendIntent(dir, { ...intent('safe'), data: { Authorization: 'secret-a', nested: [{ password: 'secret-b', echo: 'private-value', text: 'Bearer sensitive' }], api_key: 'secret-c' } }, { secretValues: ['private-value'] });
  const stored = await fs.readFile(path.join(dir, 'history.ndjson'), 'utf8');
  for (const secret of ['secret-a', 'secret-b', 'secret-c', 'private-value', 'Bearer sensitive']) assert.ok(!stored.includes(secret));
  assert.ok(stored.includes('[REDACTED]'));
  await assert.rejects(appendResult(dir, { id: 'safe', actor: 'different' }), /mismatch/);
  await assert.rejects(appendIntent(dir, { ...intent('identity'), session: 'Bearer sensitive' }), /credentials/);
  await assert.rejects(appendIntent(dir, { ...intent('../escape') }), /action ID/);
  assert.deepEqual((await inspectHistory(dir)).uncertain, ['safe']);
});

test('interrupted reservations, malformed trailing records and orphan results remain visible', async t => {
  const dir = await directory(t);
  await fs.mkdir(path.join(dir, 'actions', 'crashed-before-append'), { recursive: true });
  await appendIntent(dir, intent('unfinished'));
  await fs.appendFile(path.join(dir, 'history.ndjson'), '{"kind":"result"');
  const summary = await inspectHistory(dir);
  assert.deepEqual(new Set(summary.uncertain), new Set(['crashed-before-append', 'unfinished']));
  assert.ok(summary.issues.some(i => i.issue.includes('incomplete')));
  await appendIntent(dir, intent('after-interruption'));
  await appendResult(dir, { id: 'after-interruption', outcome: 'observed' });
  const recovered = await inspectHistory(dir);
  assert.equal(recovered.actions.find(a => a.id === 'after-interruption').status, 'completed');
  assert.ok(recovered.issues.some(i => i.issue.includes('incomplete')));
  const orphan = analyzeHistory([{ ...intent('orphan'), kind: 'result', outcome: 'pass' }]);
  assert.deepEqual(orphan.uncertain, ['orphan']); assert.equal(orphan.reported_outcomes.pass, 1);
  const mismatched = analyzeHistory([{ ...intent('mixed'), kind: 'intent' }, { ...intent('mixed'), kind: 'result', actor: 'other' }]);
  assert.deepEqual(mismatched.uncertain, ['mixed']); assert.ok(mismatched.issues.some(i => /identity mismatch/.test(i.issue)));
});
