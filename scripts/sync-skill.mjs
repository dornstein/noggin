#!/usr/bin/env node
// Sync the source-of-truth cli/ directory into the consumer packages
// that need to ship a copy of the skill + CLI:
//
//   plugin/skills/noggin/      ← consumed by the agent plugin runtime
//   extension/skills/noggin/   ← consumed by chatSkills + bundled with the .vsix
//
// Run after editing anything under cli/. Idempotent.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const src = path.join(repoRoot, 'cli');
const dests = [
  path.join(repoRoot, 'plugin', 'skills', 'noggin'),
  path.join(repoRoot, 'extension', 'skills', 'noggin'),
];

// Files to copy from cli/ into each destination.
// We deliberately do NOT copy node_modules, package-lock.json, or anything else
// — each consumer manages its own dependencies as appropriate for its runtime.
const files = ['noggin.mjs', 'SKILL.md', 'README.md', 'package.json'];

function copyFiles(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of files) {
    const from = path.join(src, name);
    if (!fs.existsSync(from)) {
      console.warn(`skip (missing): ${path.relative(repoRoot, from)}`);
      continue;
    }
    const to = path.join(destDir, name);
    fs.copyFileSync(from, to);
  }
}

for (const dest of dests) {
  copyFiles(dest);
  console.log(`synced -> ${path.relative(repoRoot, dest)}`);
}
