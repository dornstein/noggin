// Smoke test: spawn the MCP bundle and verify the new multi-noggin contract.
//
// 1. tools/list returns >0 tools.
// 2. Every tool except noggin_factories requires `noggin` in its schema.
// 3. tools/call noggin_where { noggin: <tmp> } echoes the canonical location.
// 4. tools/call noggin_where {} returns an error (no noggin param).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'plugin', 'skills', 'noggin', 'noggin-mcp.bundle.mjs');

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'noggin-mcp-smoke-'));
const nogginPath = path.join(tmpDir, 'noggin.yaml');

const child = spawn(process.execPath, [bundlePath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

function send(msg) { child.stdin.write(JSON.stringify(msg) + '\n'); }

send({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'noggin-smoke', version: '0.0.0' },
  },
});
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'noggin_where', arguments: { noggin: nogginPath } },
});
send({
  jsonrpc: '2.0', id: 4, method: 'tools/call',
  params: { name: 'noggin_where', arguments: {} },
});
// noggin_copy: src and dest are the same fresh noggin so the test is hermetic.
// We don't need to actually populate it; an empty source produces a 0-copy
// result which still exercises the dispatch path (two-noggin open + verb call).
send({
  jsonrpc: '2.0', id: 5, method: 'tools/call',
  params: { name: 'noggin_copy', arguments: { from: nogginPath, to: nogginPath } },
});

const checks = { tools: false, where: false, missing: false, copy: false };
let buf = '';

function finish(ok, msg) {
  if (msg) (ok ? console.log : console.error)(msg);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  child.kill();
  process.exit(ok ? 0 : 1);
}

function maybeDone() {
  if (checks.tools && checks.where && checks.missing && checks.copy) finish(true, 'smoke test OK');
}

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
      console.log(`tools/list returned ${tools.length} tools`);
      if (tools.length === 0) return finish(false, 'tools/list returned no tools');
      for (const t of tools) {
        const required = t.inputSchema?.required ?? [];
        // noggin_factories: introspects the server, no noggin involved.
        // noggin_copy: takes `from` + `to` (two noggins), not the standard
        // single-noggin `noggin` arg.
        if (t.name === 'noggin_factories' || t.name === 'noggin_copy') {
          if (required.includes('noggin')) return finish(false, `${t.name} should NOT require noggin`);
        } else if (!required.includes('noggin')) {
          return finish(false, `${t.name} schema is missing required: 'noggin'`);
        }
      }
      checks.tools = true;
      maybeDone();
    } else if (msg.id === 3) {
      const text = msg.result?.content?.[0]?.text;
      if (!text) return finish(false, 'noggin_where: missing content text');
      const env = JSON.parse(text);
      if (env.status !== 'ok') return finish(false, `noggin_where: status=${env.status}`);
      if (env.data !== nogginPath) return finish(false, `noggin_where: data=${JSON.stringify(env.data)}, expected ${nogginPath}`);
      console.log(`noggin_where returned: ${env.data}`);
      checks.where = true;
      maybeDone();
    } else if (msg.id === 4) {
      const text = msg.result?.content?.[0]?.text;
      if (!text) return finish(false, 'noggin_where (no noggin): missing content text');
      const env = JSON.parse(text);
      if (env.status !== 'error') return finish(false, `noggin_where (no noggin): expected error, got status=${env.status}`);
      console.log(`noggin_where (no noggin) correctly errored: ${env.error?.message}`);
      checks.missing = true;
      maybeDone();
    } else if (msg.id === 5) {
      const text = msg.result?.content?.[0]?.text;
      if (!text) return finish(false, 'noggin_copy: missing content text');
      const env = JSON.parse(text);
      if (env.status !== 'ok') return finish(false, `noggin_copy: status=${env.status} (${env.error?.message})`);
      if (typeof env.data?.copied !== 'number') return finish(false, `noggin_copy: data.copied not a number: ${JSON.stringify(env.data)}`);
      console.log(`noggin_copy returned: { copied: ${env.data.copied} }`);
      checks.copy = true;
      maybeDone();
    }
  }
});

child.stdin.on('error', () => {/* EPIPE when we kill the child mid-write — fine */});

setTimeout(() => finish(false, 'smoke test timed out after 10s'), 10000).unref();
