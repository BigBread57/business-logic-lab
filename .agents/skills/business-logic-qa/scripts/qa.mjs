#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const exec = promisify(execFile);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const integer = (n, name, min = 1) => need(Number.isSafeInteger(n) && n >= min, `Invalid ${name}`);
const identifier = id => need(typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id), 'Invalid experiment ID');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function write(p, value) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, p);
}

export function validateProfile(profile) {
  need(object(profile) && typeof profile.project === 'string', 'Profile needs project');
  need(['local', 'dev'].includes(profile.environment), 'Only local and dev profiles are supported');
  const targets = profile.targets ?? {};
  const origins = profile.allowed_origins ?? [];
  need(object(targets) && (Object.keys(targets).length > 0 || object(profile.adapters) && Object.keys(profile.adapters).length > 0), 'Profile needs targets or native adapters');
  need(Array.isArray(origins) && (!Object.keys(targets).length || origins.length), 'HTTP targets need allowed_origins');
  for (const origin of origins) {
    const url = new URL(origin);
    need(['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password, 'Use exact HTTP origins without credentials');
  }
  for (const target of Object.values(targets)) {
    const url = new URL(target);
    need(origins.includes(url.origin) && !url.username && !url.password && !url.search && !url.hash, 'Target is outside allowed origins or contains credentials/query');
  }
  need(object(profile.actors) && Object.keys(profile.actors).length, 'Profile needs named actors');
  for (const actor of Object.values(profile.actors)) {
    need(object(actor) && Object.keys(actor).every(k => k === 'headers_env'), 'Actors accept headers_env only');
    for (const [header, env] of Object.entries(actor.headers_env ?? {})) {
      need(/^[A-Za-z0-9-]+$/.test(header) && /^[A-Z_][A-Z0-9_]*$/.test(env), 'Invalid header/env reference');
      need(!['host', 'content-length', 'connection', 'transfer-encoding'].includes(header.toLowerCase()), 'Transport headers are not configurable');
    }
  }
  need(Array.isArray(profile.permissions) && profile.permissions.every(p => ['read', 'mutate', 'load', 'reset', 'fault'].includes(p)), 'Invalid permissions');
  const budget = profile.budget_seconds ?? 1200;
  integer(budget, 'budget_seconds');
  const limits = profile.limits;
  need(object(limits), 'Profile needs limits');
  for (const name of ['request_timeout_ms', 'max_requests', 'max_parallel']) integer(limits[name], name);
  integer(limits.load_iterations ?? 0, 'load_iterations', 0);
  if (profile.permissions.includes('load')) need(limits.load_iterations > 0, 'Load permission needs finite load_iterations');
  if (profile.upload !== undefined) {
    need(object(profile.upload) && typeof profile.upload.root === 'string' && profile.upload.root.trim(), 'Upload needs fixture root');
    integer(profile.upload.max_bytes, 'upload max_bytes');
    need(profile.upload.max_bytes <= 64 * 1024 * 1024, 'Upload exceeds 64 MiB cap');
  }
  if (profile.limits.max_actions !== undefined) integer(profile.limits.max_actions, 'max_actions');
  if (profile.adapters !== undefined) {
    need(object(profile.adapters), 'Invalid adapters');
    for (const [name, adapter] of Object.entries(profile.adapters)) {
      identifier(name); need(name !== 'http', 'http adapter is reserved');
      need(object(adapter) && ['browser', 'kafka', 'db', 'native'].includes(adapter.transport), 'Invalid adapter transport');
      need(Array.isArray(adapter.resources) && adapter.resources.length && adapter.resources.every(r => typeof r === 'string' && r.trim()), 'Adapter needs exact resources');
      need(Array.isArray(adapter.permissions) && adapter.permissions.length && adapter.permissions.every(p => profile.permissions.includes(p)), 'Adapter permissions exceed profile');
    }
  }
  if (profile.team) {
    need(['coordinator', 'single'].includes(profile.team.mode), 'Invalid team mode');
    integer(profile.team.workers, 'workers');
  }
  return { ...profile, targets, allowed_origins: origins, budget_seconds: budget, team: profile.team ?? { mode: 'coordinator', workers: 3 } };
}

function validateKnowledge(knowledge) {
  need(object(knowledge) && typeof knowledge.project === 'string', 'Knowledge needs project');
  need(Array.isArray(knowledge.sources) && Array.isArray(knowledge.rules) && knowledge.rules.length, 'Knowledge needs sources and rules');
  const sources = new Set(knowledge.sources.map(s => s.id));
  need(sources.size === knowledge.sources.length, 'Duplicate source ID');
  const ids = new Set();
  for (const rule of knowledge.rules) {
    identifier(rule.id);
    need(!ids.has(rule.id), 'Duplicate rule ID'); ids.add(rule.id);
    need(typeof rule.statement === 'string' && rule.statement.length > 0, 'Rule needs statement');
    need(['candidate', 'approved'].includes(rule.status), 'Invalid rule status');
    need(Array.isArray(rule.sources) && rule.sources.length && rule.sources.every(s => sources.has(s)), 'Rule needs known sources');
  }
}

export async function approveKnowledge(knowledgeFile, out, by) {
  const text = await fs.readFile(knowledgeFile, 'utf8');
  const knowledge = JSON.parse(text); validateKnowledge(knowledge);
  need(knowledge.rules.some(r => r.status === 'approved'), 'No approved rules; obtain business agreement first');
  need(typeof by === 'string' && by.trim().length > 0, 'Approval needs reviewer');
  need(!await exists(out), 'Approval file already exists; use a new version');
  const approval = { sha256: hash(text), reviewer: by, approved_at: new Date().toISOString() };
  await write(out, approval); return approval;
}

export async function initRun({ config, knowledge, approval, out, mode = 'conformance' }) {
  const profile = validateProfile(await read(config));
  if (profile.upload) profile.upload = { ...profile.upload, root: path.resolve(path.dirname(config), profile.upload.root) };
  need(['conformance', 'observation'].includes(mode), 'Invalid run mode');
  let bundle = { project: profile.project, sources: [], rules: [], gaps: [] };
  let agreement = null;
  if (mode === 'conformance') {
    const knowledgeText = await fs.readFile(knowledge, 'utf8');
    bundle = JSON.parse(knowledgeText); validateKnowledge(bundle);
    agreement = await read(approval);
    need(hash(knowledgeText) === agreement.sha256 && agreement.reviewer, 'Knowledge approval is missing or stale');
    need(bundle.project === profile.project, 'Profile/knowledge project mismatch');
    need(bundle.rules.some(r => r.status === 'approved'), 'No approved rules');
  } else need(!knowledge && !approval, 'Observation runs do not accept approval; use conformance for approved invariants');
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.mkdir(out); // exclusive: an existing run never gets a fresh deadline
  await fs.mkdir(path.join(out, 'claims'));
  await fs.mkdir(path.join(out, 'results'));
  const now = Date.now();
  const manifest = { id: crypto.randomUUID(), started_at: new Date(now).toISOString(), deadline: now + profile.budget_seconds * 1000, mode, profile, knowledge: bundle, approval: agreement, knowledge_sha256: hash(JSON.stringify(bundle)) };
  await write(path.join(out, 'run.json'), manifest);
  await write(path.join(out, 'meter.json'), { requests: 0, active: [] });
  return manifest;
}

async function runInfo(dir) {
  const run = await read(path.join(dir, 'run.json'));
  validateProfile(run.profile);
  if (run.mode !== 'observation') validateKnowledge(run.knowledge);
  else need(run.knowledge?.rules?.length === 0 && run.approval === null, 'Invalid observation snapshot');
  need(hash(JSON.stringify(run.knowledge)) === run.knowledge_sha256, 'Run knowledge snapshot was modified');
  return run;
}

function secrets(profile) {
  return Object.values(profile.actors).flatMap(a => Object.values(a.headers_env ?? {})).map(name => process.env[name]).filter(Boolean);
}

export function sanitize(value, secretValues = []) {
  if (Array.isArray(value)) return value.map(v => sanitize(v, secretValues));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /authorization|cookie|password|secret|token|api[_-]?key/i.test(k) ? '[REDACTED]' : sanitize(v, secretValues)]));
  if (typeof value !== 'string') return value;
  let text = value.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]');
  for (const secret of secretValues) text = text.split(secret).join('[REDACTED]');
  return text.replace(/([?&](?:password|token|secret|api_key|access_token)=)[^&#\s]*/gi, '$1[REDACTED]');
}

function substitute(value, variables) {
  if (Array.isArray(value)) return value.map(v => substitute(v, variables));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, variables)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const val = key.startsWith('env:') ? process.env[key.slice(4)] : variables[key];
    need(val !== undefined && val !== null, `Missing variable ${key}`);
    return String(val);
  });
}

