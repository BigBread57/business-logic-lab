#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { environmentOperation } from './lifecycle.mjs';

export const doctor = dir => environmentOperation(dir, 'doctor');
export const snapshot = dir => environmentOperation(dir, 'snapshot');
export const start = dir => environmentOperation(dir, 'start');
export const stop = dir => environmentOperation(dir, 'stop');
export const resume = dir => environmentOperation(dir, 'resume');

async function main(args) {
  const [command, option, dir, ...extra] = args;
  const operations = { doctor, snapshot, start, stop, resume };
  if (!command || command === '--help') {
    console.log('Environment: doctor|snapshot|start|stop|resume --session directory. Recipes are trusted executable argv commands.');
    return;
  }
  if (!Object.hasOwn(operations, command) || option !== '--session' || !dir || extra.length) throw new Error('Use doctor|snapshot|start|stop|resume --session directory');
  const result = await operations[command](dir);
  console.log(JSON.stringify(typeof result === 'string' ? { snapshot: result } : { namespace: result.namespace, operation: result.operation }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
