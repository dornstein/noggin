// CLI golden tests — JSON output contract and exit-code mapping.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, getTarget } from './helpers.mjs';

describe('JSON envelope', () => {
  test('success envelope: status, envelopeVersion, verb, data', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.equal(typeof r.json.envelopeVersion, 'number');
      assert.equal(r.json.verb, 'push');
      assert.equal(r.json.file, undefined, 'no `file` field on the envelope');
      assert.ok('data' in r.json);
    } finally { n.cleanup(); }
  });

  test('prunes whitelisted default-value fields; keeps meaningful ones', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const d = r.json.data;
      const target = getTarget(d);
      // PRUNED — these fields equal their declared defaults:
      assert.equal(target.done, undefined, '`done: false` pruned');
      assert.equal(target.notes, undefined, '`notes: []` pruned');
      assert.equal(target.parentKey, undefined, '`parentKey: null` pruned for a root');
      // KEPT — `children: []` is meaningful (rendered, no kids exist),
      // distinct from an absent `children` field (leaf of view).
      assert.deepEqual(target.children, [], '`children: []` kept (distinct from absent)');
      // Envelope always present.
      assert.equal(d.items.length, 1, 'single root in the rendered tree');
    } finally { n.cleanup(); }
  });

  test('keeps ItemView identity fields and the recursive tree shape', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'first', '--json'], { file: n.file });
      const d = r.json.data;
      assert.equal(typeof d.targetKey, 'string');
      assert.match(d.targetKey, /^i-\d{8}-\d{6}-[0-9a-f]{6}$/);
      // Target is identified by key only — no duplicated path or ItemView at the top.
      assert.equal(d.target, undefined, 'target ItemView should not be duplicated at the top level');
      assert.equal(d.targetPath, undefined, 'targetPath should not be duplicated at the top level');
      // The full node (with derived `path` and `children` slot) is reachable by walking the tree.
      const t = getTarget(d);
      assert.equal(t.key, d.targetKey);
      assert.equal(t.path, '/1');
      assert.equal(t.title, 'first');
      assert.equal(t.position, 1);
      assert.ok(t.createdAt);
      // `done` / `parentKey` / `notes` are pruned here (defaults); see the other test.
      // Active is reported as path + key (not pruned since they aren't null here).
      assert.equal(d.activePath, '/1');
      assert.equal(d.activeKey, d.targetKey);
    } finally { n.cleanup(); }
  });

  test('recursive tree: ancestors expand to single-child arrays; target carries peer row', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/2',
      roots: [{ title: 'r', children: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }],
    }));
    try {
      const r = runCli(['show', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const { items, targetKey } = r.json.data;

      // Single root (the ancestor `r`); ancestor-siblings would be trimmed
      // anyway since there's only one root in this fixture.
      assert.equal(items.length, 1);
      assert.equal(items[0].title, 'r');
      // `r` expands to its full child row (peer row of the target).
      assert.deepEqual(items[0].children.map((c) => c.title), ['a', 'b', 'c']);
      // Target ('b') is one of those children, identified by targetKey.
      const target = items[0].children.find((c) => c.key === targetKey);
      assert.ok(target, 'target should be a child of the spine root');
      assert.equal(target.title, 'b');
      // Peers (a, c) are leaves: no `children` field at all.
      assert.equal('children' in items[0].children[0], false, 'peer a is a leaf');
      assert.equal('children' in items[0].children[2], false, 'peer c is a leaf');
      // No spine field — the recursive `items` tree replaces it.
      assert.equal(r.json.data.spine, undefined);
    } finally { n.cleanup(); }
  });

  test('--with-json prints human output then JSON envelope', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--with-json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const jsonIdx = r.stdout.indexOf('{');
      // Human rows begin with the absolute path (e.g. "/1 …").
      const humanIdx = r.stdout.indexOf('/1');
      assert.ok(humanIdx >= 0 && humanIdx < jsonIdx, 'human output should precede JSON');
      const env = JSON.parse(r.stdout.slice(jsonIdx));
      assert.equal(env.status, 'ok');
      assert.equal(env.verb, 'push');
    } finally { n.cleanup(); }
  });
});