function getValue(body, jsonPath) {
  if (jsonPath === '$') return body;
  need(typeof jsonPath === 'string' && /^\$(?:\.[A-Za-z0-9_-]+|\[\d+\])+$/.test(jsonPath), 'Use simple $.field[0] paths');
  const parts = jsonPath.slice(1).match(/[A-Za-z0-9_-]+/g);
  return parts.reduce((value, key) => value === null || value === undefined ? undefined : Object.hasOwn(Object(value), key) ? value[key] : undefined, body);
}

function compare(actual, op, expected) {
  switch (op) {
    case 'eq': return isDeepStrictEqual(actual, expected);
    case 'ne': return !isDeepStrictEqual(actual, expected);
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'includes': return (Array.isArray(actual) || typeof actual === 'string') && actual.includes(expected);
    case 'exists': return (actual !== undefined) === expected;
    default: throw new Error('Unsupported assertion operator');
  }
}

function validateScenario(scenario, run) {
  identifier(scenario.id);
  const observation = scenario.mode === 'observation';
  need(scenario.mode === undefined || ['conformance', 'observation'].includes(scenario.mode), 'Invalid scenario mode');
  need(run.mode !== 'observation' || observation, 'Observation runs require observation scenarios');
  if (observation) {
    need(Array.isArray(scenario.rules ?? []), 'Observation rules must be empty array');
    need((scenario.rules ?? []).length === 0, 'Observation cannot reference rules');
    need(typeof scenario.question === 'string' && scenario.question.trim(), 'Observation needs question');
  } else need(Array.isArray(scenario.rules) && scenario.rules.length, 'Scenario needs rules');
  const rules = new Set(run.knowledge.rules.filter(r => r.status === 'approved').map(r => r.id));
  need((scenario.rules ?? []).every(r => rules.has(r)), 'Scenario references unapproved/unknown rule');
  need(Array.isArray(scenario.steps) && scenario.steps.length, 'Scenario needs steps');
  const assertions = [];
  const check = step => {
    need(object(step), 'Invalid step');
    if (step.parallel) {
      need(Array.isArray(step.parallel) && step.parallel.length > 0 && step.parallel.length <= run.profile.limits.max_parallel, 'Parallel group exceeds profile');
      need(step.parallel.every(s => !s.parallel && !s.capture), 'Parallel captures/nesting are unsupported; capture before group');
      step.parallel.forEach(check); return;
    }
    need(Object.hasOwn(run.profile.targets, step.target) && Object.hasOwn(run.profile.actors, step.actor), 'Unknown target/actor');
    need(typeof step.path === 'string', 'Request needs path');
    const method = (step.method ?? 'GET').toUpperCase();
    need(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method), 'Unsupported HTTP method');
    const action = ['GET', 'HEAD'].includes(method) ? 'read' : 'mutate';
    need(run.profile.permissions.includes(action), `Profile forbids ${action}`);
    if (step.upload !== undefined) {
      need(step.body === undefined && ['POST', 'PUT', 'PATCH'].includes(method), 'Upload needs a write method and no JSON body');
      need(run.profile.upload && object(step.upload) && ['binary', 'multipart'].includes(step.upload.type), 'Upload needs configured fixture root and supported type');
      need(step.upload.source === undefined || ['profile', 'run'].includes(step.upload.source), 'Invalid upload fixture source');
      const files = step.upload.type === 'binary' ? [step.upload] : step.upload.files;
      need(Array.isArray(files) && files.length > 0 && files.length <= 100, 'Upload needs 1..100 files');
      need(files.every(f => object(f) && typeof f.path === 'string' && (step.upload.type === 'binary' || typeof f.field === 'string' && f.field.length > 0)), 'Invalid upload file');
      if (step.upload.fields !== undefined) need(object(step.upload.fields) && Object.values(step.upload.fields).every(v => typeof v === 'string'), 'Multipart fields must be strings');
    }
    if (step.within_ms !== undefined) {
      integer(step.within_ms, 'within_ms'); integer(step.poll_ms ?? 100, 'poll_ms');
      need(action === 'read', 'Only reads may be polled');
    }
    if (step.expiry_outcome !== undefined) need(['violation', 'inconclusive'].includes(step.expiry_outcome), 'Invalid expiry outcome');
    need(!observation || !(step.assert?.length || step.within_ms), 'Observation cannot use assertions or verdict polling');
    for (const a of step.assert ?? []) {
      need(scenario.rules.includes(a.rule), 'Assertion needs a scenario rule');
      need(['eq', 'ne', 'lte', 'gte', 'includes', 'exists'].includes(a.op), 'Unsupported assertion operator');
      if (a.path !== '$status') getValue({}, a.path);
      need(Object.hasOwn(a, 'value'), 'Assertion needs value');
      assertions.push(a);
    }
    for (const capturePath of Object.values(step.capture ?? {})) getValue({}, capturePath);
  };
  scenario.steps.forEach(check);
  need((scenario.rules ?? []).every(rule => assertions.some(a => a.rule === rule)), 'Every scenario rule needs an assertion');
}

