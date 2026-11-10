#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sanitize } from './qa.mjs';

const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const need = (condition, message) => { if (!condition) throw new Error(message); };
const id = value => need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(value) && !value.includes('..') && !['constructor', 'prototype', '__proto__'].includes(value), 'Invalid stable ID');
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const exec = promisify(execFile);
const statuses = ['not_run', 'prepared', 'running', 'uncertain', 'partial', 'passed', 'observed', 'failed', 'blocked', 'needs_verification', 'excluded'];
const finishedStatuses = ['partial', 'passed', 'observed', 'failed', 'blocked', 'uncertain'];
const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function write(file, value) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
}
function strings(values, name, nonempty = false) {
  need(Array.isArray(values) && (!nonempty || values.length > 0) && values.every(text), 'Invalid ' + name);
  need(new Set(values).size === values.length, 'Duplicate ' + name);
}
function versions(value) {
  need(object(value) && Object.keys(value).length > 0 && Object.entries(value).every(([k, v]) => text(k) && text(v)), 'Explicit version metadata required');
}
export async function initCampaign(dir, config) {
  id(config.id); need(text(config.title), 'Campaign needs title');
  if (config.run_roots !== undefined) strings(config.run_roots, 'run roots');
  await fs.mkdir(path.dirname(path.resolve(dir)), { recursive: true });
  await fs.mkdir(dir); await fs.mkdir(path.join(dir, 'events'));
  const manifest = { schema_version: 1, id: config.id, title: config.title, created_at: now(), ...(config.run_roots ? { run_roots: config.run_roots.map(root => path.relative(path.resolve(dir), path.resolve(root)) || '.') } : {}) };
  await write(path.join(dir, 'campaign.json'), manifest);
  return manifest;
}
export async function readCampaign(dir) {
  const manifest = await read(path.join(dir, 'campaign.json'));
  need(manifest.schema_version === 1, 'Unsupported campaign schema');
  id(manifest.id); need(text(manifest.title), 'Invalid campaign title');
  const names = (await fs.readdir(path.join(dir, 'events'))).filter(n => n.endsWith('.json')).sort();
  const state = { ...manifest, manifest_sha256: digest(JSON.stringify(manifest)), scenarios: {}, runs: {}, executions: {}, defects: {}, questions: {}, workers: {}, artifacts: {}, events: [] };
  let previous = digest(JSON.stringify(manifest));
  for (const [index, name] of names.entries()) {
    need(name === String(index + 1).padStart(8, '0') + '.json', 'Campaign event sequence has a gap');
    const event = await read(path.join(dir, 'events', name));
    const { sha256, ...body } = event;
    need(body.sequence === index + 1 && body.previous === previous && sha256 === digest(JSON.stringify(body)), 'Campaign event integrity mismatch');
    previous = sha256; state.events.push(event);
    const d = event.data;
    switch (event.type) {
      case 'scenario.add': state.scenarios[d.id] = { ...d, status: 'not_run' }; break;
      case 'scenario.update': Object.assign(state.scenarios[d.id], d.patch); break;
      case 'run.add': state.runs[d.id] = d; break;
      case 'execution.begin':
        state.executions[d.id] = { ...d, status: 'running', started_at: event.at };
        state.scenarios[d.scenario_id].status = 'running'; break;
      case 'execution.finish': {
        const e = state.executions[d.id]; Object.assign(e, d, { finished_at: event.at });
        Object.assign(state.scenarios[e.scenario_id], { status: d.status, remaining: d.remaining });
        break;
      }
      case 'defect.add': state.defects[d.id] = { ...d, status: 'open', history: [{ ...d, at: event.at }] }; break;
      case 'defect.update':
        Object.assign(state.defects[d.id], d.patch);
        state.defects[d.id].history.push({ ...d.patch, at: event.at }); break;
      case 'question.record': state.questions[d.id] = d; break;
      case 'worker.assign': state.workers[d.id] = d; break;
      case 'worker.finish': Object.assign(state.workers[d.id], d, { status: 'completed' }); break;
      case 'artifact.add': state.artifacts[d.id] = d; break;
      default: throw new Error('Unknown campaign event: ' + event.type);
    }
  }
  return state;
}
async function mutate(dir, type, make, { lock_timeout_ms = 5000 } = {}) {
  const lock = path.join(dir, 'campaign.lock'); const until = Date.now() + lock_timeout_ms;
  while (true) {
    try { await fs.mkdir(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need(Date.now() < until, 'Campaign lock held; investigate interrupted writer before removing it');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    const state = await readCampaign(dir);
    const data = sanitize(await make(state));
    const body = { sequence: state.events.length + 1, previous: state.events.at(-1)?.sha256 ?? state.manifest_sha256, type, at: now(), data };
    const event = { ...body, sha256: digest(JSON.stringify(body)) };
    const name = String(body.sequence).padStart(8, '0') + '.json';
    // Publish a fully written event without overwriting any prior sequence.
    const tmp = path.join(dir, 'events', crypto.randomUUID() + '.tmp');
    await fs.writeFile(tmp, JSON.stringify(event, null, 2) + '\n', { mode: 0o600 });
    await fs.link(tmp, path.join(dir, 'events', name)); await fs.unlink(tmp);
    return data;
  } finally { await fs.rmdir(lock); }
}
function oracle(value) {
  need(object(value) && ['unknown', 'approved_rule', 'technical_invariant', 'contract'].includes(value.kind), 'Scenario needs explicit oracle kind');
  if (value.kind === 'unknown') need(text(value.question), 'Unknown oracle needs question');
  else need(text(value.statement) && text(value.source), 'Oracle needs statement and source');
}
export async function addScenario(dir, data, options) {
  return mutate(dir, 'scenario.add', state => {
    id(data.id); need(!Object.hasOwn(state.scenarios, data.id), 'Scenario already exists');
    need(text(data.title), 'Scenario needs title'); strings(data.components, 'components', true);
    strings(data.remaining ?? [], 'remaining'); oracle(data.oracle);
    for (const field of ['sources', 'patterns']) if (data[field] !== undefined) strings(data[field], field);
    if (data.depends_on) { strings(data.depends_on, 'dependencies'); need(data.depends_on.every(d => state.scenarios[d]), 'Unknown dependency'); }
    return { id: data.id, title: data.title, components: data.components, oracle: data.oracle, remaining: data.remaining ?? [], depends_on: data.depends_on ?? [], sources: data.sources ?? [], patterns: data.patterns ?? [], ...(data.regression_for ? { regression_for: data.regression_for } : {}) };
  }, options);
}
export async function updateScenario(dir, scenarioId, patch, options) {
  return mutate(dir, 'scenario.update', state => {
    need(state.scenarios[scenarioId], 'Unknown scenario');
    need(object(patch) && Object.keys(patch).every(k => ['title', 'remaining', 'status', 'reason', 'authority', 'oracle'].includes(k)), 'Invalid scenario patch');
    if (patch.title !== undefined) need(text(patch.title), 'Invalid title');
    if (patch.remaining !== undefined) strings(patch.remaining, 'remaining');
    if (patch.oracle !== undefined) oracle(patch.oracle);
    if (patch.status !== undefined) {
      need(['prepared', 'blocked', 'needs_verification', 'excluded', 'not_run'].includes(patch.status), 'Execution evidence required for this status');
      need(text(patch.reason), 'Status change needs reason');
      if (patch.status === 'excluded') need(text(patch.authority), 'Exclusion needs user authority');
    }
    return { id: scenarioId, patch };
  }, options);
}
export async function registerRun(dir, data) {
  return mutate(dir, 'run.add', async state => {
    id(data.id); need(!Object.hasOwn(state.runs, data.id), 'Run already registered');
    const root = await fs.realpath(data.path);
    const manifest = await read(path.join(root, 'run.json'));
    need(text(manifest.id) && object(manifest.profile), 'Invalid run manifest'); versions(data.versions);
    need(!Object.values(state.runs).some(r => r.run_uuid === manifest.id || path.resolve(dir, r.path) === root), 'Run is already registered under another ID');
    return { id: data.id, run_uuid: manifest.id, path: path.relative(path.resolve(dir), root), versions: data.versions, registered_at: now(), manifest_sha256: digest(await fs.readFile(path.join(root, 'run.json'))) };
  });
}
export async function beginExecution(dir, data) {
  return mutate(dir, 'execution.begin', async state => {
    id(data.id); need(!state.executions[data.id], 'Execution already exists');
    const scenario = state.scenarios[data.scenario_id];
    need(scenario && state.runs[data.run_id], 'Unknown scenario or run');
    await manifestFor(dir, state.runs[data.run_id]);
    need(!['excluded', 'blocked'].includes(scenario.status), 'Resolve exclusion or blocker first');
    need(!Object.values(state.executions).some(e => e.scenario_id === data.scenario_id && !e.finished_at), 'Scenario already has unfinished execution; reconcile first');
    need(text(data.novelty), 'Execution needs novelty or justified regression');
    return { id: data.id, scenario_id: data.scenario_id, run_id: data.run_id, novelty: data.novelty, versions: state.runs[data.run_id].versions, oracle: scenario.oracle };
  });
}
async function manifestFor(dir, run) {
  const root = await fs.realpath(path.resolve(dir, run.path));
  const file = await fs.realpath(path.join(root, 'run.json'));
  need(file.startsWith(root + path.sep), 'Run manifest escaped registered root');
  const bytes = await fs.readFile(file);
  need(digest(bytes) === run.manifest_sha256, 'Registered run manifest changed; preserve the snapshot and use a new run');
  const manifest = JSON.parse(bytes);
  need(manifest.id === run.run_uuid, 'Run identity changed');
  return manifest;
}
async function resultFor(dir, run, resultId) {
  id(resultId);
  await manifestFor(dir, run);
  const root = await fs.realpath(path.resolve(dir, run.path));
  const file = await fs.realpath(path.join(root, 'results', resultId + '.json'));
  need(file.startsWith(root + path.sep), 'Result escaped registered run');
  const bytes = await fs.readFile(file); const result = JSON.parse(bytes);
  need(result.id === resultId && ['pass', 'violation', 'observed', 'blocked', 'inconclusive'].includes(result.outcome), 'Invalid run result');
  return { result, sha256: digest(bytes) };
}
async function checkedResult(dir, state, execution, resultId) {
  const run = state.runs[execution.run_id], found = await resultFor(dir, run, resultId);
  need(found.sha256 === execution.result_hashes[resultId], 'Execution evidence changed');
  const root = await fs.realpath(path.resolve(dir, run.path));
  for (const [name, expected] of Object.entries(execution.result_evidence?.[resultId] ?? {})) {
    const file = await fs.realpath(path.resolve(root, name));
    need(file.startsWith(root + path.sep) && digest(await fs.readFile(file)) === expected, 'Supporting attachment changed');
  }
  return found;
}
export async function finishExecution(dir, executionId, data) {
  return mutate(dir, 'execution.finish', async state => {
    const execution = state.executions[executionId];
    need(execution && !execution.finished_at, 'Unknown or already finished execution');
    strings(data.results, 'results');
    const found = await Promise.all(data.results.map(r => resultFor(dir, state.runs[execution.run_id], r)));
    const result_evidence = {};
    const root = await fs.realpath(path.resolve(dir, state.runs[execution.run_id].path));
    for (const [i, item] of found.entries()) {
      const names = [...(item.result.attachments ?? []), ...(item.result.regression?.evidence ? [item.result.regression.evidence] : [])];
      const entries = [];
      for (const name of names) {
        need(text(name) && !path.isAbsolute(name), 'Evidence must be relative to run');
        const file = await fs.realpath(path.resolve(root, name));
        need(file.startsWith(root + path.sep) && (await fs.stat(file)).isFile(), 'Evidence escaped run');
        entries.push([name, digest(await fs.readFile(file))]);
      }
      result_evidence[data.results[i]] = Object.fromEntries(entries);
    }
    const outcomes = found.map(f => f.result.outcome);
    const inferred = outcomes.includes('violation') ? 'failed' : outcomes.some(o => ['inconclusive', 'blocked'].includes(o)) ? 'blocked' : outcomes.length && outcomes.every(o => o === 'pass') ? 'passed' : outcomes.length ? 'observed' : 'uncertain';
    const remaining = data.remaining ?? state.scenarios[execution.scenario_id].remaining;
    strings(remaining, 'remaining');
    const status = data.status ?? (remaining.length && ['passed', 'observed'].includes(inferred) ? 'partial' : inferred);
    need(finishedStatuses.includes(status), 'Invalid execution status');
    if (status === 'passed') {
      need(inferred === 'passed' && found.every(f => f.result.mode !== 'observation' && [...(f.result.assertions ?? []), ...(f.result.checks ?? [])].length > 0 && [...(f.result.assertions ?? []), ...(f.result.checks ?? [])].every(c => c.passed === true)), 'Passing status needs conformance checks, not observation');
      const basis = execution.oracle;
      need(basis.kind !== 'unknown' && text(basis.rule_id), 'Unknown scenario expectation remains observation; link an approved rule');
      const manifest = await manifestFor(dir, state.runs[execution.run_id]);
      const rule = manifest.knowledge?.rules.find(r => r.id === basis.rule_id && r.status === 'approved');
      need(rule && rule.statement === basis.statement && rule.sources.includes(basis.source) && found.some(f => [...(f.result.assertions ?? []), ...(f.result.checks ?? [])].some(c => c.rule === rule.id && c.passed)), 'Passing evidence must match the scenario approved rule meaning and source');
    }
    if (status === 'failed') need(inferred === 'failed', 'Failure needs violation evidence');
    if (status === 'observed') need(inferred === 'observed', 'Blocked or inconclusive results cannot become observations');
    if (status === 'passed' || status === 'observed') need(remaining.length === 0, 'Completion needs explicit accounting for remaining obligations');
    need(!outcomes.includes('violation') || ['failed', 'partial'].includes(status), 'Violation cannot be hidden by execution status');
    if (!outcomes.length) need(['uncertain', 'blocked'].includes(status) && text(data.summary), 'No result means uncertain or blocked with explanation');
    if (status === 'partial') need(remaining.length > 0, 'Partial execution needs remaining obligations');
    return { id: executionId, results: data.results, result_hashes: Object.fromEntries(found.map((f, i) => [data.results[i], f.sha256])), result_evidence, status, summary: data.summary ?? '', remaining };
  });
}
export async function addDefect(dir, data) {
  return mutate(dir, 'defect.add', async state => {
    id(data.id); need(!state.defects[data.id], 'Defect already exists'); need(text(data.title) && text(data.rationale), 'Defect needs title and rationale');
    need(['critical', 'high', 'medium', 'low'].includes(data.severity), 'Invalid severity');
    need(['confirmed', 'candidate'].includes(data.confidence), 'Invalid confidence');
    oracle(data.basis); need(data.basis.kind !== 'unknown', 'Unknown oracle stays a question');
    strings(data.executions, 'executions', true);
    need(data.executions.every(e => state.executions[e]?.finished_at && state.executions[e].results.length > 0), 'Defect needs completed evidence-backed executions');
    for (const executionId of data.executions) {
      const e = state.executions[executionId];
      for (const resultId of e.results) await checkedResult(dir, state, e, resultId);
    }
    if (data.confidence === 'confirmed') {
      let supported = false;
      for (const executionId of data.executions) {
        const e = state.executions[executionId]; const run = state.runs[e.run_id];
        const manifest = await manifestFor(dir, run);
        const rule = manifest.knowledge?.rules.find(r => r.id === data.basis.rule_id && r.status === 'approved');
        if (!rule || rule.statement !== data.basis.statement || !rule.sources.includes(data.basis.source)) continue;
        for (const resultId of e.results) {
          const found = await checkedResult(dir, state, e, resultId);
          if (found.result.outcome === 'violation' && found.result.confirmed === true && [...(found.result.checks ?? []), ...(found.result.assertions ?? [])].some(check => check.rule === rule.id && check.passed === false)) supported = true;
        }
      }
      need(supported, 'Confirmed defect requires a confirmed violation of its exact approved rule and source');
    }
    const existing_results = [];
    for (const run of Object.values(state.runs)) for (const name of await fs.readdir(path.resolve(dir, run.path, 'results'))) {
      if (name.endsWith('.json')) existing_results.push(run.id + '/' + name.slice(0, -5));
    }
    return { id: data.id, title: data.title, rationale: data.rationale, severity: data.severity, confidence: data.confidence, basis: data.basis, executions: data.executions, existing_results };
  });
}
export async function updateDefect(dir, defectId, patch) {
  return mutate(dir, 'defect.update', async state => {
    const defect = state.defects[defectId]; need(defect, 'Unknown defect');
    need(object(patch) && Object.keys(patch).every(k => ['status', 'execution_id', 'rationale', 'basis'].includes(k)), 'Invalid defect patch');
    need(['open', 'needs_verification', 'resolved', 'not_reproduced'].includes(patch.status) && text(patch.rationale), 'Invalid defect transition');
    const basis = patch.basis ?? defect.basis;
    if (patch.basis) {
      need(defect.confidence === 'candidate', 'Confirmed defect expectation is fixed');
      oracle(basis); need(basis.kind !== 'unknown' && text(basis.rule_id), 'Candidate resolution needs a linked approved rule');
    }
    if (['resolved', 'not_reproduced'].includes(patch.status)) {
      const e = state.executions[patch.execution_id];
      need(e?.status === 'passed', 'Resolution needs passing verification');
      need(!defect.executions.includes(e.id) && Date.parse(e.started_at) >= Date.parse(defect.history[0].at), 'Resolution needs later independent verification');
      const affected = defect.executions.map(x => state.executions[x].scenario_id);
      need(affected.includes(e.scenario_id) || state.scenarios[e.scenario_id].regression_for === defectId, 'Verification must cover this defect');
      need(Object.keys(e.versions).length > 0, 'Verification needs versions');
      const manifest = await manifestFor(dir, state.runs[e.run_id]);
      const rule = manifest.knowledge?.rules.find(r => r.id === basis.rule_id && r.status === 'approved');
      need(rule && rule.statement === basis.statement && rule.sources.includes(basis.source), 'Verification must preserve the approved rule meaning and source');
      let matching = false;
      for (const resultId of e.results) {
        const found = await checkedResult(dir, state, e, resultId);
        need(!(defect.existing_results ?? []).includes(e.run_id + '/' + resultId) && Date.parse(found.result.finished_at) >= Date.parse(defect.history[0].at), 'Verification result predates defect; collect fresh evidence');
        if (found.result.outcome === 'pass' && [...(found.result.checks ?? []), ...(found.result.assertions ?? [])].some(c => c.rule === basis.rule_id && c.passed)) matching = true;
      }
      need(matching, 'Verification must assert the defect rule');
    }
    return { id: defectId, patch };
  });
}
export async function recordQuestion(dir, data) {
  return mutate(dir, 'question.record', state => {
    id(data.id); need(text(data.question), 'Question needs text'); strings(data.scenarios ?? [], 'scenarios');
    need((data.scenarios ?? []).every(s => state.scenarios[s]), 'Unknown question scenario');
    need(!state.questions[data.id] || text(data.answer) && text(data.source), 'Question already exists; answer needs source');
    return { ...data, status: data.answer ? 'answered' : 'open' };
  });
}
export async function assignWorker(dir, data) {
  return mutate(dir, 'worker.assign', state => {
    id(data.id); strings(data.scenarios, 'scenarios', true);
    need(data.scenarios.every(s => state.scenarios[s]), 'Unknown worker scenario');
    need(text(data.namespace) && text(data.charter) && text(data.result_path) && !path.isAbsolute(data.result_path) && !data.result_path.split(/[\\/]/).includes('..'), 'Worker needs charter, namespace and relative result path');
    need(Number.isFinite(Date.parse(data.deadline)) && Date.parse(data.deadline) > Date.now(), 'Worker needs future deadline');
    need(!Object.values(state.workers).some(w => w.id !== data.id && w.namespace === data.namespace), 'Worker namespace already assigned');
    need(!state.workers[data.id], 'Worker already assigned; finish the original assignment');
    return { ...data, status: 'assigned', assigned_at: now() };
  });
}

export async function finishWorker(dir, workerId, data) {
  return mutate(dir, 'worker.finish', async state => {
    const worker = state.workers[workerId];
    need(worker && worker.status !== 'completed', 'Unknown or completed worker');
    strings(data.executions, 'executions', true);
    need(data.executions.every(e => state.executions[e]?.finished_at && worker.scenarios.includes(state.executions[e].scenario_id)), 'Worker needs completed assigned executions');
    need(text(data.summary), 'Worker needs completion summary');
    const root = await fs.realpath(dir), file = await fs.realpath(path.resolve(dir, worker.result_path));
    need(file.startsWith(root + path.sep) && (await fs.stat(file)).isFile(), 'Worker result escaped campaign');
    return { id: workerId, executions: data.executions, summary: data.summary, finished_at: now(), result_sha256: digest(await fs.readFile(file)) };
  });
}

async function artifactFiles(root) {
  const stat = await fs.lstat(root);
  need(!stat.isSymbolicLink(), 'Artifact symlinks are not supported');
  if (stat.isFile()) return [{ path: '', sha256: digest(await fs.readFile(root)) }];
  need(stat.isDirectory(), 'Artifact must be a file or directory');
  const files = [];
  async function walk(folder) {
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      need(!entry.isSymbolicLink(), 'Artifact symlinks are not supported');
      if (entry.isDirectory()) await walk(file);
      else { need(entry.isFile(), 'Artifact must contain regular files'); files.push({ path: path.relative(root, file), sha256: digest(await fs.readFile(file)) }); }
      need(files.length <= 10000, 'Artifact inventory exceeds 10000 files');
    }
  }
  await walk(root); return files;
}
export async function registerArtifact(dir, data) {
  return mutate(dir, 'artifact.add', async state => {
    id(data.id); need(!state.artifacts[data.id], 'Artifact already registered');
    need(['native-tests', 'chain', 'report', 'regression', 'environment', 'sources', 'other'].includes(data.kind) && text(data.summary), 'Artifact needs kind and summary');
    strings(data.scenarios ?? [], 'scenarios'); need((data.scenarios ?? []).every(s => state.scenarios[s]), 'Unknown artifact scenario');
    const supplied = path.resolve(data.path);
    need(!(await fs.lstat(supplied)).isSymbolicLink(), 'Artifact symlinks are not supported');
    const root = await fs.realpath(supplied); const files = await artifactFiles(root);
    need(files.length > 0, 'Artifact is empty');
    return { id: data.id, path: path.relative(path.resolve(dir), root), kind: data.kind, summary: data.summary, scenarios: data.scenarios ?? [], files };
  });
}

export async function snapshotSources(sources) {
  need(Array.isArray(sources), 'Sources must be an array');
  return Promise.all(sources.map(async source => {
    id(source.id); const root = await fs.realpath(source.path);
    const result = { id: source.id, path: root, git: { available: false }, files: [] };
    try {
      const options = { cwd: root, timeout: 5000, maxBuffer: 1024 * 1024 };
      const commit = (await exec('git', ['rev-parse', 'HEAD'], options)).stdout.trim();
      const dirty = (await exec('git', ['status', '--porcelain'], options)).stdout.trim().length > 0;
      result.git = { available: true, commit, dirty };
    } catch (error) { result.git.reason = error.code === 'ENOENT' ? 'git unavailable' : 'not a readable Git checkout'; }
    for (const name of source.files ?? []) {
      need(text(name) && !path.isAbsolute(name), 'Source files must be relative');
      const file = await fs.realpath(path.resolve(root, name));
      need(file.startsWith(root + path.sep), 'Source file escaped source root');
      result.files.push({ path: name, sha256: digest(await fs.readFile(file)) });
    }
    return result;
  }));
}

export async function discoverRuns(roots) {
  strings(roots, 'run roots', true);
  const found = []; const issues = []; let count = 0;
  async function walk(folder) {
    need(++count <= 10000, 'Discovery exceeds 10000 directories');
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) { issues.push({ path: file, message: 'Discovery skips symbolic links' }); continue; }
      if (entry.isDirectory()) await walk(file);
      else if (entry.name === 'run.json' && entry.isFile()) {
        try { const manifest = await read(file); need(text(manifest.id) && object(manifest.profile), 'Not a QA run manifest'); found.push({ path: folder, run_uuid: manifest.id }); }
        catch (error) { issues.push({ path: file, message: error.message }); }
      }
    }
  }
  for (const root of roots) {
    try { const resolved = await fs.realpath(root); await walk(resolved); }
    catch (error) { issues.push({ path: root, message: error.message }); }
  }
  return { found: [...new Map(found.map(r => [r.path, r])).values()], issues };
}

