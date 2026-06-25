#!/usr/bin/env node
// Single source of truth for the unified noggin version.
//
// One version string lives in `cli/package.json`. This script propagates
// it to every other artifact manifest (extension, plugin, plugin-codex)
// and bumps it when asked. Use it instead of editing version fields by
// hand or running `npm version` in multiple folders.
//
//   node scripts/bump-version.mjs patch        # 0.4.0 -> 0.4.1
//   node scripts/bump-version.mjs minor        # 0.4.0 -> 0.5.0
//   node scripts/bump-version.mjs major        # 0.4.0 -> 1.0.0
//   node scripts/bump-version.mjs 0.5.2        # set explicitly
//   node scripts/bump-version.mjs              # print current version
//
// Side effects (writes when not in print mode):
//   cli/package.json                            (the source)
//   cli/package-lock.json                       (top-level + packages[''] version)
//   extension/package.json                      (top-level version)
//   extension/package-lock.json                 (top-level + packages[''] version)
//   plugin/plugin.json                          (top-level version)
//   plugin/.codex-plugin/plugin.json            (top-level version)
//
// Does NOT touch the synced skill copies under plugin/skills/noggin/
// or extension/skills/noggin/. Run `node scripts/sync-skill.mjs` after
// this to update those (the CI release workflow runs both in order).

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// All artifact manifests that must carry the unified version.
// Listed in priority order — cli/package.json is the source of truth;
// the rest are propagation targets.
const ARTIFACT_PACKAGE_JSONS = [
  'cli/package.json',
  'engine/package.json',
  'extension/package.json',
  'plugin/plugin.json',
  'plugin/.codex-plugin/plugin.json',
  'desktop/package.json',
  'ui/package.json',
];

// Lock files whose top-level + packages[''].version must mirror the
// adjacent package.json.
const LOCK_FILES = [
  'cli/package-lock.json',
  'engine/package-lock.json',
  'extension/package-lock.json',
  'desktop/package-lock.json',
  'ui/package-lock.json',
];

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const BUMP_KINDS = new Set(['patch', 'minor', 'major']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function currentVersion() {
  return readJson(path.join(repoRoot, 'cli/package.json')).version;
}

function bump(current, kind) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`bump-version: cannot parse current version '${current}'`);
  let [, major, minor, patch] = m.map(Number);
  if (kind === 'patch') patch++;
  else if (kind === 'minor') { minor++; patch = 0; }
  else if (kind === 'major') { major++; minor = 0; patch = 0; }
  return `${major}.${minor}.${patch}`;
}

// Update only the FIRST `"version": "x.y.z"` line in the file. By
// convention this is the top-level `version` key in every file we
// touch — neither extension/package.json nor the lock files have
// dependency `"version"` fields above the top-level one.
function setVersionInFile(file, newVersion) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /("version"\s*:\s*)"[^"]+"/;
  if (!re.test(text)) throw new Error(`bump-version: no "version" field in ${file}`);
  const replaced = text.replace(re, `$1"${newVersion}"`);
  fs.writeFileSync(file, replaced);
}

// Lock files carry the version twice: at the top level and inside
// packages[""]. Both must move together; sweep both occurrences.
function setVersionInLock(file, newVersion) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  // Replace exactly the first two `"version": "x.y.z"` occurrences,
  // which (by lockfile v3 layout) are the root version and the
  // packages[""].version. Any dependency `version` fields appear
  // deeper in the file and are left alone.
  let replacements = 0;
  const replaced = text.replace(/("version"\s*:\s*)"[^"]+"/g, (match, prefix) => {
    if (replacements < 2) {
      replacements++;
      return `${prefix}"${newVersion}"`;
    }
    return match;
  });
  if (replacements === 0) throw new Error(`bump-version: no "version" field in ${file}`);
  fs.writeFileSync(file, replaced);
}

function run() {
  const arg = process.argv[2];

  if (!arg) {
    console.log(currentVersion());
    return;
  }

  const current = currentVersion();
  let next;
  if (BUMP_KINDS.has(arg)) {
    next = bump(current, arg);
  } else if (VERSION_RE.test(arg)) {
    next = arg;
  } else {
    console.error(`bump-version: invalid argument '${arg}'. Use patch|minor|major or an explicit X.Y.Z.`);
    process.exit(2);
  }

  if (next === current) {
    console.log(`already at ${current}`);
    return;
  }

  console.log(`${current} -> ${next}`);
  for (const rel of ARTIFACT_PACKAGE_JSONS) {
    const abs = path.join(repoRoot, rel);
    setVersionInFile(abs, next);
    console.log(`  ${rel}`);
  }
  for (const rel of LOCK_FILES) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) {
      setVersionInLock(abs, next);
      console.log(`  ${rel}`);
    }
  }
  console.log(`done. Run \`node scripts/sync-skill.mjs\` to propagate to synced copies + bundles.`);
}

run();
