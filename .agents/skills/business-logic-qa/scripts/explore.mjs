#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const need = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fields = ['id', 'actor', 'role', 'session', 'correlation'];
const own = (value, name) => Object.hasOwn(value, name);
const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const keys = {
  object: ['properties', 'required', 'additionalProperties', 'dependentRequired'], array: ['items', 'minItems', 'maxItems', 'uniqueItems'],
  string: ['minLength', 'maxLength', 'pattern'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'], boolean: [], null: [],
};

function bounds(schema, lower, upper, fallbackMin, fallbackMax) {
  const min = schema[lower] ?? Math.min(fallbackMin, schema[upper] ?? fallbackMin);
  const max = schema[upper] ?? Math.max(fallbackMax, min);
  need(Number.isFinite(min) && Number.isFinite(max) && min <= max, `Invalid ${lower}/${upper}`);
  if (lower !== 'minimum') need(Number.isSafeInteger(min) && Number.isSafeInteger(max) && min >= 0 && max <= 10000, `Invalid or excessive ${lower}/${upper}`);
  return [min, max];
}

// Deliberately small subset: an anchored ASCII literal, or one ASCII character
// class followed by ?, *, +, {n}, or {n,m}. No regex execution on unknown patterns.
function patternPlan(pattern) {
  need(typeof pattern === 'string' && pattern.startsWith('^') && pattern.endsWith('$'), 'Unsupported pattern: use an anchored ASCII literal or character class');
  const inner = pattern.slice(1, -1);
  if (/^[A-Za-z0-9 _-]*$/.test(inner)) return { literal: inner };
  const match = /^\[([^\]\\]+)\](\?|\*|\+|\{\d+(?:,\d+)?\})?$/.exec(inner);
  need(match && !match[1].startsWith('^'), 'Unsupported pattern construct');
  const characters = [];
  const raw = match[1];
  for (let i = 0; i < raw.length; i++) {
    const start = raw.charCodeAt(i);
    need(start >= 32 && start <= 126 && !'[]'.includes(raw[i]), 'Unsupported pattern character');
    if (i + 2 < raw.length && raw[i + 1] === '-') {
      const end = raw.charCodeAt(i + 2);
      need(end >= start && end <= 126 && !'[]'.includes(raw[i + 2]), 'Unsupported pattern range');
      for (let code = start; code <= end; code++) characters.push(String.fromCharCode(code));
      i += 2;
    } else characters.push(raw[i]);
  }
  need(characters.length > 0, 'Empty pattern character class');
  const quantifier = match[2];
  let min = 1; let max = 1;
  if (quantifier === '+') max = Infinity;
  else if (quantifier === '*') { min = 0; max = Infinity; }
  else if (quantifier === '?') min = 0;
  else if (quantifier) {
    const limits = quantifier.slice(1, -1).split(',').map(Number);
    min = limits[0]; max = limits[1] ?? min;
    need(Number.isSafeInteger(min) && Number.isSafeInteger(max) && min <= max && max <= 10000, 'Unsupported pattern bounds');
  }
  return { characters: [...new Set(characters)], min, max };
}