export async function reportCampaign(dir, { require_reconciled = false } = {}) {
  const state = await readCampaign(dir); const issues = []; const inventory = []; const runs = []; const nativeTests = [];
  const addIssue = (kind, details) => issues.push({ kind, ...details });
  if (await exists(path.join(dir, 'campaign.lock'))) addIssue('interrupted_writer', { message: 'Campaign lock present; reconcile writer before finalizing' });
  let discovery = { found: [], issues: [] };
  if (state.run_roots?.length) {
    discovery = await discoverRuns(state.run_roots.map(root => path.resolve(dir, root)));
    for (const item of discovery.issues) addIssue('discovery_incomplete', item);
    for (const item of discovery.found) if (!Object.values(state.runs).some(r => path.resolve(dir, r.path) === item.path)) addIssue('unregistered_run', item);
  }
  const inventoryFile = async (file, owner, kind) => {
    const bytes = await fs.readFile(file); inventory.push({ path: path.relative(path.resolve(dir), file), owner, kind, sha256: digest(bytes), bytes: bytes.length }); return bytes;
  };
  const attachment = async (root, name, owner, expected = []) => {
    try {
      need(typeof name === 'string' && !path.isAbsolute(name), 'Attachment must be relative');
      const file = await fs.realpath(path.resolve(root, name));
      need(file.startsWith(root + path.sep) && (await fs.stat(file)).isFile(), 'Evidence escaped run');
      const bytes = await inventoryFile(file, owner, 'evidence');
      if (expected.some(hash => hash !== digest(bytes))) addIssue('changed_evidence', { owner, path: name });
    } catch (error) { addIssue('missing_evidence', { owner, path: name, message: error.message }); }
  };
  await inventoryFile(path.resolve(dir, 'campaign.json'), state.id, 'manifest');
  for (const [i] of state.events.entries()) await inventoryFile(path.resolve(dir, 'events', String(i + 1).padStart(8, '0') + '.json'), state.id, 'event');
  for (const run of Object.values(state.runs)) {
    try {
      const root = await fs.realpath(path.resolve(dir, run.path));
      const manifestBytes = await inventoryFile(path.join(root, 'run.json'), run.id, 'run');
      if (digest(manifestBytes) !== run.manifest_sha256) addIssue('changed_manifest', { run_id: run.id });
      const manifest = JSON.parse(manifestBytes);
      need(manifest.id === run.run_uuid, 'Run identity changed');
      const names = (await fs.readdir(path.join(root, 'results'))).filter(n => n.endsWith('.json')).sort();
      const resultIds = new Set(); const results = [];
      for (const name of names) {
        try {
          const real = await fs.realpath(path.join(root, 'results', name)); need(real.startsWith(root + path.sep), 'Result escaped run');
          const bytes = await inventoryFile(real, run.id, 'result'); const result = JSON.parse(bytes);
          id(result.id); need(name === result.id + '.json', 'Result filename/ID mismatch');
          resultIds.add(result.id);
          const refs = Object.values(state.executions).filter(e => e.run_id === run.id && e.results?.includes(result.id));
          if (!refs.length) addIssue('unassigned_result', { run_id: run.id, result_id: result.id });
          for (const e of refs) if (e.result_hashes[result.id] !== digest(bytes)) addIssue('changed_result', { execution_id: e.id, result_id: result.id });
          for (const name of result.attachments ?? []) await attachment(root, name, run.id + '/' + result.id, refs.map(e => e.result_evidence?.[result.id]?.[name]).filter(Boolean));
          if (result.regression?.evidence) await attachment(root, result.regression.evidence, run.id + '/' + result.id, refs.map(e => e.result_evidence?.[result.id]?.[result.regression.evidence]).filter(Boolean));
          if (result.regression?.path) {
            try { await inventoryFile(await fs.realpath(result.regression.path), run.id, 'regression'); }
            catch { addIssue('missing_regression', { run_id: run.id, result_id: result.id, path: result.regression.path }); }
          }
          results.push({ id: result.id, outcome: result.outcome, summary: result.summary ?? result.error ?? '', assigned_to: refs.map(e => e.id), regression: result.regression ?? null });
        } catch (error) { addIssue('unreadable_result', { run_id: run.id, path: name, message: error.message }); }
      }
      for (const execution of Object.values(state.executions).filter(e => e.run_id === run.id)) for (const name of execution.results ?? []) {
        if (!resultIds.has(name)) addIssue('missing_result', { execution_id: execution.id, result_id: name });
      }
      for (const claim of await fs.readdir(path.join(root, 'claims'))) if (!resultIds.has(claim)) {
        const resolution = path.join(root, 'claims', claim, 'reconciliation.json');
        if (await exists(resolution)) {
          try {
            const record = JSON.parse(await inventoryFile(resolution, run.id, 'claim-reconciliation'));
            need(record.id === claim && resultIds.has(record.result_id) && text(record.summary), 'Invalid claim reconciliation');
            for (const name of record.attachments ?? []) await attachment(root, name, run.id + '/' + claim);
          } catch (error) { addIssue('invalid_claim_reconciliation', { run_id: run.id, id: claim, message: error.message }); }
        } else addIssue('uncertain_claim', { run_id: run.id, id: claim });
      }
      const meter = JSON.parse(await inventoryFile(path.join(root, 'meter.json'), run.id, 'meter'));
      const actions = Object.values(meter.entries ?? {});
      const uncertain = new Set([...(meter.active ?? []), ...actions.filter(a => ['active', 'uncertain'].includes(a.state)).map(a => a.id)]);
      for (const actionId of uncertain) addIssue('uncertain_action', { run_id: run.id, id: actionId });
      for (const action of actions) {
        for (const name of action.result?.attachments ?? []) await attachment(root, name, run.id + '/' + action.id);
        for (const name of action.reconciliation?.attachments ?? []) await attachment(root, name, run.id + '/' + action.id);
      }
      runs.push({ ...run, results, operations: meter.requests, deadline: manifest.deadline, uncertain_actions: [...uncertain] });
    } catch (error) { addIssue('unreadable_run', { run_id: run.id, message: error.message }); runs.push({ ...run, results: [] }); }
  }
  for (const artifact of Object.values(state.artifacts)) {
    const root = path.resolve(dir, artifact.path);
    try {
      const actual = await artifactFiles(root);
      if (JSON.stringify(actual) !== JSON.stringify(artifact.files)) addIssue('changed_artifact', { id: artifact.id, message: 'Registered artifact contents changed' });
      const names = new Set(actual.map(f => f.path));
      for (const expected of artifact.files) if (!names.has(expected.path)) addIssue('missing_artifact_file', { id: artifact.id, path: expected.path });
      for (const file of actual) await inventoryFile(file.path ? path.join(root, file.path) : root, artifact.id, artifact.kind);
      if (artifact.kind === 'native-tests') {
        const file = actual.some(f => f.path === 'manifest.json') ? path.join(root, 'manifest.json') : actual.length === 1 && actual[0].path === '' ? root : null;
        if (file) {
          const suite = await read(file);
          need(Array.isArray(suite.cases) && object(suite.missing), 'Native test artifact needs an imported test manifest');
          const counts = {}; for (const c of suite.cases) counts[c.status] = (counts[c.status] ?? 0) + 1;
          nativeTests.push({ artifact_id: artifact.id, counts, command: suite.command, versions: suite.versions, exit: suite.exit, missing: suite.missing, cases: suite.cases });
        } else addIssue('missing_test_manifest', { id: artifact.id });
      }
    } catch (error) { addIssue('unreadable_artifact', { id: artifact.id, message: error.message }); }
  }
  for (const execution of Object.values(state.executions)) if (!execution.finished_at) addIssue('unfinished_execution', { execution_id: execution.id, scenario_id: execution.scenario_id });
  for (const worker of Object.values(state.workers)) {
    if (worker.status !== 'completed') addIssue('unfinished_worker', { id: worker.id, deadline: worker.deadline, scenarios: worker.scenarios });
    else {
      try {
        const root = await fs.realpath(dir), file = await fs.realpath(path.resolve(dir, worker.result_path));
        need(file.startsWith(root + path.sep), 'Worker result escaped campaign');
        const bytes = await inventoryFile(file, worker.id, 'worker-result');
        if (digest(bytes) !== worker.result_sha256) addIssue('changed_worker_result', { id: worker.id });
      } catch (error) { addIssue('missing_worker_result', { id: worker.id, message: error.message }); }
    }
  }
  const inventoryPaths = new Set(inventory.map(i => path.resolve(dir, i.path)));
  for (const run of Object.values(state.runs)) for (const folder of ['evidence', 'regressions']) {
    const root = path.resolve(dir, run.path, folder);
    if (!await exists(root)) continue;
    try {
      for (const file of await artifactFiles(root)) {
        const target = path.join(root, file.path);
        if (inventoryPaths.has(target)) continue;
        await inventoryFile(target, run.id, 'unassigned-artifact');
        addIssue('unassigned_artifact', { run_id: run.id, path: path.relative(path.resolve(dir, run.path), target) });
      }
    } catch (error) { addIssue('artifact_scan_incomplete', { run_id: run.id, path: folder, message: error.message }); }
  }
  const currentEvents = (await fs.readdir(path.join(dir, 'events'))).filter(n => n.endsWith('.json')).length;
  if (currentEvents !== state.events.length || await exists(path.join(dir, 'campaign.lock'))) addIssue('campaign_changed_during_report', { message: 'Rerender after writers finish' });
  const scenarios = Object.values(state.scenarios).map(s => ({ ...s, executions: Object.values(state.executions).filter(e => e.scenario_id === s.id).map(e => e.id) }));
  const report = { schema_version: 1, campaign_id: state.id, generated_at: now(), reconciled: issues.length === 0, issues, scenarios, defects: Object.values(state.defects), questions: Object.values(state.questions), workers: Object.values(state.workers), artifacts: Object.values(state.artifacts), native_tests: nativeTests, executions: Object.values(state.executions), runs, discovery, source_inventory: inventory, limitations: ['Only registered runs/artifacts and explicitly configured discovery roots are inventoried; external actions without receipts are not reconstructed.', 'Reconciled describes source accounting, not exhaustive functional coverage.', 'Finding confidence and business expectations remain evidence-backed reviewer decisions.'] };
  const lines = ['# ' + state.title, '', 'Campaign: ' + state.id, 'Reconciled: ' + report.reconciled, 'Generated: ' + report.generated_at, '', '## Scenarios and remaining work', '', '| ID | Status | Executions | Remaining |', '| --- | --- | --- | --- |', ...scenarios.map(s => '| ' + [s.id, s.status, s.executions.join(', '), s.remaining.join('; ')].map(cell).join(' | ') + ' |'), '', '## Findings and history', '', ...report.defects.flatMap(d => ['### ' + d.id + ': ' + d.title, '', 'Status: ' + d.status + '; confidence: ' + d.confidence + '; severity: ' + d.severity, 'Basis: ' + d.basis.statement + ' — ' + d.basis.source, 'Executions: ' + d.executions.join(', '), ...d.history.map(h => '- ' + h.at + ': ' + (h.status ?? 'open') + '; ' + h.rationale), '']), '## Reconciliation issues', '', ...(issues.length ? issues.map(i => '- ' + JSON.stringify(i)) : ['All registered sources accounted for.']), '', '## Run results', '', ...runs.flatMap(r => ['### ' + r.id, '', 'Versions: ' + JSON.stringify(r.versions), ...r.results.map(x => '- ' + x.id + ': ' + x.outcome + '; ' + x.summary + '; executions: ' + (x.assigned_to.join(', ') || 'UNASSIGNED')), '']), '## Open questions', '', ...report.questions.filter(q => q.status === 'open').map(q => '- ' + q.id + ': ' + q.question), '', '## Source inventory', '', ...inventory.map(s => '- [' + cell(s.path) + '](' + encodeURI(s.path).replaceAll('(', '%28').replaceAll(')', '%29') + '): ' + s.sha256), '', '## Limits', '', ...report.limitations.map(l => '- ' + l)];
  await write(path.join(dir, 'report.json'), report);
  lines.push('', '## Native test suites', '', ...nativeTests.flatMap(s => ['### ' + s.artifact_id, '', 'Counts (not summed across suites): ' + JSON.stringify(s.counts), 'Missing evidence: ' + JSON.stringify(s.missing), 'Command: ' + JSON.stringify(s.command), 'Versions: ' + JSON.stringify(s.versions), ...s.cases.map(c => '- ' + c.classname + '::' + c.name + ': ' + c.status + (c.reason ? '; ' + c.reason : '')), '']), '## Worker handoffs', '', ...report.workers.map(w => '- ' + w.id + ': ' + w.status + '; scenarios: ' + w.scenarios.join(', ') + '; result: ' + w.result_path), '', '## Exclusions and blockers', '', ...scenarios.filter(s => ['excluded', 'blocked', 'uncertain', 'failed'].includes(s.status)).map(s => '- ' + s.id + ': ' + s.status + '; ' + (s.reason ?? 'Inspect linked executions') + (s.authority ? '; authority: ' + s.authority : '')));
  const markdown = lines.join('\n') + '\n';
  await fs.writeFile(path.join(dir, 'report.md'), markdown, { mode: 0o600 });
  const snapshotDir = path.join(dir, 'reports', crypto.randomUUID());
  await fs.mkdir(snapshotDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(snapshotDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  // Link targets in the snapshot are rooted at the campaign, not at reports/UUID.
  await fs.writeFile(path.join(snapshotDir, 'report.md'), markdown.replace(/\]\((?![a-z]+:|#)([^)]+)\)/gi, '](../../$1)'), { flag: 'wx', mode: 0o400 });
  need(!require_reconciled || report.reconciled, 'Campaign reconciliation incomplete; partial report saved');
  return report;
}
export async function planCampaign(dir, options = {}) {
  const state = await readCampaign(dir);
  if (options.versions !== undefined) versions(options.versions);
  const queue = []; const held = [];
  for (const scenario of Object.values(state.scenarios)) {
    const executions = Object.values(state.executions).filter(e => e.scenario_id === scenario.id);
    const latest = executions.at(-1);
    const unfinished = executions.some(e => !e.finished_at);
    const activeWorker = Object.values(state.workers).find(w => w.status !== 'completed' && w.scenarios.includes(scenario.id));
    const dependency = scenario.depends_on.find(d => !['passed', 'observed'].includes(state.scenarios[d].status));
    const defect = Object.values(state.defects).find(d => d.status !== 'resolved' && d.executions.some(e => state.executions[e].scenario_id === scenario.id));
    const changed = latest && scenario.components.filter(component => options.versions?.[component] !== undefined && options.versions[component] !== latest.versions[component]);
    const authorizedRegression = scenario.status === 'needs_verification' || changed?.length > 0;
    if (unfinished || activeWorker || dependency || ['excluded', 'blocked', 'uncertain', 'running'].includes(scenario.status) || scenario.status === 'failed' && !authorizedRegression || defect && !authorizedRegression) {
      held.push({ scenario_id: scenario.id, reason: unfinished ? 'reconcile_execution' : activeWorker ? 'worker:' + activeWorker.id : dependency ? 'dependency:' + dependency : defect ? 'defect:' + defect.id : scenario.status }); continue;
    }
    const reason = !executions.length ? 'not_run' : scenario.status === 'needs_verification' ? 'requested_verification' : ['prepared', 'not_run'].includes(scenario.status) ? 'explicitly_reopened' : scenario.remaining.length || scenario.status === 'partial' ? 'remaining_obligations' : changed?.length ? 'changed_version' : null;
    if (reason) queue.push({ scenario_id: scenario.id, title: scenario.title, reason, changed_components: changed || [], remaining: scenario.remaining, oracle: scenario.oracle });
  }
  const plan = { campaign_id: state.id, generated_at: now(), queue, held, versions: options.versions ?? null };
  await write(path.join(dir, 'plan.json'), plan);
  return plan;
}
export async function resumeCampaign(dir, options = {}) {
  const state = await readCampaign(dir); const plan = await planCampaign(dir, options); const report = await reportCampaign(dir);
  const context = { campaign_id: state.id, generated_at: now(), next: plan.queue, held: plan.held, unfinished: Object.values(state.executions).filter(e => !e.finished_at), reconciliation: report.issues, questions: Object.values(state.questions).filter(q => q.status === 'open'), workers: Object.values(state.workers), defects: Object.values(state.defects).map(d => ({ id: d.id, title: d.title, status: d.status })), runs: Object.values(state.runs).map(r => ({ id: r.id, versions: r.versions })), instruction: 'Reconcile uncertain mutations and interrupted executions before replay; preserve original run deadlines. Use a new registered run for an explicitly extended budget.' };
  await write(path.join(dir, 'context.json'), context);
  const lines = ['# Campaign continuation', '', context.instruction, '', '## Reconcile first', '', ...context.reconciliation.map(i => '- ' + JSON.stringify(i)), '', '## Next scenarios', '', ...context.next.map(s => '- ' + s.scenario_id + ': ' + s.reason + '; ' + s.remaining.join('; ')), '', '## Held scenarios', '', ...context.held.map(s => '- ' + s.scenario_id + ': ' + s.reason), '', '## Open questions', '', ...context.questions.map(q => '- ' + q.id + ': ' + q.question), '', '## Findings', '', ...context.defects.map(d => '- ' + d.id + ': ' + d.status + '; ' + d.title), '', '## Versions and workers', '', JSON.stringify({ runs: context.runs, workers: context.workers }, null, 2)];
  await fs.writeFile(path.join(dir, 'context.md'), lines.join('\n') + '\n', { mode: 0o600 });
  return context;
}

const help = 'QA campaigns (Node 22+)\n' +
  'init --campaign DIR --record campaign.json\n' +
  'scenario-add|run-add|artifact-add|execution-begin|defect-add|question|worker --campaign DIR --record record.json\n' +
  'scenario-update|execution-finish|defect-update|worker-finish --campaign DIR --id ID --record record.json\n' +
  'report --campaign DIR [--require-reconciled true]\n' +
  'plan|resume --campaign DIR [--versions versions.json]\n' +
  'sources --record sources.json --out snapshot.json\n' +
  'discover --record roots.json\n' +
  'All paths are local; registered historical runs are read only. Unregistered runs remain outside the inventory.\n';
async function main(args) {
  const command = args.shift(); if (!command || command === '--help') { console.log(help); return; }
  const options = {}; while (args.length) { const key = args.shift(); need(key.startsWith('--') && args.length, 'Use --key value'); options[key.slice(2)] = args.shift(); }
  const data = options.record ? await read(options.record) : null;
  const dir = options.campaign; let result;
  switch (command) {
    case 'init': result = await initCampaign(dir, data); break;
    case 'scenario-add': result = await addScenario(dir, data); break;
    case 'scenario-update': result = await updateScenario(dir, options.id, data); break;
    case 'run-add': result = await registerRun(dir, data); break;
    case 'artifact-add': result = await registerArtifact(dir, data); break;
    case 'execution-begin': result = await beginExecution(dir, data); break;
    case 'execution-finish': result = await finishExecution(dir, options.id, data); break;
    case 'defect-add': result = await addDefect(dir, data); break;
    case 'defect-update': result = await updateDefect(dir, options.id, data); break;
    case 'question': result = await recordQuestion(dir, data); break;
    case 'worker': result = await assignWorker(dir, data); break;
    case 'worker-finish': result = await finishWorker(dir, options.id, data); break;
    case 'report': result = await reportCampaign(dir, { require_reconciled: options['require-reconciled'] === 'true' }); result = { campaign_id: result.campaign_id, reconciled: result.reconciled, issues: result.issues, scenarios: result.scenarios.length, runs: result.runs.length }; break;
    case 'plan': case 'resume': result = await (command === 'plan' ? planCampaign : resumeCampaign)(dir, options.versions ? { versions: await read(options.versions) } : {}); break;
    case 'sources': result = await snapshotSources(data); need(options.out && !await exists(options.out), 'Use a new snapshot path'); await write(options.out, result); break;
    case 'discover': result = await discoverRuns(data); break;
    default: throw new Error('Unknown command; use --help');
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
