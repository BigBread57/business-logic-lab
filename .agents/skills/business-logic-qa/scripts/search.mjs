#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { executeScenario, sanitize } from './qa.mjs';

const need = (condition, message) => { if (!condition) throw new Error(message); };
const bound = (value, max, name) => need(Number.isSafeInteger(value) && value > 0 && value <= max, `Invalid ${name} bound`);
const secretValues = () => Object.entries(process.env).filter(([key]) => /TOKEN|SECRET|PASSWORD|AUTH|API_KEY/.test(key)).map(([, value]) => value).filter(Boolean);
async function save(filename, value) {
  const tmp = `${filename}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(sanitize(value, secretValues()), null, 2) + '\n', { mode: 0o600 }); await fs.rename(tmp, filename);
}
function validateModel(model) {
  need(Array.isArray(model.states) && model.states.length > 0 && model.states.length <= 1000 && model.states.every(s => typeof s === 'string' && s.length > 0), 'Model needs named states');
  need(new Set(model.states).size === model.states.length && model.states.includes(model.initial), 'Invalid initial/duplicate state');
  need(Array.isArray(model.transitions) && model.transitions.length > 0 && model.transitions.length <= 1000, 'Model needs transitions');
  const ids = new Set();
  for (const tr of model.transitions) {
    need(typeof tr.id === 'string' && tr.id.length > 0 && !ids.has(tr.id), 'Invalid/duplicate transition ID'); ids.add(tr.id);
    need(model.states.includes(tr.from) && model.states.includes(tr.to), 'Transition references unknown state');
  }
}
function legal(model, sequence) {
  let state = model.initial;
  for (const id of sequence) { const tr = model.transitions.find(t => t.id === id); if (!tr || tr.from !== state) return false; state = tr.to; }
  return true;
}
export function enumeratePaths(model, { max_depth = 4, max_paths = 100 } = {}) {
  validateModel(model); bound(max_depth, 30, 'depth'); bound(max_paths, 10000, 'paths');
  const queue = [{ state: model.initial, sequence: [] }]; const paths = []; const states = new Set([model.initial]); const transitions = new Set(); let truncated = false;
  // Expand only a bounded prefix, including loops and repeated operations.
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]; const next = model.transitions.filter(t => t.from === current.state);
    if (current.sequence.length === max_depth) { if (next.length) truncated = true; continue; }
    for (const tr of next) {
      if (paths.length >= max_paths) { truncated = true; break; }
      const sequence = [...current.sequence, tr.id]; paths.push(sequence); states.add(tr.to); transitions.add(tr.id); queue.push({ state: tr.to, sequence });
    }
    if (paths.length >= max_paths) { if (index < queue.length - 1) truncated = true; break; }
  }
  return { paths, states: [...states], transitions: [...transitions], truncated, max_depth, max_paths };
}

export async function minimizeSequence(sequence, evaluate, { signature, max_trials = 100, deadline = Date.now() + 60000, onTrial = async () => {} } = {}) {
  need(Array.isArray(sequence) && sequence.length <= 10000 && signature !== undefined, 'Reducer needs sequence and failure signature'); bound(max_trials, 10000, 'trials');
  const same = result => result.outcome === 'violation' && JSON.stringify(result.signature) === JSON.stringify(signature);
  let trials = 0; let stopped = false;
  async function trial(candidate) {
    if (trials >= max_trials || Date.now() >= deadline) { stopped = true; return null; }
    const entry = { index: trials++, sequence: structuredClone(candidate), outcome: 'pending' }; await onTrial(entry);
    let timer; let result;
    const controller = new AbortController();
    try {
      result = await Promise.race([Promise.resolve().then(() => evaluate(candidate, { signal: controller.signal })), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Reduction deadline reached')); }, Math.max(1, deadline - Date.now())); })]);
    } catch (error) { result = { outcome: 'blocked', error: error.message }; stopped = true; }
    finally { clearTimeout(timer); }
    need(result && ['pass', 'observed', 'violation', 'inconclusive', 'blocked'].includes(result.outcome), 'Invalid reduction outcome');
    await onTrial({ ...entry, ...result }); return result;
  }
  const original = await trial(sequence); need(original && same(original), 'Original sequence did not reproduce the failure signature');
  let current = [...sequence]; let partitions = 2;
  while (current.length && !stopped) {
    const width = Math.max(1, Math.ceil(current.length / partitions)); let reduced = false;
    for (let start = 0; start < current.length && !stopped; start += width) {
      const candidate = [...current.slice(0, start), ...current.slice(start + width)];
      const result = await trial(candidate);
      if (result && same(result)) { current = candidate; partitions = Math.max(2, partitions - 1); reduced = true; break; }
      if (result?.outcome === 'blocked') stopped = true;
    }
    if (!reduced) { if (partitions >= current.length) break; partitions = Math.min(current.length, partitions * 2); }
  }
  return { sequence: current, signature, trials, stopped, minimal: !stopped };
}

function failureSignature(result) {
  return result.assertions.filter(a => !a.passed && a.observation_outcome !== 'inconclusive').map(a => ({ rule: a.rule, path: a.path, op: a.op, expected: a.expected }));
}

export async function searchRun(dir, model, { max_depth = 4, max_paths = 100, shrink_trials = 50, out } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'run.json'), 'utf8'));
  need(manifest.profile.permissions.includes('reset'), 'State search requires reset permission');
  need(model.reset && model.probe && Array.isArray(model.reset.steps) && model.reset.steps.some(s => s.assert?.length), 'Search needs reset scenario with baseline assertions and probe');
  need(model.transitions.every(t => Array.isArray(t.steps) && t.steps.length), 'Each transition needs executable steps');
  bound(shrink_trials, 10000, 'shrink trials');
  const paths = enumeratePaths(model, { max_depth, max_paths });
  need(typeof out === 'string', 'Search needs output directory');
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true }); await fs.mkdir(out);
  const report = { ...paths, trials: [], findings: [], stopped: false }; let index = 0;
  const scenarioFor = sequence => ({ ...model.probe, steps: [...sequence.flatMap(id => model.transitions.find(t => t.id === id).steps), ...model.probe.steps] });
  const evaluate = async sequence => {
    if (!legal(model, sequence)) return { outcome: 'inconclusive', error: 'Sequence is not legal in the supplied model' };
    const id = `search-${crypto.randomUUID()}`; const record = { id, sequence, outcome: 'pending' }; report.trials.push(record);
    await save(path.join(out, `trial-${index++}.json`), record); await save(path.join(out, 'report.json'), report);
    const reset = await executeScenario(dir, model.reset, `${id}-reset`); record.reset = reset.id;
    if (reset.outcome !== 'pass') { record.outcome = 'blocked'; record.error = 'Baseline reset was not verified'; }
    else {
      const result = await executeScenario(dir, scenarioFor(sequence), id);
      Object.assign(record, { outcome: result.outcome, signature: failureSignature(result), experiment: result.id });
    }
    await save(path.join(out, `${id}.json`), record); await save(path.join(out, 'report.json'), report); return record;
  };
  try {
    for (const sequence of paths.paths) {
      if (Date.now() >= manifest.deadline) { report.stopped = true; break; }
      const result = await evaluate(sequence);
      if (result.outcome === 'blocked') { report.stopped = true; break; }
      if (result.outcome !== 'violation') continue;
      // Confirm by replaying the same baseline; a flaky non-reproduction leaves the original evidence intact.
      let reduction;
      try {
        reduction = await minimizeSequence(sequence, evaluate, { signature: result.signature, max_trials: shrink_trials, deadline: manifest.deadline,
          onTrial: record => save(path.join(out, `reduce-${result.id}-${record.index}.json`), record) });
      } catch (error) { reduction = { sequence, stopped: true, error: error.message }; }
      const replay = `replay-${result.id}.json`;
      const reduced = scenarioFor(reduction.sequence);
      // Replay includes the same verified baseline and all original expectations.
      reduced.rules = [...new Set([...(model.reset.rules ?? []), ...(reduced.rules ?? [])])];
      reduced.steps = [...model.reset.steps, ...reduced.steps];
      reduced.variables = { ...(model.reset.variables ?? {}), ...(reduced.variables ?? {}) };
      await save(path.join(out, replay), reduced);
      report.findings.push({ original: sequence, ...reduction, replay, experiment: result.id });
      await save(path.join(out, 'report.json'), report);
      if (reduction.stopped) { report.stopped = true; break; }
    }
  } catch (error) { report.stopped = true; report.error = error.message; }
  await save(path.join(out, 'report.json'), report); return report;
}

async function main(args) {
  const command = args.shift(); const opts = {};
  if (!command || command === '--help') { console.log('State exploration: paths --model file --out file [--depth N --limit N]; run --run directory --model file --out directory [--depth N --limit N --shrink-trials N]'); return; }
  while (args.length) { const key = args.shift(); need(key.startsWith('--') && args.length, 'Use --key value'); opts[key.slice(2)] = args.shift(); }
  const model = JSON.parse(await fs.readFile(opts.model, 'utf8'));
  const bounds = { max_depth: Number(opts.depth ?? 4), max_paths: Number(opts.limit ?? 100) };
  need(['paths', 'run'].includes(command) && opts.out, 'Use paths/run with --out');
  const result = command === 'paths' ? enumeratePaths(model, bounds) : await searchRun(opts.run, model, { ...bounds, shrink_trials: Number(opts['shrink-trials'] ?? 50), out: opts.out });
  if (command === 'paths') await save(opts.out, result);
  console.log(JSON.stringify({ paths: result.paths.length, trials: result.trials?.length, findings: result.findings?.length, stopped: result.stopped, truncated: result.truncated, out: opts.out }));
  if (result.stopped) process.exitCode = 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