function stringPlan(schema) {
  let [min, max] = bounds(schema, 'minLength', 'maxLength', 0, 16);
  const plan = schema.pattern === undefined ? { characters: [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-'], min: 0, max: Infinity } : patternPlan(schema.pattern);
  if (own(plan, 'literal')) {
    if (schema.maxLength === undefined) max = Math.max(max, plan.literal.length);
    need(plan.literal.length >= min && plan.literal.length <= max, 'Pattern has no values within string bounds');
    return plan;
  }
  // An absent maxLength is a generation cap, not a constraint on a fixed pattern.
  if (schema.maxLength === undefined && Number.isFinite(plan.max)) max = Math.max(max, plan.min);
  min = Math.max(min, plan.min); max = Math.min(max, plan.max);
  need(min <= max, 'Pattern has no values within string bounds');
  return { ...plan, min, max };
}

export function validateSchema(schema, depth = 0) {
  need(depth <= 20 && object(schema), 'Unsupported schema object or maximum depth exceeded (20)');
  if (own(schema, 'const')) {
    need(Object.keys(schema).length === 1 && jsonValue(schema.const), 'const must be a standalone JSON value'); return schema;
  }
  if (own(schema, 'anyOf')) {
    need(Object.keys(schema).length === 1 && Array.isArray(schema.anyOf) && schema.anyOf.length > 0 && schema.anyOf.length <= 100, 'anyOf needs 1..100 standalone branches');
    schema.anyOf.forEach(s => validateSchema(s, depth + 1)); return schema;
  }
  need(types.includes(schema.type), 'Schema needs one supported type; maximum depth is 20');
  const permitted = new Set(['type', 'enum', ...keys[schema.type]]);
  for (const key of Object.keys(schema)) need(permitted.has(key), `Unsupported schema keyword: ${key}`);
  if (schema.enum !== undefined) {
    need(Array.isArray(schema.enum) && schema.enum.length > 0, 'enum needs values');
    for (const value of schema.enum) need(jsonValue(value), 'enum must contain JSON values');
  }
  switch (schema.type) {
    case 'object': {
      need(schema.properties === undefined || object(schema.properties), 'properties must be an object');
      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      need(Array.isArray(required) && required.every(k => typeof k === 'string' && own(properties, k)) && new Set(required).size === required.length, 'required must name distinct declared properties');
      need(schema.additionalProperties === undefined || typeof schema.additionalProperties === 'boolean', 'Only boolean additionalProperties supported');
      if (schema.dependentRequired !== undefined) {
        need(object(schema.dependentRequired) && Object.entries(schema.dependentRequired).every(([key, deps]) => own(properties, key) && Array.isArray(deps) && deps.every(d => typeof d === 'string' && own(properties, d))), 'dependentRequired must reference declared properties');
      }
      Object.values(properties).forEach(value => validateSchema(value, depth + 1)); break;
    }
    case 'array': need(schema.uniqueItems === undefined || typeof schema.uniqueItems === 'boolean', 'uniqueItems must be boolean'); need(schema.items !== undefined, 'Arrays need an items schema'); validateSchema(schema.items, depth + 1); bounds(schema, 'minItems', 'maxItems', 0, 4); break;
    case 'string': stringPlan(schema); break;
    case 'number': bounds(schema, 'minimum', 'maximum', -100, 100); break;
    case 'integer': {
      const [min, max] = bounds(schema, 'minimum', 'maximum', -100, 100);
      need(Number.isSafeInteger(Math.ceil(min)) && Number.isSafeInteger(Math.floor(max)) && Math.ceil(min) <= Math.floor(max), 'Integer bounds contain no safe integer'); break;
    }
  }
  if (schema.enum) need(schema.enum.some(value => matches(value, schema, false)), 'enum has no values satisfying constraints');
  return schema;
}

function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !object(value)) return false;
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every(v => jsonValue(v, seen)); seen.delete(value); return valid;
}

function matches(value, schema, useEnum = true) {
  if (own(schema, 'const')) return isDeepStrictEqual(value, schema.const);
  if (schema.anyOf) return schema.anyOf.some(s => matches(value, s));
  if (useEnum && schema.enum && !schema.enum.some(v => isDeepStrictEqual(v, value))) return false;
  switch (schema.type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'number': case 'integer': return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
    case 'string': {
      if (typeof value !== 'string' || (schema.minLength !== undefined && [...value].length < schema.minLength) || (schema.maxLength !== undefined && [...value].length > schema.maxLength)) return false;
      if (schema.pattern === undefined) return true;
      const plan = patternPlan(schema.pattern);
      return own(plan, 'literal') ? value === plan.literal : value.length >= plan.min && value.length <= plan.max && [...value].every(c => plan.characters.includes(c));
    }
    case 'array': return Array.isArray(value) && (!schema.uniqueItems || value.every((v, i) => !value.slice(0, i).some(other => isDeepStrictEqual(v, other)))) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity) && value.every(v => matches(v, schema.items));
    case 'object': return object(value) && Object.entries(schema.dependentRequired ?? {}).every(([key, deps]) => !own(value, key) || deps.every(d => own(value, d))) && (schema.required ?? []).every(k => own(value, k)) && Object.entries(value).every(([k, v]) => own(schema.properties ?? {}, k) ? matches(v, schema.properties[k]) : schema.additionalProperties !== false);
  }
  return false;
}