describe('human tree formatting', () => {
  test('descends inline through the ancestor chain; ancestor-siblings are trimmed', () => {
    // Active is the deep leaf '1/3/2'. The printed tree must walk the
    // direct chain root→target and then list the target's full peer
    // row (so we can see what other siblings are around the target).
    // Siblings of ancestors (e.g. `spec`, `tests` at depth 1, or
    // `followups` at depth 0) are NOT included — they're noise relative
    // to the spine. The user can run `show 2` etc. to see them.
    const n = makeTempNoggin(buildFixture({
      active: '1/3/2',
      roots: [
        { title: 'ship', children: [
          { title: 'spec' },
          { title: 'tests' },
          { title: 'docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
        ] },
        { title: 'followups' },
      ],
    }));
    try {
      const r = runCli(['show'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const lines = r.stdout.split('\n').filter(Boolean);
      const has = (needle) => lines.some((l) => l.includes(needle));
      const idx = (needle) => lines.findIndex((l) => l.includes(needle));

      // present: spine + peer row at the target's depth.
      assert.ok(has('ship'),   'ancestor `ship` present');
      assert.ok(has('docs'),   'ancestor `docs` present');
      assert.ok(has('README'), 'peer `README` present');
      assert.ok(has('SKILL'),  'target `SKILL` present');

      // trimmed: ancestor-siblings everywhere above the target's level.
      assert.ok(!has('followups'), 'sibling of root ancestor trimmed');
      assert.ok(!has('spec'),      'sibling of intermediate ancestor trimmed');
      assert.ok(!has('tests'),     'sibling of intermediate ancestor trimmed');

      // order: root → docs → its peer row (README before SKILL).
      assert.ok(idx('ship')   < idx('docs'),   'ship before docs');
      assert.ok(idx('docs')   < idx('README'), 'docs before its children');
      assert.ok(idx('README') < idx('SKILL'),  'peer row in stable order');
    } finally { n.cleanup(); }
  });
});

describe('exit codes and stderr', () => {
  test('usage errors → exit 2 with "noggin: " prefix (no --json)', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /^noggin: /);
    } finally { n.cleanup(); }
  });

  test('errors under --json emit an error envelope on stderr', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      const env = JSON.parse(r.stderr);
      assert.equal(env.status, 'error');
      assert.equal(env.verb, 'push');
      assert.equal(env.file, undefined, 'no `file` field on the envelope');
      assert.equal(env.error.code, 'title-required');
      assert.equal(env.error.exitCode, 2);
      assert.match(env.error.message, /title required/);
    } finally { n.cleanup(); }
  });

  test('runtime errors → exit 1, error envelope under --json', () => {
    const n = makeTempNoggin(buildFixture({ active: '1', roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['goto', '/9/9', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      const env = JSON.parse(r.stderr);
      assert.equal(env.status, 'error');
      assert.equal(env.error.code, 'path-not-found');
      assert.equal(env.error.exitCode, 1);
    } finally { n.cleanup(); }
  });

  test('unknown verb → exit 2', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['frobnicate', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      const env = JSON.parse(r.stderr);
      assert.equal(env.status, 'error');
      assert.equal(env.verb, 'frobnicate');
      assert.match(env.error.message, /unknown command/);
    } finally { n.cleanup(); }
  });

  test('unknown flag → exit 2', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--bogus', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /unknown flag/);
    } finally { n.cleanup(); }
  });

  test('schema version mismatch → exit 2', () => {
    const n = makeTempNoggin('schemaVersion: 99\nactive: null\nitems: []\n');
    try {
      const r = runCli(['show', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /schemaVersion/);
    } finally { n.cleanup(); }
  });

  test('help text prints and exits 0', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['help'], { file: n.file });
      assert.equal(r.code, 0);
      assert.match(r.stdout, /working-memory tree CLI/);
      assert.match(r.stdout, /Verbs:/);
    } finally { n.cleanup(); }
  });

  test('no args prints help and exits 0', () => {
    const r = runCli([], { file: null });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /working-memory tree CLI/);
  });
});
