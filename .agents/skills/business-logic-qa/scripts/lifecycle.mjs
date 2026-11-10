#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sanitize } from './qa.mjs';

const exec = promisify(execFile);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secrets = () => Object.entries(process.env).filter(([key]) => /TOKEN|PASSWORD|SECRET|AUTH|API_KEY/.test(key)).map(([, value]) => value).filter(Boolean);
async function save(dir, state) {
  const file = path.join(dir, 'environment.json'); const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await fs.rename(tmp, file);
}
function validateRecipe(recipe) {
  need(recipe && Array.isArray(recipe.prepare) && recipe.prepare.length > 0 && Array.isArray(recipe.cleanup) && (recipe.cleanup.length > 0 || recipe.retention === 'preserve'), 'Recipe needs preparation and cleanup');
  need(recipe.retention === undefined || ['ephemeral', 'preserve'].includes(recipe.retention), 'Invalid retention policy');
  if (recipe.resources !== undefined) {
    need(Array.isArray(recipe.resources) && recipe.resources.length <= 100, 'Invalid resources');
    const ids = new Set();
    for (const resource of recipe.resources) {
      need(resource && /^[a-zA-Z0-9_-]{1,80}$/.test(resource.id) && !ids.has(resource.id) && resource.owner === '${namespace}', 'Invalid resource ownership');
      ids.add(resource.id);
    }
  }
  for (const phase of ['prepare', 'cleanup', 'doctor', 'snapshot', 'start', 'stop']) {
    if (recipe[phase] === undefined && !['prepare', 'cleanup'].includes(phase)) continue;
    need(Array.isArray(recipe[phase]), 'Invalid lifecycle commands');
    const ids = new Set(); need(recipe[phase].length <= 100, 'Too many lifecycle commands');
    for (const command of recipe[phase]) {
      need(/^[a-zA-Z0-9_-]{1,80}$/.test(command.id) && !ids.has(command.id), 'Invalid/duplicate command ID'); ids.add(command.id);
      need(Array.isArray(command.argv) && command.argv.length > 0 && command.argv.every(v => typeof v === 'string'), 'Use nonempty argv without shell');
      need(Number.isSafeInteger(command.timeout_ms) && command.timeout_ms > 0 && command.timeout_ms <= 600000, 'Lifecycle command needs timeout 1..600000 ms');
      if (command.cwd !== undefined) need(typeof command.cwd === 'string', 'Invalid command cwd');
      if (command.env !== undefined) need(command.env && typeof command.env === 'object' && !Array.isArray(command.env) && Object.values(command.env).every(v => typeof v === 'string'), 'Command env must contain string references');
    }
  }
}
function render(value, context) {
  if (Array.isArray(value)) return value.map(v => render(v, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, render(v, context)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const replacement = key.startsWith('env:') ? process.env[key.slice(4)] : context[key];
    need(typeof replacement === 'string' && replacement.length > 0, `Missing lifecycle variable ${key}`); return replacement;
  });
}
async function locked(dir, fn) {
  const lock = path.join(dir, 'environment.lock'); await fs.mkdir(lock);
  try { return await fn(); } finally { await fs.rmdir(lock); }
}
async function commands(dir, state, phase, options = {}) {
  state.steps[phase] ??= {};
  const failures = [];
  const secretValues = [...secrets(), ...[...JSON.stringify(state.recipe).matchAll(/\$\{env:([A-Z_][A-Z0-9_]*)\}/g)].map(match => process.env[match[1]]).filter(Boolean)];
  for (const command of state.recipe[phase]) {
    if (state.steps[phase][command.id]?.status === 'completed') continue;
    const rendered = render(command, { session: path.resolve(dir), namespace: state.namespace });
    const log = `${phase}-${command.id}${options.runId ? `-${options.runId}` : ''}.log`;
    state.steps[phase][command.id] = { status: 'active', started_at: new Date().toISOString() }; await save(dir, state);
    let execution;
    try {
      execution = exec(rendered.argv[0], rendered.argv.slice(1), { cwd: rendered.cwd ?? dir, env: { ...process.env, ...rendered.env }, timeout: rendered.timeout_ms, killSignal: 'SIGKILL', detached: process.platform !== 'win32', maxBuffer: 2 * 1024 * 1024 });
      const result = await execution;
      const output = sanitize(result.stdout + result.stderr, secretValues);
      await fs.writeFile(path.join(dir, log), output, { mode: 0o600 });
      state.steps[phase][command.id] = { ...state.steps[phase][command.id], status: 'completed', finished_at: new Date().toISOString(), log, output }; await save(dir, state);
    } catch (error) {
      // Docker and other CLIs can spawn plugins: stop the owned process group before cleanup.
      if (process.platform !== 'win32' && execution?.child?.pid) {
        try { process.kill(-execution.child.pid, 'SIGKILL'); } catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      }
      const output = sanitize((error.stdout ?? '') + (error.stderr ?? ''), secretValues);
      await fs.writeFile(path.join(dir, log), output, { mode: 0o600 });
      const summary = error.killed ? 'Lifecycle command timeout/killed; reconcile external effects' : sanitize((error.stderr || error.message).slice(-4000), secretValues);
      state.steps[phase][command.id] = { ...state.steps[phase][command.id], status: 'failed', error: summary, log, output }; await save(dir, state);
      const failure = `${phase}/${command.id}: ${summary}`;
      if (!options.continueOnFailure) throw new Error(failure);
      failures.push(failure);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
}
export async function prepareEnvironment(recipe, dir) {
  validateRecipe(recipe);
  const publicRecipe = structuredClone(recipe);
  for (const phase of ['prepare', 'cleanup', 'doctor', 'snapshot', 'start', 'stop']) for (const command of publicRecipe[phase] ?? []) {
    for (const [key, value] of Object.entries(command.env ?? {})) if (/TOKEN|PASSWORD|SECRET|AUTH|API_KEY/i.test(key)) {
      need(/^\$\{env:[A-Z_][A-Z0-9_]*\}$/.test(value), 'Credential env values must reference the environment');
      delete command.env[key];
    }
  }
  need(JSON.stringify(publicRecipe) === JSON.stringify(sanitize(publicRecipe, secrets())), 'Recipe contains credentials; use environment references');
  // Validate every substitution before creating any external resource.
  const namespace = `bll-${crypto.randomUUID()}`;
  render(recipe, { session: path.resolve(dir), namespace });
  await fs.mkdir(path.dirname(path.resolve(dir)), { recursive: true }); await fs.mkdir(dir, { mode: 0o700 });
  const state = { namespace, session: path.resolve(dir), recipe, recipe_sha256: digest(recipe), ownership_sha256: digest({ namespace, session: path.resolve(dir), resources: recipe.resources ?? [] }), preparation: 'active', cleanup: 'not-run', steps: {}, created_at: new Date().toISOString() };
  await save(dir, state);
  try {
    return await locked(dir, async () => {
      try { await commands(dir, state, 'prepare'); state.preparation = 'completed'; await save(dir, state); return state; }
      catch (error) { state.preparation = 'failed'; await save(dir, state); throw error; }
    });
  } catch (error) {
    if (recipe.retention === 'preserve') throw error;
    try { await cleanupEnvironment(dir); } catch (cleanup) { throw new Error(`${error.message}; cleanup required: ${cleanup.message}`); }
    throw error;
  }
}
function validateState(dir, state) {
  need(state.session === path.resolve(dir) && /^bll-[0-9a-f-]{36}$/.test(state.namespace) && digest(state.recipe) === state.recipe_sha256, 'Environment snapshot changed; reconcile before operation');
  if (state.recipe.retention === 'preserve' || state.recipe.resources !== undefined) need(typeof state.ownership_sha256 === 'string', 'Environment ownership missing; reconcile before operation');
  if (state.ownership_sha256 !== undefined) need(state.ownership_sha256 === digest({ namespace: state.namespace, session: state.session, resources: state.recipe.resources ?? [] }), 'Environment ownership changed; reconcile before operation');
  validateRecipe(state.recipe);
}
export async function cleanupEnvironment(dir) {
  return locked(dir, async () => {
    const state = JSON.parse(await fs.readFile(path.join(dir, 'environment.json'), 'utf8'));
    validateState(dir, state);
    need(state.recipe.retention !== 'preserve', 'Preserve policy refuses cleanup');
    if (state.cleanup === 'completed') return state;
    state.cleanup = 'active'; await save(dir, state);
    try { await commands(dir, state, 'cleanup'); state.cleanup = 'completed'; }
    catch (error) { state.cleanup = 'failed'; await save(dir, state); throw error; }
    await save(dir, state); return state;
  });
}
export async function withEnvironment(recipe, dir, fn) {
  const state = await prepareEnvironment(recipe, dir);
  try { return await fn(state); } finally { if (recipe.retention !== 'preserve') await cleanupEnvironment(dir); }
}

export async function environmentOperation(dir, phase) {
  need(['doctor', 'snapshot', 'start', 'stop', 'resume'].includes(phase), 'Invalid environment operation');
  return locked(dir, async () => {
    const state = JSON.parse(await fs.readFile(path.join(dir, 'environment.json'), 'utf8'));
    validateState(dir, state);
    need(state.cleanup !== 'completed', 'Environment has been cleaned up');
    need(state.operation?.status !== 'active', 'Interrupted environment operation requires reconciliation');
    const commandPhase = phase === 'resume' ? 'start' : phase;
    state.steps[commandPhase] = {};
    const runId = crypto.randomUUID();
    state.operation = { id: runId, phase, status: 'active', started_at: new Date().toISOString(), checks: state.steps[commandPhase] };
    state.operations ??= []; state.operations.push(state.operation); await save(dir, state);
    if (phase !== 'snapshot' && !state.recipe[commandPhase]?.length) {
      state.operation.status = 'unavailable'; state.operation.error = `${phase} unavailable: no commands configured`; await save(dir, state);
      throw new Error(state.operation.error);
    }
    try {
      if (state.recipe[commandPhase]) await commands(dir, state, commandPhase, { runId, continueOnFailure: phase === 'doctor' });
      state.operation.status = 'completed'; state.operation.finished_at = new Date().toISOString(); await save(dir, state);
    } catch (error) { state.operation.status = 'failed'; state.operation.error = error.message; await save(dir, state); throw error; }
    if (phase !== 'snapshot') return state;
    const snapshots = path.join(dir, 'snapshots'); await fs.mkdir(snapshots, { recursive: true, mode: 0o700 });
    const file = path.join(snapshots, `${crypto.randomUUID()}.json`);
    await fs.writeFile(file, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
    return file;
  });
}

async function main(args) {
  const command = args.shift(); const opts = {};
  if (!command || command === '--help') { console.log('Lifecycle: prepare --recipe file --out directory; cleanup --session directory. Recipes are trusted executable argv commands. Preparation failures trigger owned cleanup.'); return; }
  while (args.length) { const key = args.shift(); need(key.startsWith('--') && args.length, 'Use --key value'); opts[key.slice(2)] = args.shift(); }
  let result;
  if (command === 'prepare') result = await prepareEnvironment(JSON.parse(await fs.readFile(opts.recipe, 'utf8')), opts.out);
  else if (command === 'cleanup') result = await cleanupEnvironment(opts.session);
  else throw new Error('Unknown lifecycle command');
  console.log(JSON.stringify({ namespace: result.namespace, preparation: result.preparation, cleanup: result.cleanup }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
