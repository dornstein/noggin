#!/usr/bin/env node
// Live RPC demo — wires the Phase 1 framework to a real @noggin/engine
// noggin and drives it from a fake "UI" client over MemoryTransport.
//
// Shows:
//   1. Server side wraps a real openMemoryNoggin behind an RpcServer.
//      Handlers for noggin.open / verb.push / verb.add / verb.done /
//      noggin.subscribe / noggin.snapshot.
//   2. Client side is just an RpcClient + onNotification listener.
//      Renders the noggin's items every time a noggin.changed event
//      arrives.
//   3. The full lifecycle: open, subscribe, perform a sequence of
//      verbs, watch each one round-trip through the wire, see the
//      live change events stream in.
//
// Run: node rpc/demo/live-noggin.mjs
//
// Not part of the test suite — this is the "look, it works" script.
// Phase 2 (@noggin/rpc-server) will productize the server side; for
// now it's hand-wired here so you can see the shape clearly.

import { createMemoryTransportPair } from '../src/transports/memory.ts';
import { RpcClient } from '../src/client.ts';
import { RpcServer } from '../src/server.ts';
import { verbs } from '@noggin/engine';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

// ── ANSI helpers (so demo output reads well in a terminal) ──────────
const c = {
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue:   (s) => `\x1b[34m${s}\x1b[0m`,
  purple: (s) => `\x1b[35m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
};

function banner(title) {
  console.log('\n' + c.bold(c.cyan('━━ ' + title + ' ' + '━'.repeat(Math.max(0, 60 - title.length)))));
}

function renderItems(items, activeKey) {
  if (!items.length) return c.dim('  (empty)');
  return items
    .map((it) => {
      const marker = it.key === activeKey ? c.purple('📍') : '  ';
      const done = it.done ? c.green('✅') : '  ';
      const title = it.done ? c.dim(it.title) : it.title;
      return `  ${marker} ${done} ${title}`;
    })
    .join('\n');
}

// ── Server side ─────────────────────────────────────────────────────
//
// In Phase 2 this whole block becomes:
//   import { createNogginRpcServer } from '@noggin/rpc-server';
//   createNogginRpcServer({ transport, engine, providers, hostServices });
//
// For Phase 1 we hand-wire it so the demo runs with no extra deps.

function attachNogginServer(transport) {
  const server = new RpcServer(transport);

  /** sessionId -> { noggin, subscriptions: Set<subscriptionId> } */
  const sessions = new Map();
  let nextSessionId = 0;
  let nextSubId = 0;

  server.on('noggin.open', async ({ location }) => {
    const noggin = await openMemoryNoggin({ label: location });
    const sessionId = `sess-${++nextSessionId}`;
    sessions.set(sessionId, { noggin, subscriptions: new Set() });
    const snapshot = {
      schemaVersion: 1,
      active: noggin.active?.key ?? null,
      items: [...noggin.items],
    };
    return { sessionId, snapshot, describe: noggin.describe() };
  });

  server.on('noggin.snapshot', ({ sessionId }) => {
    const sess = sessions.get(sessionId);
    if (!sess) throw mkErr('no-session', `unknown session ${sessionId}`);
    return {
      snapshot: {
        schemaVersion: 1,
        active: sess.noggin.active?.key ?? null,
        items: [...sess.noggin.items],
      },
    };
  });

  server.on('noggin.subscribe', ({ sessionId }) => {
    const sess = sessions.get(sessionId);
    if (!sess) throw mkErr('no-session', `unknown session ${sessionId}`);
    const subscriptionId = `sub-${++nextSubId}`;
    sess.subscriptions.add(subscriptionId);
    // Wire the engine's onDidChange to a noggin.changed notification.
    sess.noggin.onDidChange((changes) => {
      if (!sess.subscriptions.has(subscriptionId)) return;
      server.notify('noggin.changed', { subscriptionId, sessionId, changes });
    });
    return { subscriptionId };
  });

  // Generic verb dispatcher; every verb has the same { sessionId, opts } shape.
  for (const verbName of ['push', 'add', 'move', 'goto', 'done', 'pop', 'edit', 'note']) {
    server.on(`verb.${verbName}`, async ({ sessionId, opts }) => {
      const sess = sessions.get(sessionId);
      if (!sess) throw mkErr('no-session', `unknown session ${sessionId}`);
      return verbs[verbName](sess.noggin, opts);
    });
  }

  return server;
}

function mkErr(code, message) {
  const e = new Error(message);
  e.code = code;
  e.exitCode = 1;
  return e;
}

// ── Client side ─────────────────────────────────────────────────────
// This is the part Phase 3 will replace with a typed `RemoteNoggin`
// adapter and the optimistic update layer. For now it's a thin
// wrapper that logs every wire event so the demo is legible.

async function runClient(transport) {
  const client = new RpcClient(transport);

  // Snapshot lives only on the client; gets re-built whenever changes arrive.
  let snapshot = { items: [], active: null };

  client.onNotification((method, params) => {
    if (method === 'noggin.changed') {
      console.log(c.yellow(`  ◀ noggin.changed  (${params.changes.length} change${params.changes.length === 1 ? '' : 's'})`));
      // In a real client we'd apply the diff; for demo simplicity we
      // re-request the full snapshot after each change.
    }
  });

  banner('1. open');
  const open = await client.request('noggin.open', { location: 'demo' });
  console.log(c.green('  ▶ noggin.open'), c.dim('  → returned'), `sessionId=${open.sessionId}, describe="${open.describe}"`);
  snapshot = open.snapshot;

  banner('2. subscribe to live changes');
  const { subscriptionId } = await client.request('noggin.subscribe', { sessionId: open.sessionId });
  console.log(c.green('  ▶ noggin.subscribe'), c.dim('  → returned'), `subscriptionId=${subscriptionId}`);

  banner('3. drive a few verbs through the wire');

  const verbsToFire = [
    { name: 'verb.push', opts: { title: 'ship phase 1' } },
    { name: 'verb.add',  opts: { title: 'write the spec' } },
    { name: 'verb.add',  opts: { title: 'wire memory transport' } },
    { name: 'verb.add',  opts: { title: 'add tests' } },
    // Try to close the active item; it has open descendants, so this
    // returns a typed engine error. Caught and logged below to show
    // the engine's stable code surviving the RPC round trip.
    { name: 'verb.done', opts: {}, expectError: 'open-descendants' },
    // Now close it for real with --close-all.
    { name: 'verb.done', opts: { closeAll: true } },
    { name: 'verb.push', opts: { title: 'plan phase 2' } },
    { name: 'verb.add',  opts: { title: 'design HostServices interface' } },
  ];

  for (const v of verbsToFire) {
    try {
      const view = await client.request(v.name, { sessionId: open.sessionId, opts: v.opts });
      console.log(c.green(`  ▶ ${v.name.padEnd(11)}`), c.dim(' →'), summarizeVerbInput(v));
      // Refresh from server (Phase 3 will apply diffs from noggin.changed instead)
      const { snapshot: s } = await client.request('noggin.snapshot', { sessionId: open.sessionId });
      snapshot = s;
      process.stdout.write(c.dim('     ') + 'view: ' + (view?.targetKey ? c.cyan(view.targetKey.slice(0, 12)) : '-') + '\n');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (v.expectError && e.code === v.expectError) {
        console.log(c.red(`  ✗ ${v.name.padEnd(11)}`), c.dim(' →'), summarizeVerbInput(v));
        console.log(c.dim('     ') + c.red(`engine error: ${e.code}`) + c.dim(' — ' + e.message));
      } else {
        throw err;
      }
    }
  }

  banner('4. final state');
  console.log(renderItems(snapshot.items, snapshot.active));

  banner('5. teardown');
  client.dispose();
  console.log(c.dim('  client disposed; transport closed; server saw onDisconnect'));
}

function summarizeVerbInput(v) {
  if (v.opts?.title) return c.dim(`{ title: "${v.opts.title}" }`);
  return c.dim('{}');
}

// ── Bootstrap ───────────────────────────────────────────────────────

const { a, b } = createMemoryTransportPair();
const server = attachNogginServer(a);
server.onDisconnect(() => {
  // Give the final logs time to flush before we exit cleanly.
  setTimeout(() => process.exit(0), 50);
});

await runClient(b);
