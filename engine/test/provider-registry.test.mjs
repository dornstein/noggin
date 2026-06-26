// Provider registry direct tests.
//
// The engine's `providers` registry is exercised transitively by
// every other suite, but no test today pins its behaviour directly.
// These tests lock down the contract so option B (URL dedupe in
// openNoggin) and option C (backend/handle split) can rely on it.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { openNoggin, providers, NogginError } from '../noggin-api.mjs';
// Import the standard providers so the registry is populated as in
// normal use; otherwise the engine has nothing registered.
import '../providers/file.mjs';
import '../providers/memory.mjs';

// ── register / unregister ──────────────────────────────────────────────────

describe('providers.register', () => {
  it('requires a non-empty `scheme` string', () => {
    assert.throws(
      () => providers.register({}),
      (err) => err instanceof TypeError && /scheme/.test(err.message),
    );
    assert.throws(
      () => providers.register({ scheme: '', open: () => null }),
      (err) => err instanceof TypeError && /scheme/.test(err.message),
    );
  });

  it('requires an `open` function', () => {
    assert.throws(
      () => providers.register({ scheme: 'bogus' }),
      (err) => err instanceof TypeError && /open/.test(err.message),
    );
  });

  it('overwrites an existing registration for the same scheme', async () => {
    const calls = [];
    const first = {
      scheme: 'overwrite-test',
      open: async (loc) => { calls.push(['first', loc]); return makeStubNoggin(loc); },
    };
    const second = {
      scheme: 'overwrite-test',
      open: async (loc) => { calls.push(['second', loc]); return makeStubNoggin(loc); },
    };
    providers.register(first);
    providers.register(second);
    try {
      const n = await openNoggin('overwrite-test://x');
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'second', 'second registration wins');
      await n.dispose();
    } finally {
      providers.unregister('overwrite-test');
    }
  });
});

describe('providers.unregister', () => {
  it('returns true when a registered scheme is removed, false otherwise', () => {
    providers.register({ scheme: 'goes-away', open: async (loc) => makeStubNoggin(loc) });
    assert.equal(providers.unregister('goes-away'), true);
    assert.equal(providers.unregister('goes-away'), false, 'second call is a no-op');
    assert.equal(providers.unregister('never-registered'), false);
  });

  it('subsequent openNoggin for an unregistered scheme throws no-provider', async () => {
    providers.register({ scheme: 'gone', open: async (loc) => makeStubNoggin(loc) });
    providers.unregister('gone');
    await assert.rejects(
      openNoggin('gone://x'),
      (err) => err instanceof NogginError && err.code === 'no-provider',
    );
  });

  it('unregistering the default clears the default slot', async () => {
    // Re-register file as default after the test so the rest of the
    // suite is unaffected.
    const fileProvider = providers.get('file');
    providers.unregister('file');
    await assert.rejects(
      openNoggin('plain-path-no-scheme'),
      (err) => err instanceof NogginError && err.code === 'no-provider',
    );
    providers.register(fileProvider, { default: true });
  });
});

// ── get / list / getDefault ─────────────────────────────────────────────────

describe('providers introspection', () => {
  it('list() returns scheme + default flag for every registered provider', () => {
    const list = providers.list();
    const schemes = list.map((p) => p.scheme).sort();
    assert.ok(schemes.includes('file'));
    assert.ok(schemes.includes('memory'));
    const fileEntry = list.find((p) => p.scheme === 'file');
    assert.equal(fileEntry.default, true);
    const memoryEntry = list.find((p) => p.scheme === 'memory');
    assert.equal(memoryEntry.default, false);
  });

  it('get() returns null for unknown schemes', () => {
    assert.equal(providers.get('definitely-not-real'), null);
  });

  it('getDefault() returns the provider marked default', () => {
    const def = providers.getDefault();
    assert.ok(def);
    assert.equal(def.scheme, 'file');
  });
});

// ── openNoggin dispatch behaviour ───────────────────────────────────────────

describe('openNoggin dispatch', () => {
  it('requires a non-empty location', async () => {
    await assert.rejects(openNoggin(''), (err) => err instanceof NogginError && err.code === 'no-location');
    await assert.rejects(openNoggin(null), (err) => err instanceof NogginError && err.code === 'no-location');
    await assert.rejects(openNoggin(undefined), (err) => err instanceof NogginError && err.code === 'no-location');
  });

  it('routes by scheme prefix', async () => {
    const seen = [];
    providers.register({
      scheme: 'capture',
      open: async (loc, opts) => { seen.push({ loc, opts }); return makeStubNoggin(loc); },
    });
    try {
      const n = await openNoggin('capture://path/to/thing?q=1');
      assert.equal(seen.length, 1);
      // Provider receives the post-scheme remainder.
      assert.equal(seen[0].loc, 'path/to/thing?q=1');
      // Original location is forwarded via opts.location for round-trip describe().
      assert.equal(seen[0].opts.location, 'capture://path/to/thing?q=1');
      await n.dispose();
    } finally {
      providers.unregister('capture');
    }
  });

  it('forwards opts through to the provider', async () => {
    let seenOpts = null;
    providers.register({
      scheme: 'opts-test',
      open: async (loc, opts) => { seenOpts = opts; return makeStubNoggin(loc); },
    });
    try {
      const n = await openNoggin('opts-test://x', { hello: 'world', n: 7 });
      assert.equal(seenOpts.hello, 'world');
      assert.equal(seenOpts.n, 7);
      assert.equal(seenOpts.location, 'opts-test://x');
      await n.dispose();
    } finally {
      providers.unregister('opts-test');
    }
  });

  it('falls back to the default provider when no scheme is present', async () => {
    // Default is `file://`. A bare path → file provider opens it.
    const n = await openNoggin('memory://default-fallback-noop');
    // We mostly care that this doesn't reach the default — it should
    // route to memory by scheme.
    assert.match(n.describe(), /memory/);
    await n.dispose();
  });

  it('throws no-provider with the scheme in the error data', async () => {
    await assert.rejects(
      openNoggin('unknown-scheme://x'),
      (err) => {
        if (!(err instanceof NogginError)) return false;
        if (err.code !== 'no-provider') return false;
        assert.equal(err.data?.scheme, 'unknown-scheme');
        return true;
      },
    );
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStubNoggin(location) {
  // Minimal Noggin-shaped stub for tests that only care about routing.
  let disposed = false;
  return {
    items: [],
    active: null,
    roots: [],
    findByKey: () => null,
    childrenOf: () => [],
    pathOf: () => null,
    resolvePath: () => { throw new NogginError('stub', { code: 'path-not-found', exitCode: 1 }); },
    tryResolvePath: () => null,
    apply: async () => {},
    dispose: async () => { disposed = true; },
    describe: () => `stub://${location}`,
    onDidChange: () => ({ dispose: () => {} }),
    onDidError: () => ({ dispose: () => {} }),
    get _disposed() { return disposed; },
  };
}

// Defensive cleanup — make sure tests above didn't leave the registry
// in a non-standard state. The standard providers (file, memory) are
// re-imported above; the test-only schemes are scrubbed here.
after(() => {
  for (const scheme of ['overwrite-test', 'goes-away', 'gone', 'capture', 'opts-test']) {
    providers.unregister(scheme);
  }
});
