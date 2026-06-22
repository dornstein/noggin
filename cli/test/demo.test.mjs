// Regression guard for scripts/build-demo-html.mjs.
//
// The demo harness spawns the CLI with a seeded $NOGGIN file and renders
// the result into the public /demo/ page. A silent breakage there (e.g.
// a renamed env var) makes every seeded scenario fall back to errors
// like "no active item" / "path not found" without anything in CI
// noticing.
//
// This test runs every scenario through the harness and asserts that
// any scenario outside the "errors" section exits 0 in both human and
// JSON modes. Catches:
//   - CLI env-var contract drift ($NOGGIN rename, etc.)
//   - Seed fixture / spawn path bugs
//   - Verb regressions that turn previously-green scenarios red

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAllScenarios } from '../../scripts/build-demo-html.mjs';

test('every non-error demo scenario exits 0 in both human and JSON modes', () => {
  const rows = runAllScenarios();
  const failures = [];
  for (const r of rows) {
    if (r.section === 'errors') continue;
    if (r.human.code !== 0) {
      failures.push(`${r.section} :: ${r.title} (human) exit=${r.human.code} stderr=${r.human.stderr.trim()}`);
    }
    if (r.json.code !== 0) {
      failures.push(`${r.section} :: ${r.title} (json)  exit=${r.json.code} stderr=${r.json.stderr.trim()}`);
    }
  }
  assert.equal(failures.length, 0, `\n  ${failures.join('\n  ')}`);
});

test('every "errors" demo scenario exits non-zero in both modes', () => {
  const rows = runAllScenarios();
  const surprises = [];
  for (const r of rows) {
    if (r.section !== 'errors') continue;
    if (r.human.code === 0) surprises.push(`${r.title} (human) unexpectedly succeeded`);
    if (r.json.code === 0)  surprises.push(`${r.title} (json)  unexpectedly succeeded`);
  }
  assert.equal(surprises.length, 0, `\n  ${surprises.join('\n  ')}`);
});
