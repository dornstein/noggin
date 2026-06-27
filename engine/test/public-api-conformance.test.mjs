// Public-API conformance test.
//
// We want the CLI (cli/noggin.mjs), the MCP server (mcp/noggin-mcp.mjs),
// and the VS Code extension (extension/src/**) to only consume symbols
// from the noggin engine that are tagged `@public` (or `@experimental`)
// in the .d.mts surface. Anything tagged `@internal` — or any runtime
// export that the surface doesn't declare at all — is off-limits.
//
// This test catches two failure modes:
//   1. Drift: someone adds a runtime export to noggin-api.mjs without
//      declaring it in noggin-api.d.mts. The CLI/extension would still
//      be able to import it, but downstream consumers (third-party
//      users of `noggin-api`) couldn't, because the type wouldn't
//      exist.
//   2. Privilege: a consumer reaches into something explicitly tagged
//      `@internal` and gains a capability we haven't promised to the
//      public surface. The first-party CLI/extension/MCP must eat the
//      same dogfood as third parties.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(HERE, '..', '..');
const engineDir = path.join(repoRoot, 'engine');
const cliDir = path.join(repoRoot, 'cli');
const mcpDir = path.join(repoRoot, 'mcp');

// ── Surface: parse .d.mts files for export → release-tag mapping ───────────

const SURFACE_FILES = [
  path.join(engineDir, 'noggin-api.d.mts'),
  path.join(engineDir, 'providers', 'file.d.mts'),
  path.join(engineDir, 'serializers', 'yaml.d.mts'),
  path.join(engineDir, 'serializers', 'json.d.mts'),
];

const TAGS = ['public', 'internal', 'experimental', 'deprecated'];

/** Parse a .d.mts file. Returns { name → { tier: 'public'|'internal'|... } }. */
function parseSurface(file) {
  const text = readFileSync(file, 'utf8');
  const exports = {};
  // Match every TSDoc block immediately followed by an export declaration.
  // Each block is `/** … */` (possibly multi-line, possibly single-line),
  // then optional whitespace, then `export <kind> <Name>`.
  const blockRe = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function|interface|type|class|const|let|var|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const block = m[1];
    const name = m[2];
    const tags = TAGS.filter((t) => new RegExp(`@${t}\\b`).test(block));
    let tier;
    if (tags.includes('internal')) tier = 'internal';
    else if (tags.includes('experimental')) tier = 'experimental';
    else if (tags.includes('public')) tier = 'public';
    else tier = 'untagged';
    exports[name] = { tier, deprecated: tags.includes('deprecated'), file };
  }
  // Also detect undocumented exports — exports that appear in the .d.mts
  // without a leading TSDoc block. They're implicitly off-contract.
  const bareRe = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|interface|type|class|const|let|var|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = bareRe.exec(text)) !== null) {
    const name = m[1];
    if (!(name in exports)) {
      exports[name] = { tier: 'untagged', deprecated: false, file };
    }
  }
  return exports;
}

const SURFACE = {};
for (const f of SURFACE_FILES) {
  Object.assign(SURFACE, parseSurface(f));
}

// ── Consumers: parse `import { … } from '<surface module>'` ───────────────────

/** Recognise an import specifier that resolves to one of the surface modules. */
function isSurfaceSpecifier(spec) {
  return (
    /(^|\/)noggin-api\.mjs$/.test(spec) ||
    /(^|\/)providers\/file\.mjs$/.test(spec) ||
    /(^|\/)serializers\/yaml\.mjs$/.test(spec) ||
    /(^|\/)serializers\/json\.mjs$/.test(spec) ||
    // Bare-specifier forms via the @noggin/engine package's exports map.
    spec === '@noggin/engine' ||
    /^@noggin\/engine\/(providers|serializers)\/(file|memory|yaml|json)$/.test(spec)
  );
}

const SURFACE_BARE_RE = /(^|\/)(?:noggin-api|providers\/file|serializers\/yaml|serializers\/json)\.mjs$/;

