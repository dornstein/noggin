// Generate the CLI reference page by running `noggin help` and
// formatting its output. Keeps the docs aligned with the binary.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { esc } from '../template.mjs';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = path.join(repoRoot, 'cli', 'noggin.mjs');

export function buildCliPage() {
  const help = runCli(['help']);
  // The flags table at the bottom (file resolution, etc.) is in the
  // help text already; we just render the whole thing inside a <pre>
  // and supplement with prose at the top.
  return `
<h1>CLI reference</h1>
<p class="lead">Every verb, every flag — generated from <code>noggin help</code>
on the same build of the CLI that's published to npm. If a verb
appears here, it works in the binary.</p>

<h2>Path syntax</h2>

<p>Two forms:</p>
<ul>
  <li><strong>Absolute</strong> — starts with <code>/</code>. Walks
    1-based positions from the root: <code>/1</code> is the first
    root, <code>/1/2</code> is its second child.</li>
  <li><strong>Relative</strong> — everything else, resolved against
    the <strong>active</strong> item:
    <ul>
      <li><code>.</code> active item</li>
      <li><code>..</code> parent of active</li>
      <li><code>-</code> / <code>+</code> previous / next sibling of active</li>
      <li><code>./X</code>, <code>../X</code>, <code>-/X</code>,
        <code>+/X</code> descend further from those anchors</li>
      <li>bare <code>X</code> / <code>X/Y</code> are short for
        <code>./X</code> / <code>./X/Y</code></li>
    </ul>
  </li>
</ul>

<p>Paths are <strong>display coordinates</strong>: they shift when
items move. The <strong>key</strong> is the stable identifier.
Don't store paths long-term; use them for navigation only.</p>

<h2>Verbs and flags</h2>

<p>Below is the verbatim output of <code>noggin help</code>, generated
at build time from the current CLI:</p>

<pre><code>${esc(help.stdout)}</code></pre>

<h2>JSON output</h2>

<p>Add <code>--json</code> to any verb to print a structured
<a href="../envelope/">response envelope</a> to stdout instead of the
human view. Errors under <code>--json</code> emit an error envelope to
<strong>stderr</strong>, and the process exits with the envelope's
<code>exitCode</code> (1 for runtime errors, 2 for usage errors).</p>

<p>Add <code>--with-json</code> to get human output followed by the
JSON envelope — useful for tee'ing into both eyes and downstream
tooling.</p>

<h2>File resolution</h2>

<p>Resolution order (highest priority first):</p>
<ol>
  <li><code>--file &lt;path&gt;</code></li>
  <li><code>$NOGGIN_FILE</code></li>
  <li><code>~/.noggin.yaml</code></li>
</ol>

<p>Use <code>noggin where</code> to see which file the CLI would touch
right now (plus whether it currently exists).</p>

<h2>See it in action</h2>

<p>The <a href="../demo/">verb demo page</a> runs each verb against a
seeded tree and shows the resulting human view + JSON envelope
side-by-side.</p>
`;
}

function runCli(args) {
  // Run with a sandboxed HOME so default-file resolution can't touch
  // the dev's real ~/.noggin.yaml (matters on CI, where the home dir
  // is fresh anyway, but makes local builds deterministic too).
  const sandbox = mkdtempSync(path.join(tmpdir(), 'noggin-doc-'));
  const env = { ...process.env, HOME: sandbox, USERPROFILE: sandbox };
  delete env.NOGGIN_FILE;
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