async function withMeter(dir, run, action) {
  const lock = path.join(dir, 'meter.lock');
  let handle;
  const until = Date.now() + 2000;
  while (!handle) {
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= until) throw new Error('Request meter locked; reconcile interrupted worker');
      await sleep(10);
    }
  }
  try {
    const meter = await read(path.join(dir, 'meter.json'));
    const result = action(meter);
    await write(path.join(dir, 'meter.json'), meter);
    return result;
  } finally { await handle.close(); await fs.unlink(lock); }
}

// Admission and completion are one atomic meter update each, shared by all processes.
export async function beginAction(dir, input) {
  const run = await runInfo(dir);
  const action = { ...input, id: input.id ?? crypto.randomUUID() }; identifier(action.id);
  need(Object.hasOwn(run.profile.actors, action.actor), 'Unknown action actor');
  need(typeof action.operation === 'string' && action.operation.trim(), 'Action needs operation');
  let transport;
  if (action.adapter === 'http') {
    transport = 'http';
    need(Object.hasOwn(run.profile.targets, action.target), 'Unknown HTTP target');
    const url = new URL(action.resource); const base = new URL(run.profile.targets[action.target]);
    need(url.origin === base.origin && !url.username && !url.password, 'HTTP resource escaped target');
    need(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(action.operation), 'Invalid HTTP operation');
    need(action.permission === (['GET', 'HEAD'].includes(action.operation) ? 'read' : 'mutate'), 'HTTP permission mismatch');
  } else {
    const adapter = run.profile.adapters?.[action.adapter];
    need(adapter && adapter.resources.includes(action.resource), 'Unknown adapter or forbidden resource');
    need(adapter.permissions.includes(action.permission), 'Adapter forbids permission');
    transport = adapter.transport;
  }
  need(run.profile.permissions.includes(action.permission), 'Profile forbids action permission');
  const token = crypto.randomUUID();
  while (true) {
    const receipt = await withMeter(dir, run, meter => {
      need(Date.now() < run.deadline, 'Run deadline reached');
      meter.entries ??= {};
      need(!Object.hasOwn(meter.entries, action.id), 'Action ID already reserved; reconcile before replay');
      need(meter.requests < Math.min(run.profile.limits.max_requests, run.profile.limits.max_actions ?? Infinity), 'Run request/action limit reached');
      if (meter.active.length >= run.profile.limits.max_parallel) return null;
      const deadline = Math.min(run.deadline, Date.now() + run.profile.limits.request_timeout_ms);
      const entry = sanitize({ ...action, transport, started_at: new Date().toISOString(), deadline, state: 'active' }, secrets(run.profile));
      entry.token_sha256 = hash(token);
      need(entry.id === action.id && entry.actor === action.actor && entry.resource === action.resource, 'Action identity contains credentials');
      Object.defineProperty(meter.entries, action.id, { value: entry, enumerable: true, configurable: true, writable: true });
      meter.requests++; meter.active.push(action.id);
      return { id: action.id, token, deadline };
    });
    if (receipt) return receipt;
    await sleep(10);
  }
}

export async function completeAction(dir, lease, result) {
  const run = await runInfo(dir); identifier(lease.id);
  need(object(result) && ['completed', 'failed', 'uncertain'].includes(result.status), 'Invalid action completion');
  if (result.attachments) await evidencePaths(dir, result.attachments);
  return withMeter(dir, run, meter => {
    const entry = meter.entries?.[lease.id];
    need(entry && typeof lease.token === 'string' && entry.token_sha256 === hash(lease.token), 'Invalid action lease');
    need(entry.state === 'active', 'Action already completed; reconcile uncertain actions');
    entry.state = result.status;
    entry.result = sanitize(result, secrets(run.profile)); entry.finished_at = new Date().toISOString();
    if (result.status !== 'uncertain') meter.active = meter.active.filter(id => id !== lease.id);
    const { token_sha256, ...safe } = entry; return safe;
  });
}

export async function reconcileAction(dir, id, record) {
  const run = await runInfo(dir); identifier(id);
  need(typeof record.summary === 'string' && record.summary.trim().length >= 16, 'Reconciliation needs evidence-backed summary');
  await evidencePaths(dir, record.attachments);
  return withMeter(dir, run, meter => {
    const entry = meter.entries?.[id];
    need(entry && ['active', 'uncertain'].includes(entry.state), 'Action is not uncertain or active');
    entry.reconciliation = sanitize({ ...record, at: new Date().toISOString() }, secrets(run.profile));
    entry.state = 'reconciled'; meter.active = meter.active.filter(value => value !== id);
    const { token_sha256, ...safe } = entry; return safe;
  });
}

export async function performAction(dir, action, fn) {
  const lease = await beginAction(dir, action);
  const controller = new AbortController(); let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { const error = new Error('Adapter timeout; reconcile accepted effects'); controller.abort(error); reject(error); }, Math.max(1, lease.deadline - Date.now()));
  });
  try {
    const value = await Promise.race([Promise.resolve().then(() => fn({ signal: controller.signal, lease })), timeout]);
    await completeAction(dir, lease, { status: 'completed' }); return value;
  } catch (error) {
    await completeAction(dir, lease, { status: 'uncertain', summary: error.message }); throw error;
  } finally { clearTimeout(timer); }
}

