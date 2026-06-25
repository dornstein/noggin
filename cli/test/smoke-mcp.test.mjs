// Smoke test: the MCP server boots, responds to `tools/list`, and exposes
// the expected verb tools. Mirrors what an MCP host (Codex/VS Code) does
// on first contact, just enough to catch wiring breakage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.resolve(HERE, '..', 'noggin-mcp.mjs');

function callTool(method, params = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`MCP exited ${code}\nstderr: ${stderr}\nstdout: ${stdout}`));
        return;
      }
      const lines = stdout.split('\n').filter(Boolean);
      const responses = lines.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      const match = responses.find((r) => r.id === 1);
      if (!match) reject(new Error(`no response for id 1\nstdout: ${stdout}\nstderr: ${stderr}`));
      else resolve(match);
    });

    const init = JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
    });
    const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    child.stdin.write(init + '\n');
    child.stdin.write(req + '\n');
    child.stdin.end();
  });
}

test('MCP server responds to tools/list with the verb tools', async () => {
  const resp = await callTool('tools/list');
  assert.ok(resp.result, `no result: ${JSON.stringify(resp)}`);
  const names = resp.result.tools.map((t) => t.name);
  for (const verb of ['push', 'add', 'move', 'goto', 'done', 'pop', 'edit', 'show', 'note', 'delete', 'where']) {
    const name = `noggin_${verb}`;
    assert.ok(names.includes(name), `tools/list missing verb '${name}'; got: ${names.join(', ')}`);
  }
});