function random(seed) {
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function generateSamples(schema, { seed = '0', count = 1 } = {}) {
  validateSchema(schema);
  need((typeof seed === 'string' || typeof seed === 'number') && String(seed).length > 0 && (typeof seed !== 'number' || Number.isFinite(seed)), 'Invalid seed');
  need(Number.isSafeInteger(count) && count > 0 && count <= 10000, 'count must be 1..10000');
  const rng = random(seed);
  const choose = values => values[Math.floor(rng() * values.length)];
  const integer = (min, max) => Math.min(max, min + Math.floor(rng() * (max - min + 1)));
  let nodes = 0;
  const generate = s => {
    need(++nodes <= 100000, 'Generation exceeds 100000 value nodes');
    if (own(s, 'const')) return structuredClone(s.const);
    if (s.anyOf) return generate(choose(s.anyOf));
    if (s.enum) return structuredClone(choose(s.enum.filter(v => matches(v, s, false))));
    switch (s.type) {
      case 'null': return null;
      case 'boolean': return rng() < 0.5;
      case 'number': case 'integer': {
        const [min, max] = bounds(s, 'minimum', 'maximum', -100, 100);
        if (s.type === 'integer') return integer(Math.ceil(min), Math.floor(max));
        const fraction = rng(); return min * (1 - fraction) + max * fraction;
      }
      case 'string': {
        const plan = stringPlan(s);
        return own(plan, 'literal') ? plan.literal : Array.from({ length: integer(plan.min, plan.max) }, () => choose(plan.characters)).join('');
      }
      case 'array': {
        const [min, max] = bounds(s, 'minItems', 'maxItems', 0, 4); const length = integer(min, max); const values = [];
        let attempts = 0;
        while (values.length < length) {
          need(++attempts <= Math.max(1000, length * 100), 'Cannot generate enough unique items within bounded attempts');
          const value = generate(s.items);
          if (!s.uniqueItems || !values.some(v => isDeepStrictEqual(v, value))) values.push(value);
        }
        return values;
      }
      case 'object': {
        const selected = new Set(Object.keys(s.properties ?? {}).filter(key => (s.required ?? []).includes(key) || rng() < 0.5));
        let changed = true;
        while (changed) {
          changed = false;
          for (const [key, deps] of Object.entries(s.dependentRequired ?? {})) if (selected.has(key)) for (const dep of deps) if (!selected.has(dep)) { selected.add(dep); changed = true; }
        }
        return Object.fromEntries([...selected].map(key => [key, generate(s.properties[key])]));
      }
    }
  };
  const samples = Array.from({ length: count }, () => generate(schema));
  need(samples.every(value => matches(value, schema)), 'Generated value violated supported constraints');
  return { seed, samples };
}

export function redact(value, secretValues = []) {
  if (Array.isArray(value)) return value.map(v => redact(v, secretValues));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /credential|authorization|cookie|password|secret|token|api[_-]?key/i.test(key) ? '[REDACTED]' : redact(v, secretValues)]));
  if (typeof value !== 'string') return value;
  let safe = value.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]');
  for (const secret of secretValues.filter(s => typeof s === 'string' && s.length)) safe = safe.split(secret).join('[REDACTED]');
  return safe;
}

