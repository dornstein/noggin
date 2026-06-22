// Smoke test: spawn the MCP bundle and confirm tools/list returns >0 tools.
// Used by CI and locally after sync-skill to catch regressions like the
// missing-deps crash that Codex hit in 0.1.0.

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'plugin', 'skills', 'noggin', 'noggin-mcp.bundle.mjs');

const child = spawn(process.execPath, [bundlePath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, NOGGIN_FILE: path.join(repoRoot, '.smoke-test-noggin.yaml') },
});

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'noggin-smoke', version: '0.0.0' },
  },
};
const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list' };

child.stdin.write(JSON.stringify(initialize) + '\n');
child.stdin.write(JSON.stringify(listTools) + '\n');

let buf = '';
let pass = false;
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 2) {
      const tools = msg.result?.tools ?? [];
      console.log(`tools/list returned ${tools.length} tools:`);
      for (const t of tools) console.log(`  - ${t.name}`);
      pass = tools.length > 0;
      child.kill();
    }
  }
});

child.on('exit', () => {
  if (!pass) {
    console.error('smoke test FAILED');
    process.exit(1);
  }
  console.log('smoke test OK');
  process.exit(0);
});

child.stdin.on('error', () => {/* EPIPE when we kill the child mid-write — fine */});

setTimeout(() => {
  console.error('smoke test timed out after 10s');
  child.kill();
  process.exit(1);
}, 10000).unref();