/** Return { name → { source, kind:'value'|'type' } } for every named import from the surface. */
function consumerImports(file) {
  const text = readFileSync(file, 'utf8');
  const found = [];
  // Distinguish `import type { … }` from `import { … }`.
  const TYPE_IMPORT_RE = /import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  const VALUE_IMPORT_RE = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  // Dynamic destructured imports: `const { a, b } = await import('…')`.
  const DYNAMIC_DESTRUCTURED_RE = /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;

  const collect = (re, kind) => {
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[2];
      if (!isSurfaceSpecifier(spec)) continue;
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (let n of names) {
        // Strip inline `type` qualifiers: `import { type Foo, bar }`.
        let nameKind = kind;
        if (n.startsWith('type ')) { nameKind = 'type'; n = n.slice(5).trim(); }
        // Strip aliasing: `original as alias`.
        const original = n.split(/\s+as\s+/)[0].trim();
        found.push({ name: original, kind: nameKind, source: spec, file });
      }
    }
  };
  collect(TYPE_IMPORT_RE, 'type');
  collect(VALUE_IMPORT_RE, 'value');
  collect(DYNAMIC_DESTRUCTURED_RE, 'value');
  return found;
}

/** Detect namespace imports (`import * as foo from '…'`) of surface modules. */
function consumerNamespaceImports(file) {
  const text = readFileSync(file, 'utf8');
  const re = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isSurfaceSpecifier(m[2])) found.push({ binding: m[1], source: m[2], file });
  }
  return found;
}

/** Detect dynamic imports that capture into a non-destructured binding,
 *  e.g. `const api = await import('…')` — that lets the consumer
 *  property-access anything and defeats the named-import check. Pure
 *  side-effect statements (`await import('…')`) and destructured forms
 *  (`const { a, b } = await import('…')`) are allowed. */
function consumerOpaqueDynamicImports(file) {
  const text = readFileSync(file, 'utf8');
  const found = [];
  // Capture binding form: `const <ident> = await import('…')`. We
  // require an identifier (not `{`) on the left — destructured forms
  // are handled by `consumerImports`.
  const re = /(?:const|let|var)\s+(\w+)\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isSurfaceSpecifier(m[2])) found.push({ binding: m[1], source: m[2], file });
  }
  return found;
}