async function responseText(response) {
  let text = ''; let bytes = 0; const decoder = new TextDecoder();
  if (!response.body) return text;
  for await (const chunk of response.body) {
    bytes += chunk.length; need(bytes <= 1024 * 1024, 'Response exceeds 1 MiB evidence limit');
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

async function uploadFiles(upload, profile) {
  const root = await fs.realpath(profile.upload.root);
  let total = 0;
  const files = [];
  for (const file of upload.type === 'binary' ? [upload] : upload.files) {
    need(!path.isAbsolute(file.path), 'Upload path must be relative to fixture root');
    const actual = await fs.realpath(path.resolve(root, file.path));
    need(actual.startsWith(root + path.sep), 'Upload escaped fixture root');
    const handle = await fs.open(actual, 'r');
    const chunks = [];
    try {
      const stat = await handle.stat(); need(stat.isFile(), 'Upload must be a file');
      need(total + stat.size <= profile.upload.max_bytes, 'Upload exceeds byte limit');
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        total += chunk.length; need(total <= profile.upload.max_bytes, 'Upload exceeds byte limit'); chunks.push(chunk);
      }
    } finally { await handle.close(); }
    const bytes = Buffer.concat(chunks); const sha256 = hash(bytes);
    need(file.sha256 === undefined || file.sha256 === sha256, 'Upload fixture hash mismatch');
    const filename = file.filename ?? path.basename(file.path);
    need(typeof filename === 'string' && filename.length > 0 && Buffer.byteLength(filename) <= 4096 && !/[\r\n]/.test(filename), 'Invalid upload filename');
    need(file.content_type === undefined || typeof file.content_type === 'string' && file.content_type.length <= 1024 && !/[\r\n]/.test(file.content_type), 'Invalid upload content type');
    files.push({ file, bytes, metadata: { path: file.path, filename, field: file.field, content_type: file.content_type ?? 'application/octet-stream', bytes: bytes.length, sha256 } });
  }
  return files;
}

async function uploadProfile(upload, profile, dir) {
  if (upload.source === 'run') {
    const root = await fs.realpath(path.join(dir, 'uploads'));
    need(root.startsWith(await fs.realpath(dir) + path.sep), 'Run upload root escaped run');
    return { ...profile, upload: { ...profile.upload, root } };
  }
  return profile;
}

async function requestPayload(rendered, profile, headers, dir) {
  if (!rendered.upload) {
    if (rendered.body === undefined) return {};
    headers['Content-Type'] = 'application/json'; return { body: JSON.stringify(rendered.body) };
  }
  const files = await uploadFiles(rendered.upload, await uploadProfile(rendered.upload, profile, dir));
  if (rendered.upload.type === 'binary') {
    headers['Content-Type'] = files[0].metadata.content_type;
    return { body: files[0].bytes, uploads: files.map(f => f.metadata) };
  }
  const body = new FormData();
  const fields = Object.entries(rendered.upload.fields ?? {});
  need(fields.length <= 100 && fields.reduce((total, [key, value]) => total + Buffer.byteLength(key) + Buffer.byteLength(value), files.reduce((total, f) => total + f.bytes.length, 0)) <= profile.upload.max_bytes, 'Multipart fields/files exceed byte limit');
  for (const [key, value] of Object.entries(rendered.upload.fields ?? {})) body.append(key, value);
  for (const { bytes, metadata } of files) body.append(metadata.field, new Blob([bytes], { type: metadata.content_type }), metadata.filename);
  // Serialize with the platform's boundary so the cap includes multipart framing too.
  const encoded = new Response(body); const bytes = Buffer.from(await encoded.arrayBuffer());
  need(bytes.length <= profile.upload.max_bytes, 'Multipart framing exceeds byte limit');
  for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-type') delete headers[key];
  headers['Content-Type'] = encoded.headers.get('content-type');
  return { body: bytes, uploads: files.map(f => f.metadata) };
}

async function executeStep(step, context) {
  if (step.parallel) {
    const outcomes = await Promise.allSettled(step.parallel.map((s, branch_index) => executeStep(s, { ...context, branch_index })));
    const failures = outcomes.filter(r => r.status === 'rejected');
    if (failures.length) {
      const error = failures[0].reason;
      error.branches = failures.map(r => r.reason.message); throw error;
    }
    return outcomes.flatMap(r => r.value);
  }
  const { run, dir, variables, evidence, completed } = context;
  const rendered = substitute(step, variables);
  const base = run.profile.targets[step.target];
  const url = new URL(rendered.path, base.endsWith('/') ? base : `${base}/`);
  need(url.origin === new URL(base).origin && run.profile.allowed_origins.includes(url.origin) && !url.username && !url.password, 'Request URL escaped configured target');
  const headers = { Accept: 'application/json' };
  for (const [name, env] of Object.entries(run.profile.actors[step.actor].headers_env ?? {})) {
    need(process.env[env], `Missing credential environment ${env}`); headers[name] = process.env[env];
  }
  const method = (step.method ?? 'GET').toUpperCase();
  const { body, uploads } = await requestPayload(rendered, run.profile, headers, dir);
  const until = Math.min(run.deadline, Date.now() + (step.within_ms ?? 0));
  const finish = assertions => {
    const inconclusive = step.within_ms && step.expiry_outcome === 'inconclusive' && assertions.some(a => !a.passed);
    completed.push(...assertions.map(a => ({ ...a, observation_outcome: inconclusive ? 'inconclusive' : 'observed' })));
    if (inconclusive) {
      const error = new Error('Observation window expired without an approved SLA');
      error.outcome = 'inconclusive'; throw error;
    }
    return assertions;
  };
  while (true) {
    const lease = await beginAction(dir, { adapter: 'http', actor: step.actor, target: step.target, resource: url.href, operation: method, permission: ['GET', 'HEAD'].includes(method) ? 'read' : 'mutate' });
    let received = false;
    let assertions;
    try {
    const timeout = Math.min(lease.deadline - Date.now(), run.deadline - Date.now(), step.within_ms ? Math.max(1, until - Date.now()) : Infinity);
    need(timeout > 0, 'Run deadline reached');
    const record = { transport: 'http', step_index: context.step_index, branch_index: context.branch_index, actor: step.actor, method, url: url.href, request_body: rendered.body, ...(uploads ? { uploads, fields: rendered.upload.fields } : {}), started_at: new Date().toISOString() };
    evidence.push(record);
    const response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    record.action_id = lease.id; record.status = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel(); received = true;
      throw new Error('Redirect refused; add intended target explicitly');
    }
    const text = await responseText(response); received = true;
    let json; try { json = JSON.parse(text); } catch { /* status-only checks accept non-JSON */ }
    record.body = json ?? text; record.finished_at = new Date().toISOString();
    if ((rendered.assert ?? []).some(a => a.path !== '$status') || step.capture) need(json !== undefined, 'JSON observation unavailable');
    assertions = (rendered.assert ?? []).map(a => {
      const actual = a.path === '$status' ? response.status : getValue(json, a.path);
      return { rule: a.rule, path: a.path, op: a.op, expected: a.value, actual, passed: compare(actual, a.op, a.value) };
    });
    record.assertions = assertions;
    if (assertions.every(a => a.passed) || !step.within_ms || Date.now() >= until) {
      if (step.capture) for (const [name, p] of Object.entries(step.capture)) {
        const value = getValue(json, p); need(value !== undefined, `Capture unavailable: ${name}`); variables[name] = value;
      }
      return finish(assertions);
    }
    } finally { await completeAction(dir, lease, { status: received ? 'completed' : ['GET', 'HEAD'].includes(method) ? 'failed' : 'uncertain', summary: received ? 'HTTP response received' : 'HTTP completion unknown; reconcile effects' }); }
    await sleep(Math.min(step.poll_ms ?? 100, Math.max(0, until - Date.now())));
    if (Date.now() >= until) return finish(assertions);
  }
}

