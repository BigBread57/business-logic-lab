import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { performAction } from './qa.mjs';

const check = (value, message) => { if (!value) throw new Error(message); };
const bytes = value => {
  if (value === null) return null;
  check(Buffer.isBuffer(value) || value instanceof Uint8Array, 'Envelope values must be bytes or null');
  return Buffer.from(value).toString('base64');
};
const unbytes = value => {
  if (value === null) return null;
  check(typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'Invalid base64 bytes');
  return Buffer.from(value, 'base64');
};

// Envelope metadata must be JSON-safe; key, value and header values are bytes or null.
export function encodeEnvelope(message) {
  check(message && Array.isArray(message.headers), 'Envelope needs ordered headers');
  return { ...message, key: bytes(message.key), value: bytes(message.value), headers: message.headers.map(pair => {
    check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string', 'Invalid header');
    return [pair[0], bytes(pair[1])];
  }), encoding: 'base64' };
}

export function decodeEnvelope(message) {
  check(message?.encoding === 'base64' && Array.isArray(message.headers), 'Invalid envelope encoding');
  const { encoding, ...rest } = message;
  return { ...rest, key: unbytes(message.key), value: unbytes(message.value), headers: message.headers.map(pair => {
    check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string', 'Invalid header');
    return [pair[0], unbytes(pair[1])];
  }) };
}

// Raw evidence is intentionally separate from sanitized business results.
export async function saveEvidence(run, kind, value) {
  check(/^[a-z0-9-]+$/.test(kind), 'Invalid evidence kind');
  const relative = path.join('evidence', 'adapters', `${kind}-${crypto.randomUUID()}.json`);
  const destination = path.join(run, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.writeFile(destination, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return relative;
}

const permissions = { publish: 'mutate', read: 'read', offsets: 'read', query: 'read', documentRead: 'read', search: 'read', metadata: 'read', injectFault: 'fault', recoverFault: 'fault' };
export function createAdapter({ run, actor, adapter, resource, client }) {
  check(run && actor && adapter && resource && client, 'Adapter needs run, actor, adapter, resource and client');
  const api = {};
  for (const [operation, permission] of Object.entries(permissions)) {
    api[operation] = async input => {
      check(typeof client[operation] === 'function', `Client does not implement ${operation}`);
      if (operation === 'injectFault') check(Number.isInteger(input?.duration_ms) && input.duration_ms > 0 && input.duration_ms <= 60000, 'Fault duration_ms must be between 1 and 60000');
      // Database queries are read-only by default; mutation must be explicitly admitted.
      const actualPermission = operation === 'query' && input?.permission === 'mutate' ? 'mutate' : permission;
      return performAction(run, { actor, adapter, resource, permission: actualPermission, operation }, ({ signal, lease }) => client[operation](input, { signal, deadline: lease.deadline, actionId: lease.id }));
    };
  }
  api.withFault = async (fault, fn) => {
    check(typeof fn === 'function', 'Fault operation needs a callback');
    const handle = await api.injectFault(fault);
    try { return await fn(handle); } finally { await api.recoverFault(handle); }
  };
  return api;
}

export function createChain(run, { correlation, stages, saved = null }) {
  check(correlation && typeof correlation === 'object' && !Array.isArray(correlation), 'Chain needs correlation');
  check(Array.isArray(stages) && stages.length > 0 && stages.every(s => typeof s === 'string' && s.trim()) && new Set(stages).size === stages.length, 'Chain needs unique stages');
  const id = saved?.id ?? crypto.randomUUID(), initial = saved?.stages ?? stages.map(stage => ({ stage, state: 'pending' }));
  let entries = initial, pending = Promise.resolve();
  const tracker = { id, observe(stage, observation) {
    const work = pending.then(async () => {
      check(stages.includes(stage), 'Unknown stage');
      check(['present', 'absent', 'not_observable', 'window_elapsed'].includes(observation?.state), 'Invalid observation state');
      check(typeof observation.provenance === 'string' && observation.provenance.trim(), 'Observation needs provenance');
      if (observation.state === 'window_elapsed') check(Number.isFinite(observation.window_ms) && observation.window_ms > 0, 'Elapsed window needs window_ms');
      const updated = entries.map(e => e.stage === stage ? { ...observation, stage, observed_at: new Date().toISOString() } : e);
      const receipt = { id, correlation: structuredClone(correlation), stages: structuredClone(updated), incomplete: updated.filter(e => e.state !== 'present').map(e => e.stage), recorded_at: new Date().toISOString() };
      const evidence = await saveEvidence(run, 'chain', receipt);
      entries = updated;
      return { ...receipt, evidence };
    });
    pending = work.catch(() => {});
    return work;
  }, checkpoint() {
    const work = pending.then(async () => {
      const receipt = { id, correlation: structuredClone(correlation), stages: structuredClone(entries), incomplete: entries.filter(e => e.state !== 'present').map(e => e.stage), recorded_at: new Date().toISOString() };
      const evidence = await saveEvidence(run, 'chain', receipt);
      return { ...receipt, evidence };
    });
    pending = work.catch(() => {}); return work;
  } };
  return tracker;
}

export async function resumeChain(run, snapshot) {
  check(typeof snapshot === 'string' && !path.isAbsolute(snapshot), 'Chain snapshot must be relative to run');
  const root = await fs.realpath(run), file = await fs.realpath(path.resolve(run, snapshot));
  check(file.startsWith(root + path.sep), 'Chain snapshot escaped run');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  check(typeof saved.id === 'string' && /^[a-f0-9-]{36}$/.test(saved.id) && Array.isArray(saved.stages), 'Invalid chain snapshot');
  check(saved.stages.every(e => ['pending', 'present', 'absent', 'not_observable', 'window_elapsed'].includes(e.state) && (e.state === 'pending' || typeof e.provenance === 'string' && e.provenance.trim())), 'Invalid saved stage');
  return createChain(run, { correlation: saved.correlation, stages: saved.stages.map(s => s.stage), saved });
}