const validId = id => need(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id), 'Invalid action ID');
async function locked(dir, fn) {
  await fs.mkdir(dir, { recursive: true });
  const lock = path.join(dir, 'history.lock'); const until = Date.now() + 5000;
  while (true) {
    try { await fs.mkdir(lock); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; need(Date.now() < until, 'History lock busy; reconcile interrupted writer'); await pause(5); }
  }
  try { return await fn(); } finally { await fs.rmdir(lock); }
}

async function append(dir, event) {
  const line = `${JSON.stringify(event)}\n`;
  need(Buffer.byteLength(line) <= 1024 * 1024, 'History record exceeds 1 MiB');
  const handle = await fs.open(path.join(dir, 'history.ndjson'), 'a+', 0o600);
  try {
    const { size } = await handle.stat();
    if (size) {
      const last = Buffer.alloc(1); await handle.read(last, 0, 1, size - 1);
      // Keep interrupted evidence, but do not concatenate new JSON onto its tail.
      if (last[0] !== 10) await handle.writeFile('\n');
    }
    await handle.writeFile(line); await handle.sync();
  } finally { await handle.close(); }
}

async function record(dir, kind, input, secretValues) {
  need(object(input) && jsonValue(input), 'History event must contain JSON values'); validId(input.id);
  need(!own(input, 'kind') || input.kind === kind, 'Event kind mismatch');
  return locked(dir, async () => {
    const actionDir = path.join(dir, 'actions', input.id);
    let canonical;
    if (kind === 'intent') {
      for (const name of fields) need(typeof input[name] === 'string' && input[name].trim().length > 0, `Intent needs ${name}`);
      canonical = Object.fromEntries(fields.map(name => [name, input[name]]));
      need(isDeepStrictEqual(canonical, redact(canonical, secretValues)), 'Identity fields must not contain credentials');
    } else {
      canonical = JSON.parse(await fs.readFile(path.join(actionDir, 'intent.json'), 'utf8'));
      for (const name of fields) need(input[name] === undefined || input[name] === canonical[name], `Action ${name} mismatch`);
    }
    const time = input.time ?? new Date().toISOString();
    need(typeof time === 'string' && Number.isFinite(Date.parse(time)), 'Invalid history time');
    const event = redact({ ...input, ...canonical, kind, time }, secretValues);
    // Validate size before reserving IDs, so ordinary validation errors leave no claims.
    need(Buffer.byteLength(JSON.stringify(event)) < 1024 * 1024, 'History record exceeds 1 MiB');
    if (kind === 'intent') {
      await fs.mkdir(path.join(dir, 'actions'), { recursive: true });
      await fs.mkdir(actionDir); // exclusive and durable identity reservation
      await fs.writeFile(path.join(actionDir, 'intent.json'), JSON.stringify(canonical), { flag: 'wx', mode: 0o600 });
    } else if (kind === 'result') await fs.mkdir(path.join(actionDir, 'result-claim'));
    await append(dir, event);
    return event;
  });
}

export const appendIntent = (dir, input, { secretValues = [] } = {}) => record(dir, 'intent', input, secretValues);
export const appendResult = (dir, input, { secretValues = [] } = {}) => record(dir, 'result', input, secretValues);
export const appendObservation = (dir, input, { secretValues = [] } = {}) => record(dir, 'observation', input, secretValues);

