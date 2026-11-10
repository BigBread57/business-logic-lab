import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

async function walk(dir) {
  const names = await fs.readdir(dir, { withFileTypes: true });
  return (await Promise.all(names.filter(n => !['work', 'runs', 'node_modules', '.git'].includes(n.name)).map(n => n.isDirectory() ? walk(path.join(dir, n.name)) : [path.join(dir, n.name)]))).flat();
}
const files = await walk('.');
for (const file of files) {
  if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', file]);
  if (file.endsWith('.json')) JSON.parse(await fs.readFile(file, 'utf8'));
  if (file.endsWith('.md')) {
    const text = await fs.readFile(file, 'utf8');
    for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:|^#|^</i.test(link)) continue;
      await fs.access(path.resolve(path.dirname(file), link.split('#')[0]));
    }
  }
}
console.log(`Checked syntax, JSON and Markdown links in ${files.length} files`);
