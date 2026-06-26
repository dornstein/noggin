#!/usr/bin/env node
// Launch a VS Code Extension Development Host that has Chromium DevTools
// Protocol enabled on port 9224, so scripts/dev/inspect-extension-webview.mjs
// can attach to its webview.
//
// We use a separate user-data-dir + extensions-dir so:
//   - this dev host doesn't fight your main VS Code window over the
//     single-instance lock (the regular `code` CLI tends to attach to
//     an existing window and silently drop any --remote-debugging-port
//     flag),
//   - it gets a clean profile each run, with no installed extensions
//     interfering with the noggin extension under test.
//
// Usage:
//   node scripts/dev/launch-extension-host.mjs [optional-noggin-file]
//
// The optional argument is the noggin file to open on launch. Defaults
// to ~/.noggin.yaml.

import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const extensionPath = join(repoRoot, 'extension');
const nogginFile = process.argv[2] || join(homedir(), '.noggin.yaml');
const userDataDir = join(tmpdir(), 'noggin-vscode-debug');
const extensionsDir = join(tmpdir(), 'noggin-vscode-debug-ext');

const isWindows = process.platform === 'win32';
const cmd = isWindows ? 'code.cmd' : 'code';
const args = [
  '--new-window',
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  '--remote-debugging-port=9224',
  `--extensionDevelopmentPath=${extensionPath}`,
  nogginFile,
];

console.log('Launching VS Code Extension Development Host with CDP on port 9224.');
console.log('  extension:', extensionPath);
console.log('  noggin file:', nogginFile);
console.log('  user data dir:', userDataDir);
console.log('');
console.log('After the window opens, click the Noggin icon in the activity');
console.log('bar so the webview mounts. Then run:');
console.log('  node scripts/dev/inspect-extension-webview.mjs');
console.log('');

const child = spawn(cmd, args, {
  detached: true,
  stdio: 'ignore',
  shell: isWindows,
});
child.unref();

console.log('Spawned VS Code (PID ' + child.pid + '). You can close this terminal.');
