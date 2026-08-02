#!/usr/bin/env node
// Assembles a deployable copy of the site in dist/.
//
//   node tools/build.mjs && node tools/dist.mjs
//
// Needed because the real data is gitignored, so the repo can't be deployed
// straight from GitHub — you build locally and upload the result. dist/ holds
// exactly what a web server needs and nothing else: no CSV, no overrides, no
// build scripts, no REVIEW.md.

import { cpSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(ROOT, ...parts);
const OUT = p('dist');

if (!existsSync(p('assets', 'data.json'))) {
  console.error('\n  assets/data.json is missing — run `node tools/build.mjs` first.\n');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(p('index.html'), join(OUT, 'index.html'));
cpSync(p('assets'), join(OUT, 'assets'), { recursive: true });

// The font licences must travel with the fonts; everything else in assets/ is
// already runtime code.
const bytes = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
  const full = join(dir, e.name);
  return n + (e.isDirectory() ? bytes(full) : statSync(full).size);
}, 0);

const kb = (bytes(OUT) / 1024).toFixed(0);
console.log(`
  dist/  ${kb} KB — ready to upload

  Contains index.html + assets/ only. Drop it at any path on any static
  host; every reference is relative and routing is hash-based, so no
  server config is needed.
`);
