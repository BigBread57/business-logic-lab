import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sanitize } from './qa.mjs';

const limit = 10 * 1024 * 1024;
const hash = data => createHash('sha256').update(data).digest('hex');
const secrets = () => Object.entries(process.env).filter(([k, v]) => /password|secret|token|api[_-]?key/i.test(k) && v).map(([, v]) => v);
const fail = message => { throw new Error(message); };
function decode(s) {
  return s.replace(/&([^;\s]+);|&/g, (all, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (/^#(?:\d+|x[\da-fA-F]+)$/.test(entity ?? '')) {
      const n = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n !== 0xfffe && n !== 0xffff)) return String.fromCodePoint(n);
    }
    fail('Invalid or unsupported XML entity');
  });
}
function parseXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('DTD and entity declarations are unsupported');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) fail('Invalid XML character');
  const stack = []; let root; let i = 0;
  const append = text => { if (stack.length) stack.at(-1).text += text; else if (text.trim()) fail('Text outside XML root'); };
  while (i < xml.length) {
    if (xml.startsWith('<!--', i)) { const end = xml.indexOf('-->', i + 4); if (end < 0 || xml.slice(i + 4, end).includes('--')) fail('Malformed XML comment'); i = end + 3; continue; }
    if (xml.startsWith('<![CDATA[', i)) { const end = xml.indexOf(']]>', i + 9); if (end < 0 || !stack.length) fail('Malformed CDATA'); append(xml.slice(i + 9, end)); i = end + 3; continue; }
    if (xml.startsWith('<?xml', i) && i === 0) { const end = xml.indexOf('?>', i); if (end < 0) fail('Malformed XML declaration'); i = end + 2; continue; }
    if (xml[i] !== '<') { const end = xml.indexOf('<', i); const text = xml.slice(i, end < 0 ? xml.length : end); append(decode(text)); i += text.length; continue; }
    const match = /^<\/?[A-Za-z_][\w.:-]*(?:\s+[^<>]*?)?\s*\/?>/.exec(xml.slice(i));
    if (!match) fail('Malformed or unsupported XML tag');
    const token = match[0]; i += token.length;
    if (token.startsWith('</')) { const name = /^<\/([\w.:-]+)\s*>$/.exec(token)?.[1]; if (!name || stack.pop()?.name !== name) fail('Mismatched XML tag'); continue; }
    const name = /^<([\w.:-]+)/.exec(token)[1]; const node = { name, attrs: {}, children: [], text: '' };
    let attrs = token.slice(name.length + 1, token.length - (token.endsWith('/>') ? 2 : 1));
    while (attrs.trim()) {
      const a = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"<]*"|'[^'<]*')/.exec(attrs);
      if (!a || Object.hasOwn(node.attrs, a[1])) fail('Malformed XML attributes');
      node.attrs[a[1]] = decode(a[2].slice(1, -1)); attrs = attrs.slice(a[0].length);
    }
    if (stack.length) stack.at(-1).children.push(node); else { if (root) fail('Multiple XML roots'); root = node; }
    if (!token.endsWith('/>')) stack.push(node);
  }
  if (stack.length || !root || !['testsuite', 'testsuites'].includes(root.name)) fail('Invalid JUnit root or unclosed tag');
  const cases = [];
  function visit(node, suites = []) {
    if (node.name === 'testsuites' || node.name === 'testsuite') {
      const next = node.name === 'testsuite' ? [...suites, node.attrs.name ?? null] : suites;
      for (const child of node.children) {
        if (node.name === 'testsuites' && !['testsuite', 'testcase'].includes(child.name)) fail('Invalid testsuites child');
        if (['testsuite', 'testsuites', 'testcase'].includes(child.name)) {
          if (child.name === 'testsuites') fail('Nested testsuites is unsupported');
          visit(child, next);
        }
      }
    } else if (node.name === 'testcase') {
      if (!Object.hasOwn(node.attrs, 'name')) fail('Testcase missing name');
      const outcomes = node.children.filter(c => ['failure', 'error', 'skipped'].includes(c.name));
      if (outcomes.length > 1 || node.children.some(c => ['testcase', 'testsuite', 'testsuites'].includes(c.name)) || outcomes.some(c => c.children.length)) fail('Invalid testcase structure');
      const outcome = outcomes[0];
      cases.push({ name: node.attrs.name, classname: node.attrs.classname ?? null, suites, status: outcome ? ({ failure: 'failed', error: 'error', skipped: 'skipped' })[outcome.name] : 'passed', reason: outcome ? (outcome.attrs.message ?? outcome.text ?? '') : null, details: outcome?.text ?? null, attributes: node.attrs });
    }
  }
  visit(root); return cases;
}
async function source(file) {
  const data = await fs.readFile(file); if (data.length > limit) fail('Artifact exceeds 10 MiB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  return { text, sha256: hash(data), bytes: data.length };
}
export async function importTestArtifacts(options) { return importArtifacts(options, false); }
async function captureInputs(out, inputs, safe) {
  const folder = 'captured-' + randomUUID();
  await fs.mkdir(path.join(out, folder), { mode: 0o700 });
  const evidence = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) { evidence[key] = null; continue; }
    const artifact = folder + '/' + key + (key === 'junit' ? '.xml' : '.txt');
    await fs.writeFile(path.join(out, artifact), safe(value.text), { flag: 'wx', mode: 0o600 });
    evidence[key] = { artifact, sha256: value.sha256, bytes: value.bytes };
  }
  return evidence;
}
async function importArtifacts({ out, junit, command = null, versions = null, collection = null, coverage = null, exit = null }, prepared, extraSecrets = []) {
  if (!out || !junit) fail('out and junit are required');
  if (command !== null && (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string'))) fail('command must be a nonempty argv array');
  if (versions !== null && (typeof versions !== 'object' || Array.isArray(versions))) fail('versions must be an object');
  const inputs = { junit: await source(junit), collection: collection ? await source(collection) : null, coverage: coverage ? await source(coverage) : null };
  const secretValues = [...secrets(), ...extraSecrets]; const safe = value => sanitize(value, secretValues);
  const cases = safe(parseXml(inputs.junit.text));
  if (!prepared) await fs.mkdir(out, { recursive: false, mode: 0o700 });
  const evidence = await captureInputs(out, inputs, safe);
  const result = { schema: 1, ...evidence, command: safe(command), versions: safe(versions), exit: safe(exit), cases, missing: { command: command === null, versions: versions === null, collection: !collection, coverage: !coverage }, limitation: 'Imported test evidence only; no claim of exhaustive product coverage.' };
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}
export async function runTestCommand(options) {
  const { command, timeout = 300000, cwd = process.cwd(), env = {}, ...rest } = options;
  if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string') || !Number.isInteger(timeout) || timeout < 1 || timeout > 3600000) fail('Invalid command or timeout');
  if (!rest.out || !rest.junit || typeof cwd !== 'string') fail('out, junit and valid cwd are required');
  if (!env || typeof env !== 'object' || Array.isArray(env)) fail('env must map child variable names to existing environment variable names');
  const childEnv = { ...process.env }; const extraSecrets = [];
  // A native test subprocess is an independent runner, even when this API is
  // called by node --test; inherited context otherwise suppresses its reporters.
  delete childEnv.NODE_TEST_CONTEXT;
  for (const [name, ref] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref) || !Object.hasOwn(process.env, ref)) fail('Invalid or missing environment reference');
    childEnv[name] = process.env[ref]; if (process.env[ref]) extraSecrets.push(process.env[ref]);
  }
  const outputs = Object.fromEntries(['junit', 'collection', 'coverage'].filter(key => rest[key]).map(key => [key, path.resolve(cwd, rest[key])]));
  for (const [key, file] of Object.entries(outputs)) {
    try { await fs.lstat(file); fail(`${key} output already exists`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const junit = outputs.junit;
  await fs.mkdir(rest.out, { recursive: false, mode: 0o700 });
  const logs = { stdout: [], stderr: [] }; const sizes = { stdout: 0, stderr: 0 }; const truncated = { stdout: false, stderr: false };
  const exit = await new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd, env: childEnv, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    for (const key of ['stdout', 'stderr']) child[key]?.on('data', chunk => {
      const remaining = limit - sizes[key]; if (remaining > 0) { const part = chunk.subarray(0, remaining); logs[key].push(part); sizes[key] += part.length; }
      if (chunk.length > remaining) truncated[key] = true;
    });
    let timedOut = false; let spawnError = null;
    const timer = setTimeout(() => { timedOut = true; try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }, timeout);
    child.once('error', error => { spawnError = error.message; });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timed_out: timedOut, spawn_error: spawnError }); });
  });
  const safe = value => sanitize(value, [...secrets(), ...extraSecrets]);
  for (const key of ['stdout', 'stderr']) await fs.writeFile(path.join(rest.out, `${key}.log`), safe(Buffer.concat(logs[key]).toString('utf8')), { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(rest.out, 'execution.json'), JSON.stringify(safe({ command, cwd, env_references: env, exit, truncated }), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const key of ['collection', 'coverage']) {
    if (!outputs[key]) continue;
    try { await fs.lstat(outputs[key]); } catch (error) { if (error.code !== 'ENOENT') throw error; outputs[key] = null; }
  }
  try { await fs.lstat(junit); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const available = await captureInputs(rest.out, { junit: null, collection: outputs.collection ? await source(outputs.collection) : null, coverage: outputs.coverage ? await source(outputs.coverage) : null }, safe);
    const result = safe({ schema: 1, ...available, command, versions: rest.versions ?? null, exit, cases: [], missing: { junit: true, command: false, versions: rest.versions == null, collection: !available.collection, coverage: !available.coverage }, limitation: 'JUnit was not produced; no claim of exhaustive product coverage.' });
    await fs.writeFile(path.join(rest.out, 'manifest.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  }
  return importArtifacts({ ...rest, ...outputs, command, exit }, true, extraSecrets);
}
const help = 'Usage: node test-artifacts.mjs import --out DIR --junit FILE [--command JSON_ARGV] [--versions JSON] [--collection FILE] [--coverage FILE]\n       node test-artifacts.mjs run --out DIR --junit FILE --command JSON_ARGV [--cwd DIR] [--env JSON_REFERENCES] [--timeout MS] [--versions JSON] [--collection FILE] [--coverage FILE]';
async function cli(args) {
  if (!args.length || args.includes('--help')) { console.log(help); return; }
  const action = args.shift(); if (!['import', 'run'].includes(action)) fail('Unknown command');
  const options = {};
  while (args.length) { const flag = args.shift(); if (!/^--(out|junit|command|versions|collection|coverage|timeout|cwd|env)$/.test(flag) || !args.length) fail('Invalid option'); const key = flag.slice(2); if (Object.hasOwn(options, key)) fail('Duplicate option'); const value = args.shift(); options[key] = ['command', 'versions', 'env'].includes(key) ? JSON.parse(value) : key === 'timeout' ? Number(value) : value; }
  const result = await (action === 'run' ? runTestCommand(options) : importTestArtifacts(options));
  console.log(JSON.stringify(result, null, 2));
  if (action === 'run' && (result.exit.code !== 0 || !result.junit)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