export async function executeScenario(dir, scenario, id = scenario.id) {
  const run = await runInfo(dir); validateScenario(scenario, run); identifier(id);
  need(Date.now() < run.deadline, 'Run deadline reached');
  await fs.mkdir(path.join(dir, 'claims', id));
  const evidence = [];
  const completed = [];
  const result = { id, scenario, mode: scenario.mode ?? 'conformance', rules: scenario.rules ?? [], origin: 'http-executor', started_at: new Date().toISOString(), outcome: 'blocked', evidence, assertions: completed, confirmed: false };
  const variables = { ...(scenario.variables ?? {}), run_id: run.id, correlation_id: crypto.randomUUID() };
  result.correlation_id = variables.correlation_id;
  try {
    for (const [step_index, step] of scenario.steps.entries()) {
      const checks = await executeStep(step, { run, dir, variables, evidence, completed, step_index });
      if (checks.some(a => !a.passed)) { result.outcome = 'violation'; break; }
    }
    if (result.outcome !== 'violation') result.outcome = scenario.mode === 'observation' ? 'observed' : 'pass';
  } catch (error) {
    result.error = error.message;
    if (error.branches) result.branch_errors = error.branches;
    if (error.outcome === 'inconclusive' || /JSON observation|Capture unavailable|Missing variable/.test(error.message)) result.outcome = 'inconclusive';
    if (completed.some(a => !a.passed && a.observation_outcome !== 'inconclusive')) result.outcome = 'violation';
  }
  result.finished_at = new Date().toISOString();
  const secretValues = [...secrets(run.profile), ...Object.entries(process.env).filter(([k]) => /TOKEN|PASSWORD|SECRET|AUTH|API_KEY/.test(k)).map(([, v]) => v).filter(Boolean)];
  const safe = sanitize(result, secretValues);
  await write(path.join(dir, 'results', `${id}.json`), safe);
  return safe;
}

export async function loadScenario(dir, scenario, { iterations, concurrency }) {
  const run = await runInfo(dir);
  need(run.profile.permissions.includes('load'), 'Profile forbids load');
  integer(iterations, 'iterations'); integer(concurrency, 'concurrency');
  need(iterations <= run.profile.limits.load_iterations && concurrency <= run.profile.limits.max_parallel, 'Load exceeds configured bounds');
  // Each scenario may contain its own parallel group: cap the product, not just workers.
  const width = Math.max(1, ...scenario.steps.map(s => s.parallel?.length ?? 1));
  need(width * concurrency <= run.profile.limits.max_parallel, 'Combined load/scenario concurrency exceeds profile');
  validateScenario(scenario, run);
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < iterations && Date.now() < run.deadline) {
      const i = next++; results.push(await executeScenario(dir, scenario, `${scenario.id}-${i}`));
    }
  }));
  return { planned: iterations, executed: results.length, results };
}

async function evidencePaths(dir, attachments) {
  need(Array.isArray(attachments) && attachments.length > 0, 'External record needs evidence attachments');
  const root = await fs.realpath(dir);
  for (const name of attachments) {
    need(typeof name === 'string' && !path.isAbsolute(name), 'Evidence paths must be relative to run');
    const actual = await fs.realpath(path.resolve(dir, name));
    need(actual.startsWith(`${root}${path.sep}`), 'Evidence escaped run directory');
    need((await fs.stat(actual)).isFile(), 'Evidence must be a file');
  }
}

export async function journal(dir, record) {
  const run = await runInfo(dir); identifier(record.id);
  const observation = record.mode === 'observation';
  need(record.mode === undefined || ['conformance', 'observation'].includes(record.mode), 'Invalid record mode');
  need(run.mode !== 'observation' || observation, 'Observation run requires observation records');
  if (observation) {
    need(['observed', 'inconclusive', 'blocked'].includes(record.outcome) && !(record.rules?.length || record.checks?.length), 'Observation cannot claim business verdicts, rules or checks');
    need(typeof record.question === 'string' && record.question.trim(), 'Observation needs question');
    record = { ...record, rules: [] };
  } else need(['pass', 'violation', 'inconclusive', 'blocked'].includes(record.outcome), 'Invalid outcome');
  const known = new Set(run.knowledge.rules.filter(r => r.status === 'approved').map(r => r.id));
  need(observation || Array.isArray(record.rules) && record.rules.length && record.rules.every(r => known.has(r)), 'External record needs approved rules');
  need(typeof record.summary === 'string' && record.summary.length > 0, 'External record needs observation summary');
  await evidencePaths(dir, record.attachments);
  const checks = record.checks ?? [];
  need(Array.isArray(checks) && checks.every(c => record.rules.includes(c.rule) && typeof c.passed === 'boolean' && Object.hasOwn(c, 'expected') && Object.hasOwn(c, 'actual')), 'External checks need rule, passed, expected and actual');
  if (record.outcome === 'pass' || record.outcome === 'violation') {
    need(record.rules.every(rule => checks.some(c => c.rule === rule)), 'Observed outcome needs explicit checks for each rule');
    need(record.outcome === 'pass' ? checks.every(c => c.passed) : checks.some(c => !c.passed), 'Outcome contradicts external checks');
  }
  await fs.mkdir(path.join(dir, 'claims', record.id)); // same ownership protocol as HTTP workers
  const safe = sanitize({ ...record, origin: 'agent-journal', confirmed: false, finished_at: new Date().toISOString() }, secrets(run.profile));
  await write(path.join(dir, 'results', `${record.id}.json`), safe); return safe;
}