/** Walk a directory tree and return all files matching `extensions`. */
function walk(dir, extensions) {
  const out = [];
  function recur(d) {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === 'skills' || entry === 'dist' || entry.startsWith('_dist')) continue;
        recur(full);
      } else if (extensions.some((ext) => entry.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  recur(dir);
  return out;
}

const CONSUMER_FILES = [
  path.join(cliDir, 'noggin.mjs'),
  path.join(mcpDir, 'noggin-mcp.mjs'),
  ...walk(path.join(repoRoot, 'extension', 'src'), ['.ts', '.tsx']),
  ...walk(path.join(repoRoot, 'docs', 'site', 'playground'), ['.mjs']),
  ...walk(path.join(repoRoot, 'rpc', 'src'), ['.ts']),
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('public-API conformance', () => {
  test('the surface declares at least the well-known public symbols', () => {
    const expected = [
      'NogginError', 'Noggin', 'AtomicOp', 'NogginDocument', 'Item', 'Note',
      'applyOps', 'verbs', 'providers', 'openNoggin',
      'formatSuccess', 'formatError',
      'SCHEMA_VERSION', 'RESPONSE_ENVELOPE_VERSION',
      'fileProvider',
      'fromYaml', 'toYaml', 'fromJson', 'toJson',
    ];
    const missing = expected.filter((n) => !(n in SURFACE) || SURFACE[n].tier === 'untagged');
    assert.deepEqual(missing, [], `\n  these public symbols are missing or untagged in the surface:\n  ${missing.join('\n  ')}`);
  });

  test('every runtime export of noggin-api.mjs is declared in noggin-api.d.mts', async () => {
    const mod = await import(url.pathToFileURL(path.join(engineDir, 'noggin-api.mjs')).href);
    const runtimeExports = Object.keys(mod).filter((k) => k !== 'default');
    const undeclared = runtimeExports.filter((n) => !(n in SURFACE));
    assert.deepEqual(undeclared, [], `\n  runtime exports missing from .d.mts surface:\n  ${undeclared.join('\n  ')}`);
  });

  test('no first-party consumer imports an @internal symbol from the engine surface', () => {
    const violations = [];
    for (const f of CONSUMER_FILES) {
      for (const imp of consumerImports(f)) {
        const decl = SURFACE[imp.name];
        if (!decl) {
          violations.push(`${path.relative(repoRoot, imp.file)} imports '${imp.name}' from '${imp.source}' — not declared in the surface (.d.mts)`);
          continue;
        }
        if (decl.tier === 'internal') {
          violations.push(`${path.relative(repoRoot, imp.file)} imports '${imp.name}' from '${imp.source}' — tagged @internal in ${path.relative(repoRoot, decl.file)}`);
        }
      }
    }
    assert.equal(violations.length, 0, `\n  ${violations.join('\n  ')}`);
  });

  test('consumers do not pull from non-surface engine paths (deep imports)', () => {
    // Catches sneaky paths like importing the engine's private helpers
    // module if it ever exists. The allowlist is: the three .d.mts
    // sibling .mjs files. Anything else under cli/ that isn't one of
    // those — or the extension's bundled copy of them — is a violation.
    const DEEP_RE = /from\s+['"]([^'"]+)['"]/g;
    const ALLOWED = [
      /(^|\/)noggin-api\.mjs$/,
      /(^|\/)providers\/file\.mjs$/,
      /(^|\/)providers\/memory\.mjs$/,
      /(^|\/)serializers\/yaml\.mjs$/,
      /(^|\/)serializers\/json\.mjs$/,
      // Bare-specifier forms via the @noggin/engine package's exports map.
      /^@noggin\/engine\/providers\/(file|memory)$/,
      /^@noggin\/engine\/serializers\/(yaml|json)$/,
    ];
    const violations = [];
    for (const f of CONSUMER_FILES) {
      const text = readFileSync(f, 'utf8');
      let m;
      while ((m = DEEP_RE.exec(text)) !== null) {
        const spec = m[1];
        // Only care about specifiers that point INTO the engine — relative
        // paths that include `noggin-api`, `providers/`, or `serializers/`
        // but aren't one of the surface modules.
        if (!/noggin-api|\/providers\/|\/serializers\//.test(spec)) continue;
        if (ALLOWED.some((re) => re.test(spec))) continue;
        // Type-only references to .d.mts are fine.
        if (spec.endsWith('.d.mts')) continue;
        violations.push(`${path.relative(repoRoot, f)} imports from '${spec}' — not a surface module`);
      }
    }
    assert.equal(violations.length, 0, `\n  ${violations.join('\n  ')}`);
  });

  test('consumers do not namespace-import surface modules (use named imports instead)', () => {
    // `import * as api from 'noggin-api'` exposes every export including
    // @internal ones, defeating the named-import check. The rule is: use
    // named imports so the conformance test can see what you're using.
    const violations = [];
    for (const f of CONSUMER_FILES) {
      for (const ns of consumerNamespaceImports(f)) {
        violations.push(`${path.relative(repoRoot, f)} namespace-imports '${ns.binding}' from '${ns.source}' — use named imports instead`);
      }
    }
    assert.equal(violations.length, 0, `\n  ${violations.join('\n  ')}`);
  });

  test('consumers do not use opaque dynamic imports of surface modules', () => {
    // `const api = await import('noggin-api')` captures the module
    // namespace, letting the consumer property-access anything (including
    // @internal). Allowed: side-effect (`await import('…')`) and
    // destructured (`const { a, b } = await import('…')`) forms.
    const violations = [];
    for (const f of CONSUMER_FILES) {
      for (const dyn of consumerOpaqueDynamicImports(f)) {
        violations.push(`${path.relative(repoRoot, f)} captures \`const ${dyn.binding} = await import('${dyn.source}')\` — destructure named bindings inline instead`);
      }
    }
    assert.equal(violations.length, 0, `\n  ${violations.join('\n  ')}`);
  });
});
