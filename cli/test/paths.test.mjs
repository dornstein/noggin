// CLI golden tests — path resolution syntax.
// Uses `show --json` as a read-only probe so each path syntax variant can
// be asserted via the data.path field.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture } from './helpers.mjs';

function tree() {
  // 1 root1 (active=1/2)
  //   1/1 alpha
  //     1/1/1 alpha-kid
  //   1/2 beta
  //     1/2/1 beta-kid
  //   1/3 gamma
  // 2 root2
  return buildFixture({
    active: '1/2',
    roots: [
      { title: 'root1', children: [
        { title: 'alpha', children: [{ title: 'alpha-kid' }] },
        { title: 'beta', children: [{ title: 'beta-kid' }] },
        { title: 'gamma' },
      ] },
      { title: 'root2' },
    ],
  });
}

function expectPath(file, pathArg, expected) {
  const r = runCli(['show', pathArg, '--json'], { file });
  assert.equal(r.code, 0, `${pathArg}: ${r.stderr}`);
  assert.equal(r.json.data.path, expected, `path arg ${pathArg}`);
}

function expectError(file, pathArg, errPattern) {
  const r = runCli(['show', pathArg, '--json'], { file });
  assert.equal(r.code, 1, `${pathArg}: expected error, got code ${r.code}`);
  assert.match(r.stderr, errPattern);
}

describe('path resolution', () => {
  test('absolute paths', () => {
    const n = makeTempNoggin(tree());
    try {
      expectPath(n.file, '1', '1');
      expectPath(n.file, '1/2', '1/2');
      expectPath(n.file, '1/2/1', '1/2/1');
      expectPath(n.file, '2', '2');
    } finally { n.cleanup(); }
  });

  test('. = active item', () => {
    const n = makeTempNoggin(tree());
    try { expectPath(n.file, '.', '1/2'); } finally { n.cleanup(); }
  });

  test('.. = parent of active', () => {
    const n = makeTempNoggin(tree());
    try { expectPath(n.file, '..', '1'); } finally { n.cleanup(); }
  });

  test('- and + walk siblings of active', () => {
    const n = makeTempNoggin(tree());
    try {
      expectPath(n.file, '-', '1/1');
      expectPath(n.file, '+', '1/3');
    } finally { n.cleanup(); }
  });

  test('./X resolves child of active', () => {
    const n = makeTempNoggin(tree());
    try { expectPath(n.file, './1', '1/2/1'); } finally { n.cleanup(); }
  });

  test('../X resolves sibling via parent', () => {
    const n = makeTempNoggin(tree());
    try { expectPath(n.file, '../1', '1/1'); } finally { n.cleanup(); }
  });

  test('-/X and +/X descend through adjacent sibling', () => {
    const n = makeTempNoggin(tree());
    try {
      expectPath(n.file, '-/1', '1/1/1');
      // No descendants on gamma; an error path:
      expectError(n.file, '+/1', /path not found/);
    } finally { n.cleanup(); }
  });

  test('../../X walks up twice then down', () => {
    // active=1/2/1 (beta-kid). .. = 1/2, ../.. = 1, ../../2 = 1/2 (oops same path).
    // Use ../../1 to land on a different node: 1/1 (alpha).
    const n = makeTempNoggin(buildFixture({
      active: '1/2/1',
      roots: [
        { title: 'root1', children: [
          { title: 'alpha', children: [{ title: 'alpha-kid' }] },
          { title: 'beta', children: [{ title: 'beta-kid' }] },
          { title: 'gamma' },
        ] },
        { title: 'root2' },
      ],
    }));
    try {
      expectPath(n.file, '../../1', '1/1');
    } finally { n.cleanup(); }
  });

  test('out-of-range position → exit 1', () => {
    const n = makeTempNoggin(tree());
    try { expectError(n.file, '1/9', /path not found/); } finally { n.cleanup(); }
  });

  test('non-numeric segment → exit 1', () => {
    const n = makeTempNoggin(tree());
    try { expectError(n.file, '1/abc', /not a 1-based position/); } finally { n.cleanup(); }
  });

  test('position 0 → exit 1', () => {
    const n = makeTempNoggin(tree());
    try { expectError(n.file, '1/0', /not a 1-based position/); } finally { n.cleanup(); }
  });

  test('.. above root → exit 1', () => {
    const n = makeTempNoggin(buildFixture({ active: '1', roots: [{ title: 'r' }] }));
    try { expectError(n.file, '..', /no parent/); } finally { n.cleanup(); }
  });

  test('. with no active → exit 1', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'r' }] }));
    try { expectError(n.file, '.', /no active item/); } finally { n.cleanup(); }
  });

  test('- with no previous sibling → exit 1', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/1',
      roots: [{ title: 'r', children: [{ title: 'only' }] }],
    }));
    try { expectError(n.file, '-', /no previous sibling/); } finally { n.cleanup(); }
  });

  test('+ with no next sibling → exit 1', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/1',
      roots: [{ title: 'r', children: [{ title: 'only' }] }],
    }));
    try { expectError(n.file, '+', /no next sibling/); } finally { n.cleanup(); }
  });
});