export async function confirmFinding(dir, id, rationale) {
  identifier(id); const run = await runInfo(dir);
  const filename = path.join(dir, 'results', `${id}.json`); const result = await read(filename);
  need(result.outcome === 'violation', 'Only observed violations may be confirmed');
  need(typeof rationale === 'string' && rationale.trim().length >= 16, 'Confirmation needs evidence-backed rationale');
  need(result.origin === 'http-executor' ? result.assertions.some(a => !a.passed) && result.evidence.length > 0 : result.attachments?.length > 0, 'No violation evidence');
  result.confirmed = true; result.confirmation = sanitize(rationale, secrets(run.profile));
  await write(filename, result); return result;
}

export async function reconcileClaim(dir, id, record) {
  identifier(id); const run = await runInfo(dir); identifier(record.result_id);
  need(typeof record.summary === 'string' && record.summary.trim().length >= 16, 'Claim reconciliation needs evidence-backed summary');
  await evidencePaths(dir, record.attachments);
  const root = await fs.realpath(dir);
  const claim = await fs.realpath(path.join(dir, 'claims', id));
  need(claim.startsWith(root + path.sep) && (await fs.stat(claim)).isDirectory(), 'Claim escaped run');
  need(!await exists(path.join(dir, 'results', id + '.json')), 'Claim already has a result');
  const result = await read(path.join(dir, 'results', record.result_id + '.json'));
  need(result.id === record.result_id, 'Unknown reconciliation observation');
  const resolution = sanitize({ ...record, id, at: new Date().toISOString() }, secrets(run.profile));
  const file = path.join(claim, 'reconciliation.json');
  need(!await exists(file), 'Claim already reconciled');
  await fs.writeFile(file, JSON.stringify(resolution, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return resolution;
}

export async function reportRun(dir) {
  const run = await runInfo(dir);
  const results = await Promise.all((await fs.readdir(path.join(dir, 'results'))).filter(n => n.endsWith('.json')).sort().map(n => read(path.join(dir, 'results', n))));
  const ids = new Set(results.map(r => r.id));
  const reconciled_claims = [];
  const uncertain = [];
  for (const id of (await fs.readdir(path.join(dir, 'claims'))).filter(id => !ids.has(id))) {
    const file = path.join(dir, 'claims', id, 'reconciliation.json');
    if (!await exists(file)) { uncertain.push(id); continue; }
    const resolution = await read(file);
    need(resolution.id === id && ids.has(resolution.result_id), 'Invalid claim reconciliation');
    await evidencePaths(dir, resolution.attachments);
    reconciled_claims.push(resolution);
  }
  const coverage = run.knowledge.rules.filter(r => r.status === 'approved').map(rule => {
    const experiments = results.filter(r => r.rules.includes(rule.id)).map(r => ({ id: r.id, outcome: r.outcome, confirmed: r.confirmed, asserted: [...(r.assertions ?? []), ...(r.checks ?? [])].some(a => a.rule === rule.id) }));
    return { rule: rule.id, statement: rule.statement, experiments, attempted: experiments.length > 0, untested: !experiments.some(e => e.asserted) };
  });
  const durations = results.flatMap(r => r.evidence ?? []).filter(e => e.started_at && e.finished_at).map(e => Date.parse(e.finished_at) - Date.parse(e.started_at)).sort((a, b) => a - b);
  const latency = durations.length ? { count: durations.length, p50_ms: durations[Math.ceil(durations.length * 0.5) - 1], p95_ms: durations[Math.ceil(durations.length * 0.95) - 1], max_ms: durations.at(-1) } : { count: 0 };
  const meter = await read(path.join(dir, 'meter.json'));
  const actions = Object.values(meter.entries ?? {}).map(({ token_sha256, ...entry }) => entry);
  const by_transport = {}; for (const action of actions) by_transport[action.transport] = (by_transport[action.transport] ?? 0) + 1;
  const uncertain_actions = [...new Set([...actions.filter(a => ['active', 'uncertain'].includes(a.state)).map(a => a.id), ...meter.active.filter(id => !Object.hasOwn(meter.entries ?? {}, id))])];
  const report = { operations: meter.requests, by_transport, actions, uncertain_actions, reconciled_claims, mode: run.mode ?? 'conformance', observations: results.filter(r => r.mode === 'observation'), run_id: run.id, started_at: run.started_at, deadline: new Date(run.deadline).toISOString(), expired: Date.now() >= run.deadline, requests: (await read(path.join(dir, 'meter.json'))).requests, latency, environment: run.profile.environment, knowledge_sha256: run.knowledge_sha256, coverage, gaps: run.knowledge.gaps ?? [], uncertain, results, limitation: 'Scenario evidence only; agent-journal entries are externally supplied observations. No claim of exhaustive correctness.' };
  await write(path.join(dir, 'report.json'), report);
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = ['# Business Logic QA', '', `Run: ${run.id}`, `Environment: ${run.profile.environment}`, `Requests: ${report.requests}`, `Latency: ${JSON.stringify(latency)}`, `Deadline: ${report.deadline}`, '', '## Coverage', '', '| Rule | Assertion coverage | Experiments |', '| --- | --- | --- |', ...coverage.map(c => `| ${cell(c.rule)} | ${c.untested ? 'not-run' : 'observed'} | ${c.experiments.map(e => `${cell(e.id)}: ${e.outcome}${e.confirmed ? ' (confirmed)' : ''}`).join('; ') || 'none'} |`), '', '## Findings and observations', '', ...results.flatMap(r => [`### ${r.id}: ${r.outcome}`, '', `Origin: ${r.origin}; confirmed: ${r.confirmed}`, r.summary ?? r.error ?? '', `Evidence: results/${r.id}.json`, ...(r.attachments ?? []).map(p => `Attachment: ${p}`), ...(r.regression ? [`Regression: ${r.regression.path}; ${r.regression.status}`] : []), '']), '## Adapter actions', '', `Operations: ${report.operations}; by transport: ${JSON.stringify(by_transport)}`, ...uncertain_actions.map(id => `- ${id}: uncertain action; reconcile before replay`), '', '## Gaps', '', ...report.gaps.map(g => `- ${cell(g.id)}: ${g.statement}`), '', '## Uncertain operations', '', ...(uncertain.length ? uncertain.map(id => `- ${id}: reconcile before replay`) : ['None recorded.']), '', report.limitation];
  await fs.writeFile(path.join(dir, 'report.md'), `${lines.join('\n')}\n`);
  return report;
}

export async function generateRegression(dir, id, out) {
  identifier(id); const run = await runInfo(dir);
  const result = await read(path.join(dir, 'results', `${id}.json`));
  need(result.confirmed && result.outcome === 'violation', 'Regression requires a confirmed finding');
  need(result.origin === 'http-executor', 'External finding needs a native UI/broker test; HTTP generation is unsupported');
  need(!JSON.stringify(result.scenario).includes('[REDACTED]'), 'Scenario was redacted; replace secrets with environment references before generating replay');
  need(!await exists(out), 'Regression output exists');
  const fixtureDir = `${out}.fixtures`;
  need(!await exists(fixtureDir), 'Regression fixtures already exist');
  // Copies are portable and use sanitized data; fixtures require no original run directory.
  const profile = structuredClone(run.profile); const scenario = structuredClone(result.scenario);
  let fileIndex = 0; const fixtureFiles = [];
  const uploadSteps = scenario.steps.flatMap((step, step_index) => step.parallel ? step.parallel.map((branch, branch_index) => ({ step: branch, step_index, branch_index })) : [{ step, step_index }]);
  for (const { step, step_index, branch_index } of uploadSteps) {
    if (!step.upload) continue;
    const originalFiles = step.upload.type === 'binary' ? [step.upload] : step.upload.files;
    const observed = result.evidence.find(e => e.step_index === step_index && e.branch_index === branch_index && e.uploads);
    // Keep field/capture templates for replay; resolve only the saved file inputs here.
    const renderedUpload = observed ? { ...step.upload, fields: undefined, ...(step.upload.type === 'binary' ? { ...observed.uploads[0], type: 'binary', sha256: originalFiles[0].sha256 } : { files: observed.uploads.map((file, i) => ({ ...file, sha256: originalFiles[i].sha256 })) }) }
      : substitute({ ...step.upload, fields: undefined }, { ...(scenario.variables ?? {}), run_id: run.id, correlation_id: result.correlation_id });
    const files = await uploadFiles(renderedUpload, await uploadProfile(renderedUpload, run.profile, dir));
    const exported = [];
    for (const [index, { bytes, metadata }] of files.entries()) {
      const originals = result.evidence.flatMap(e => e.uploads ?? []).filter(file => file.path === metadata.path);
      need(originals.every(file => file.sha256 === metadata.sha256), 'Source fixture changed since failing observation');
      const name = `${fileIndex++}-${metadata.sha256}.bin`;
      fixtureFiles.push({ name, bytes });
      const original = originalFiles[index];
      exported.push({ path: name, sha256: metadata.sha256, filename: original.filename ?? path.basename(original.path), content_type: original.content_type ?? metadata.content_type, ...(original.field ? { field: original.field } : {}) });
    }
    step.upload = step.upload.type === 'binary' ? { type: 'binary', ...exported[0] } : { ...step.upload, source: 'profile', files: exported };
  }
  await fs.mkdir(fixtureDir, { recursive: true });
  if (fixtureFiles.length) await fs.mkdir(path.join(fixtureDir, 'uploads'));
  for (const { name, bytes } of fixtureFiles) await fs.writeFile(path.join(fixtureDir, 'uploads', name), bytes, { mode: 0o600 });
  if (profile.upload) profile.upload.root = './uploads';
  await write(path.join(fixtureDir, 'profile.json'), profile);
  const knowledgeText = `${JSON.stringify(run.knowledge, null, 2)}\n`;
  await fs.writeFile(path.join(fixtureDir, 'knowledge.json'), knowledgeText, { mode: 0o600 });
  await write(path.join(fixtureDir, 'approval.json'), { ...run.approval, sha256: hash(knowledgeText) });
  await write(path.join(fixtureDir, 'scenario.json'), scenario);
  await fs.copyFile(fileURLToPath(import.meta.url), path.join(fixtureDir, 'qa.mjs'));
  const fixtureName = JSON.stringify(`./${path.basename(fixtureDir)}/`);
  const source = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const fixtures = new URL(${fixtureName}, import.meta.url);
const {initRun, executeScenario, reportRun} = await import(new URL('qa.mjs', fixtures));
test(${JSON.stringify(`business regression: ${id}`)}, async () => {
  const file = name => fileURLToPath(new URL(name, fixtures));
  let out = process.env.QA_PARENT_RUN;
  if (!out) {
    const parent = process.env.QA_REGRESSION_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'business-qa-'));
    out = path.join(parent, randomUUID());
    await initRun({config:file('profile.json'), knowledge:file('knowledge.json'), approval:file('approval.json'), out});
  }
  const scenario = JSON.parse(await fs.readFile(file('scenario.json'), 'utf8'));
  if (process.env.QA_PARENT_RUN && scenario.steps.some(s => (s.parallel ?? [s]).some(step => step.upload))) {
    const namespace = 'regression-' + randomUUID();
    await fs.mkdir(path.join(out, 'uploads'), {recursive:true});
    const root = await fs.realpath(path.join(out, 'uploads'));
    assert.ok(root.startsWith(await fs.realpath(out) + path.sep), 'Run upload root escaped run');
    await fs.cp(file('uploads'), path.join(root, namespace), {recursive:true});
    for (const step of scenario.steps.flatMap(s => s.parallel ?? [s])) if (step.upload) {
      step.upload.source = 'run';
      for (const item of step.upload.type === 'binary' ? [step.upload] : step.upload.files) item.path = namespace + '/' + item.path;
    }
  }
  const result = await executeScenario(out, scenario, 'regression-' + randomUUID());
  await reportRun(out);
  console.log('QA evidence:', out);
  assert.equal(result.outcome, 'pass', 'Expected approved business behavior; inspect saved evidence');
});
`;

  await fs.writeFile(out, source, { flag: 'wx', mode: 0o600 });
  await write(path.join(dir, 'results', `${id}.json`), { ...result, regression: { path: path.resolve(out), status: 'generated-unverified', command: `node --test ${path.resolve(out)}` } });
  return { path: path.resolve(out), status: 'generated-unverified' };
}

export async function verifyRegression(dir, id) {
  identifier(id); const run = await runInfo(dir);
  const filename = path.join(dir, 'results', `${id}.json`); const result = await read(filename);
  need(result.regression?.path, 'Generate the regression first');
  const remaining = run.deadline - Date.now(); need(remaining > 0, 'Run deadline reached');
  const env = { ...process.env, QA_PARENT_RUN: path.resolve(dir) };
  delete env.NODE_TEST_CONTEXT;
  let status = 'passed'; let output = '';
  try {
    const execution = await exec(process.execPath, ['--test', '--test-isolation=none', result.regression.path], { env, timeout: remaining, maxBuffer: 1024 * 1024 });
    output = execution.stdout + execution.stderr;
  } catch (error) {
    status = error.killed ? 'timeout' : 'failed'; output = (error.stdout ?? '') + (error.stderr ?? '');
  }
  const evidence = `regressions/${id}.log`;
  await fs.mkdir(path.join(dir, 'regressions'), { recursive: true });
  await fs.writeFile(path.join(dir, evidence), sanitize(output, secrets(run.profile)), { mode: 0o600 });
  result.regression = { ...result.regression, status, evidence, verified_at: new Date().toISOString() };
  await write(filename, result);
  return result.regression;
}

const help = `Business Logic QA (Node 22+)\nCommands:\n  validate --config profile.json\n  approve --knowledge knowledge.json --out approval.json --by reviewer\n  init --config profile.json --knowledge knowledge.json --approval approval.json --out run-dir\n  init --mode observation --config profile.json --out run-dir\n  action-begin --run run-dir --action action.json --out lease.json\n  action-complete --run run-dir --lease lease.json --result receipt.json\n  action-reconcile --run run-dir --id action --record evidence.json\n  claim-reconcile --run run-dir --id experiment --record evidence.json\n  status --run run-dir\n  execute --run run-dir --scenario scenario.json [--id experiment]\n  load --run run-dir --scenario scenario.json --iterations N --concurrency N\n  journal --run run-dir --record observation.json\n  confirm --run run-dir --id experiment --rationale 'evidence-backed conclusion'\n  report --run run-dir\n  regression --run run-dir --id experiment --out regression.test.mjs\n  verify-regression --run run-dir --id experiment\nCompanion CLIs: campaign.mjs (registry/report/resume), environment.mjs (retained lifecycle), test-artifacts.mjs (native tests).\nExit: 0 success/pass/observed; 1 invalid input/error; 2 observed violation; 3 blocked/inconclusive.\nApproval records human agreement obtained by the agent; it does not authenticate a human.\nNative adapters use beginAction/completeAction or performAction; each primitive action shares the run budget. External effects are not an OS sandbox.\n`;

async function main(args) {
  const command = args.shift();
  if (!command || command === '--help') { process.stdout.write(help); return; }
  const opts = {};
  while (args.length) { const key = args.shift(); need(key.startsWith('--') && args.length, 'Use --key value options'); opts[key.slice(2)] = args.shift(); }
  let result;
  switch (command) {
    case 'validate': result = validateProfile(await read(opts.config)); break;
    case 'approve': result = await approveKnowledge(opts.knowledge, opts.out, opts.by); break;
    case 'init': result = await initRun(opts); break;
    case 'status': {
      const run = await runInfo(opts.run); result = { id: run.id, deadline: new Date(run.deadline).toISOString(), remaining_seconds: Math.max(0, Math.floor((run.deadline - Date.now()) / 1000)), requests: (await read(path.join(opts.run, 'meter.json'))).requests, claims: await fs.readdir(path.join(opts.run, 'claims')) }; break;
    }
    case 'execute': result = await executeScenario(opts.run, await read(opts.scenario), opts.id); process.exitCode = ['pass', 'observed'].includes(result.outcome) ? 0 : result.outcome === 'violation' ? 2 : 3; break;
    case 'load': result = await loadScenario(opts.run, await read(opts.scenario), { iterations: Number(opts.iterations), concurrency: Number(opts.concurrency) }); process.exitCode = result.results.some(r => r.outcome === 'violation') ? 2 : result.executed < result.planned || result.results.some(r => !['pass', 'observed'].includes(r.outcome)) ? 3 : 0; break;
    case 'journal': result = await journal(opts.run, await read(opts.record)); break;
    case 'action-begin': {
      result = await beginAction(opts.run, await read(opts.action));
      if (opts.out) { await write(opts.out, result); result = { id: result.id, deadline: result.deadline, lease_path: path.resolve(opts.out) }; }
      break;
    }
    case 'action-complete': result = await completeAction(opts.run, await read(opts.lease), await read(opts.result)); break;
    case 'action-reconcile': result = await reconcileAction(opts.run, opts.id, await read(opts.record)); break;
    case 'claim-reconcile': result = await reconcileClaim(opts.run, opts.id, await read(opts.record)); break;
    case 'confirm': result = await confirmFinding(opts.run, opts.id, opts.rationale); break;
    case 'report': result = await reportRun(opts.run); break;
    case 'regression': result = await generateRegression(opts.run, opts.id, opts.out); break;
    case 'verify-regression': result = await verifyRegression(opts.run, opts.id); process.exitCode = result.status === 'passed' ? 0 : result.status === 'timeout' ? 3 : 2; break;
    default: throw new Error('Unknown command; use --help');
  }
  // Keep tool output compact; full evidence stays on disk.
  const summary = command === 'execute' ? { id: result.id, outcome: result.outcome, error: result.error } : command === 'report' ? { coverage: result.coverage, observations: result.observations.length, operations: result.operations, by_transport: result.by_transport, uncertain: result.uncertain, uncertain_actions: result.uncertain_actions } : command === 'init' ? { id: result.id, deadline: result.deadline } : command === 'load' ? { planned: result.planned, executed: result.executed, outcomes: result.results.map(r => r.outcome) } : result;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