export async function readHistory(dir) {
  let text;
  try { text = await fs.readFile(path.join(dir, 'history.ndjson'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { records: [], issues: [] }; throw error; }
  const records = []; const issues = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    try {
      const event = JSON.parse(lines[index]);
      need(object(event) && ['intent', 'result', 'observation'].includes(event.kind) && typeof event.id === 'string', 'Invalid event');
      records.push(event);
    } catch { issues.push({ line: index + 1, issue: 'Invalid or incomplete history record' }); }
  }
  return { records, issues };
}

export function analyzeHistory(records, { claimedIds = [] } = {}) {
  need(Array.isArray(records), 'History must be an array');
  const actions = new Map(); const issues = []; const reported_outcomes = {};
  for (const id of claimedIds) actions.set(id, { id, intents: [], results: [], observations: [] });
  for (const record of records) {
    need(object(record) && typeof record.id === 'string' && ['intent', 'result', 'observation'].includes(record.kind), 'Invalid history record');
    if (!actions.has(record.id)) actions.set(record.id, { id: record.id, intents: [], results: [], observations: [] });
    actions.get(record.id)[`${record.kind === 'observation' ? 'observation' : record.kind}s`].push(record);
    if (record.kind === 'result' && typeof record.outcome === 'string') Object.defineProperty(reported_outcomes, record.outcome, { value: (own(reported_outcomes, record.outcome) ? reported_outcomes[record.outcome] : 0) + 1, enumerable: true, configurable: true });
  }
  const summary = [...actions.values()].map(action => {
    if (action.intents.length !== 1) issues.push({ id: action.id, issue: action.intents.length ? 'Duplicate intents' : 'Missing intent record' });
    if (action.results.length > 1) issues.push({ id: action.id, issue: 'Duplicate results' });
    const consistent = action.intents.length === 1 && [...action.results, ...action.observations].every(record => fields.every(field => record[field] === action.intents[0][field]));
    if (action.intents.length === 1 && !consistent) issues.push({ id: action.id, issue: 'Action identity mismatch' });
    return { id: action.id, status: consistent && action.results.length === 1 ? 'completed' : 'uncertain', identity: action.intents[0] ? Object.fromEntries(fields.map(name => [name, action.intents[0][name]])) : null, results: action.results, observations: action.observations };
  });
  return { actions: summary, uncertain: summary.filter(a => a.status === 'uncertain').map(a => a.id), observations: summary.reduce((count, a) => count + a.observations.length, 0), reported_outcomes, issues, limitation: 'Structural history only. Recorded outcomes are supplied observations, not inferred business verdicts.' };
}

export async function inspectHistory(dir) {
  const history = await readHistory(dir);
  let claimedIds = [];
  try { claimedIds = await fs.readdir(path.join(dir, 'actions')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const summary = analyzeHistory(history.records, { claimedIds });
  summary.issues.push(...history.issues); return summary;
}

const help = `Explore helper (Node 22+; constrained subset, not full JSON Schema)\n  sample --schema schema.json [--seed text] [--count N] [--out samples.json]\n  analyze --dir history-directory [--out analysis.json]\nAnalysis prints compact counts; --out saves full analysis outside model context.\nExports: generateSamples, validateSchema, appendIntent, appendResult, appendObservation, readHistory, analyzeHistory, inspectHistory, redact.\nUnsupported schema keywords and patterns fail explicitly. Persist the returned seed and concrete samples with action intents.\n`;
async function main(args) {
  const command = args.shift();
  if (!command || command === '--help') { process.stdout.write(help); return; }
  const opts = {};
  while (args.length) { const key = args.shift(); need(key.startsWith('--') && args.length, 'Use --key value'); opts[key.slice(2)] = args.shift(); }
  let result;
  if (command === 'sample') result = generateSamples(JSON.parse(await fs.readFile(opts.schema, 'utf8')), { seed: opts.seed ?? '0', count: Number(opts.count ?? 1) });
  else if (command === 'analyze') result = await inspectHistory(opts.dir);
  else throw new Error('Unknown command; use --help');
  if (opts.out) await fs.writeFile(opts.out, JSON.stringify(result, null, 2), { mode: 0o600 });
  const output = command === 'analyze'
    ? { actions: result.actions.length, uncertain: result.uncertain.length, observations: result.observations, reported_outcomes: result.reported_outcomes, issues: result.issues.length, ...(opts.out ? { path: opts.out } : {}), limitation: result.limitation }
    : opts.out ? { seed: result.seed, count: result.samples.length, path: opts.out } : result;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
