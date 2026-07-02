// Tests for the http(s) read-only provider. Spins up a tiny local
// HTTP server in the test so the provider exercises real fetch +
// response handling, then asserts the read-only contract end-to-end.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { openNoggin, verbs, NogginError } from '../noggin-api.mjs';
import { openHttpNoggin } from '../providers/http.mjs';

/**
 * Stand up a one-shot HTTP server that serves the given body at the
 * given path with the given status. Returns { url, close } where url
 * already includes the path and close() shuts the server down.
 */
async function fixtureServer({ body, status = 200, contentType = 'text/yaml', pathName = '/sample.yaml' } = {}) {
  const server = createServer((req, res) => {
    if (req.url !== pathName) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(status, { 'content-type': contentType });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}${pathName}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

const SAMPLE_YAML = `
schemaVersion: 1
active: null
items:
  - key: k1
    parentKey: null
    title: hello
    done: false
    createdAt: '2024-01-01T00:00:00.000Z'
    notes: []
  - key: k2
    parentKey: k1
    title: world
    done: false
    createdAt: '2024-01-01T00:00:01.000Z'
    notes: []
`;

describe('http provider — open + read', () => {
  it('fetches a YAML document and exposes it as a Noggin', async () => {
    const srv = await fixtureServer({ body: SAMPLE_YAML });
    try {
      const n = await openHttpNoggin(srv.url);
      assert.equal(n.location, srv.url);
      assert.equal(n.readOnly, true);
      assert.equal(n.items.length, 2);
      assert.equal(n.items[0].title, 'hello');
      assert.equal(n.items[1].title, 'world');
      // Path lookup works against the projected tree.
      const root = n.tryResolvePath('/1');
      assert.equal(root?.title, 'hello');
      await n.dispose();
    } finally {
      await srv.close();
    }
  });

  it('also works via openNoggin(http://…)', async () => {
    const srv = await fixtureServer({ body: SAMPLE_YAML });
    try {
      const n = await openNoggin(srv.url);
      assert.equal(n.location, srv.url);
      assert.equal(n.items.length, 2);
      await n.dispose();
    } finally {
      await srv.close();
    }
  });
});

describe('http provider — read-only contract', () => {
  it('apply(ops) rejects with code "read-only"', async () => {
    const srv = await fixtureServer({ body: SAMPLE_YAML });
    try {
      const n = await openHttpNoggin(srv.url);
      await assert.rejects(
        n.apply([{ type: 'setActive', key: 'k1' }]),
        (err) => err instanceof NogginError && err.code === 'read-only',
      );
      await n.dispose();
    } finally {
      await srv.close();
    }
  });

  it('every mutating verb (push/add/move/done/edit/delete/note) bubbles read-only', async () => {
    const srv = await fixtureServer({ body: SAMPLE_YAML });
    try {
      const n = await openHttpNoggin(srv.url);
      const rejectsReadOnly = (p) => assert.rejects(p, (err) => err instanceof NogginError && err.code === 'read-only');
      // Use leaf path /1/1 ('world') for done/delete so the verbs
      // don't trip pre-flight checks (e.g. done() refuses an item
      // with open descendants before reaching apply()).
      await rejectsReadOnly(verbs.push(n, { title: 'x' }));
      await rejectsReadOnly(verbs.add(n, { title: 'x' }));
      await rejectsReadOnly(verbs.done(n, { path: '/1/1' }));
      await rejectsReadOnly(verbs.edit(n, { path: '/1', title: 'x' }));
      await rejectsReadOnly(verbs.delete(n, { path: '/1/1' }));
      await rejectsReadOnly(verbs.note(n, { path: '/1', text: 'x' }));
      // Pure-read verbs still work. `show` returns null when there's
      // no active item (which the sample YAML doesn't set), but the
      // call itself must not throw — read-only ≠ disabled.
      const showed = await verbs.show(n, {});
      assert.equal(showed, null);
      await n.dispose();
    } finally {
      await srv.close();
    }
  });
});

describe('http provider — error paths', () => {
  it('raises http-error on a 404', async () => {
    const srv = await fixtureServer({ body: '', status: 404, pathName: '/missing.yaml' });
    try {
      await assert.rejects(
        openHttpNoggin(srv.url),
        (err) => err instanceof NogginError && err.code === 'http-error',
      );
    } finally {
      await srv.close();
    }
  });

  it('raises http-invalid-yaml when the response is HTML, not YAML', async () => {
    // Typical user mistake: pasted a GitHub HTML page URL that we
    // couldn't canonicalize (e.g. a tree view, not a blob view).
    const html = '<!doctype html><html><body>nope</body></html>';
    const srv = await fixtureServer({ body: html, contentType: 'text/html' });
    try {
      await assert.rejects(
        openHttpNoggin(srv.url),
        (err) => err instanceof NogginError && err.code === 'http-invalid-yaml',
      );
    } finally {
      await srv.close();
    }
  });

  it('raises http-fetch-failed when the host is unreachable', async () => {
    // Use port 1 — reserved, nothing should ever be listening there.
    await assert.rejects(
      openHttpNoggin('http://127.0.0.1:1/noggin.yaml'),
      (err) => err instanceof NogginError && err.code === 'http-fetch-failed',
    );
  });
});
