// Multi-page JavaScript API reference generator.
//
// Runs TypeDoc + typedoc-plugin-markdown once, then splits the
// per-module markdown into one page per exported symbol (or a tight
// cluster of related symbols — verb options, document utilities, path
// helpers, constants). The whole thing is wired to a PAGES manifest
// below so adding / renaming / grouping pages is a small local edit.
//
// Cross-references between symbols are auto-rewritten:
//   - `[Foo](#foo)` where Foo lives on a *different* page becomes a
//     relative link into that page.
//   - Same-page references keep their intra-page anchor.
//   - TypeDoc's `[Foo](../other.md#bar)` inter-module refs are
//     resolved through the same symbol-to-slug map.
//
// The overview pages for each group are hand-authored markdown under
// `pages/api/<group>/index.md` — those go through the normal page
// pipeline; this generator emits ONLY the leaf detail pages.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { renderMarkdown } from '../markdown.mjs';

// ── Paths ─────────────────────────────────────────────────────────

const here = path.dirname(url.fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const typedocOut = path.join(siteRoot, '_typedoc');
const typedocConfig = path.join(siteRoot, 'typedoc.json');
const typedocBin = path.join(siteRoot, 'node_modules', 'typedoc', 'bin', 'typedoc');

// ── Page manifest ─────────────────────────────────────────────────
//
// One entry per generated detail page. Fields:
//
//   slug     URL slug (trailing-slashed). Match template.mjs NAV.
//   title    HTML <title>. Doubles as the H1 unless `intro` supplies one.
//   intro    Optional markdown body that appears BEFORE the TypeDoc
//            symbol dumps. Typically 1–3 short paragraphs.
//   symbols  Array of {module, name} to append (in order). Each
//            symbol contributes one demoted TypeDoc section. Empty
//            means the page is intro-only.
//
// Symbol `module` is the TypeDoc module basename (`noggin-api`,
// `providers/file`, `serializers/yaml`, ...). `name` is the exact
// exported symbol name.

const PAGES = [
  // ─── Handles ──────────────────────────────────────────────────
  {
    slug: 'api/handles/noggin/',
    title: 'Noggin',
    intro: '# `Noggin`\n\nThe primary handle every consumer uses to read a noggin\'s state and drive verbs. Same shape whether the noggin lives in-process behind a provider or behind an RPC transport.\n',
    symbols: [{ module: 'noggin-api', name: 'Noggin' }],
  },
  {
    slug: 'api/handles/noggin-store/',
    title: 'NogginStore',
    intro: '# `NogginStore`\n\nExtends `Noggin` with the atomic `apply(ops)` primitive that verbs use to compose state changes. Provider implementations satisfy this; `RemoteNoggin` does not — verb code needs `apply` against locally-known state, which the wire protocol doesn\'t model.\n',
    symbols: [{ module: 'noggin-api', name: 'NogginStore' }],
  },

  // ─── Opening a noggin ─────────────────────────────────────────
  {
    slug: 'api/opening/open-noggin/',
    title: 'openNoggin',
    intro: '# `openNoggin`\n\nOpen a noggin by URI. The scheme prefix (`file://`, `memory://`, `localstorage://`, `https://`, ...) selects the provider. Hosts that take a bare filesystem path from the user must convert to `file://` at the boundary or call a provider-specific factory like `openFileNoggin`.\n',
    symbols: [{ module: 'noggin-api', name: 'openNoggin' }],
  },
  {
    slug: 'api/opening/provider-registry/',
    title: 'Provider registry',
    intro: '# Provider registry\n\nThe process-wide catalog of provider modules. Importing a provider (e.g. `import \'@noggin/engine/providers/file\'`) side-effect-registers it here. Hosts can also register custom providers programmatically.\n',
    symbols: [
      { module: 'noggin-api', name: 'providers' },
      { module: 'noggin-api', name: 'NogginProvider' },
      { module: 'noggin-api', name: 'NogginProviderRegistry' },
    ],
  },

  // ─── Verbs ────────────────────────────────────────────────────
  {
    slug: 'api/verbs/verbs/',
    title: 'verbs',
    intro: '# `verbs`\n\nThe singleton exposing every engine verb as a free function. Each `verbs.X(noggin, opts)` reads state via the noggin\'s accessors, composes an `AtomicOp[]`, calls `noggin.apply(ops)` once, and returns the resulting view. Bound method variants (`noggin.X(opts)`) are attached by `bindNogginVerbs` and delegate here.\n',
    symbols: [
      { module: 'noggin-api', name: 'verbs' },
      { module: 'noggin-api', name: 'Verbs' },
    ],
  },
  {
    slug: 'api/verbs/verb-options/',
    title: 'Verb options',
    intro: '# Verb options\n\nOne interface per verb. Each is the shape of the `opts` argument accepted by both the free function (`verbs.X(noggin, opts)`) and the bound method (`noggin.X(opts)`). `CloseOptions` is a shared mixin for the closing verbs; `GotoOption` is a mixin for the `--goto` follow-up flag.\n',
    symbols: [
      { module: 'noggin-api', name: 'PushOptions' },
      { module: 'noggin-api', name: 'AddOptions' },
      { module: 'noggin-api', name: 'MoveOptions' },
      { module: 'noggin-api', name: 'GotoOptions' },
      { module: 'noggin-api', name: 'DoneOptions' },
      { module: 'noggin-api', name: 'PopOptions' },
      { module: 'noggin-api', name: 'EditOptions' },
      { module: 'noggin-api', name: 'ShowOptions' },
      { module: 'noggin-api', name: 'NoteOptions' },
      { module: 'noggin-api', name: 'DeleteOptions' },
      { module: 'noggin-api', name: 'CopyOptions' },
      { module: 'noggin-api', name: 'CloseOptions' },
      { module: 'noggin-api', name: 'GotoOption' },
    ],
  },
  {
    slug: 'api/verbs/bind-noggin-verbs/',
    title: 'bindNogginVerbs',
    intro: '# `bindNogginVerbs`\n\nAttach bound verb methods (`push`, `add`, `move`, ...) onto a noggin instance. Providers call this in their constructors so consumers can use the ergonomic `noggin.push(opts)` form without an explicit adapter.\n',
    symbols: [{ module: 'noggin-api', name: 'bindNogginVerbs' }],
  },
  {
    slug: 'api/verbs/verb-context/',
    title: 'VerbContext',
    intro: '# `VerbContext`\n\nOptional per-call context for verbs that stamp timestamps (`push`, `add`, `note`, `done`, `pop`, `edit`). The only field today is a fixed `now` clock for deterministic timestamps in tests.\n',
    symbols: [{ module: 'noggin-api', name: 'VerbContext' }],
  },
  {
    slug: 'api/verbs/copy-result/',
    title: 'CopyResult',
    intro: '# `CopyResult`\n\nReturn value of `verbs.copy(source, dest)`. Reports how many items landed and the source-key → dest-key mapping so callers can address the newly-inserted subtree.\n',
    symbols: [
      { module: 'noggin-api', name: 'CopyResult' },
    ],
  },

  // ─── Core data model ──────────────────────────────────────────
  {
    slug: 'api/core-data-model/noggin-document/',
    title: 'NogginDocument',
    intro: '# `NogginDocument`\n\nThe serialised form of a noggin: pure data, no methods. This is what the JSON schema validates and what the file/localstorage providers read/write. Every provider constructs one at open time and re-hydrates it after `apply`.\n',
    symbols: [{ module: 'noggin-api', name: 'NogginDocument' }],
  },
  {
    slug: 'api/core-data-model/item/',
    title: 'Item & Note',
    intro: '# `Item` and `Note`\n\nA single tree entry plus its append-only note log. Notes are timestamped Markdown; the close-verb records the closure by appending a system note (see [`CLOSE_NOTE_TEXT`](../../constants/)).\n',
    symbols: [
      { module: 'noggin-api', name: 'Item' },
      { module: 'noggin-api', name: 'Note' },
    ],
  },
  {
    slug: 'api/core-data-model/item-view/',
    title: 'ItemView, ViewNode, CurrentTreeView, DeletedItem',
    intro: '# View shapes\n\nThe read-side projections verbs return. `ItemView` is an `Item` enriched with computed path + sibling position; `ViewNode` adds children (used by tree views); `CurrentTreeView` is the mutating-verb return; `DeletedItem` is the tombstone `verbs.delete` reports; `DeleteResult` is the wrapper `verbs.delete` returns with descendant counts and the updated view.\n',
    symbols: [
      { module: 'noggin-api', name: 'ItemView' },
      { module: 'noggin-api', name: 'ViewNode' },
      { module: 'noggin-api', name: 'CurrentTreeView' },
      { module: 'noggin-api', name: 'DeletedItem' },
      { module: 'noggin-api', name: 'DeleteResult' },
    ],
  },
  {
    slug: 'api/core-data-model/placement/',
    title: 'Placement',
    intro: '# `Placement`\n\nTells `add` / `move` where to put the item relative to an anchor path. Two axes: kind (`before` / `after` / `into`) and the anchor itself.\n',
    symbols: [
      { module: 'noggin-api', name: 'Placement' },
      { module: 'noggin-api', name: 'PlacementKind' },
    ],
  },
  {
    slug: 'api/core-data-model/type-aliases/',
    title: 'Type aliases',
    intro: '# Type aliases\n\nOpaque string types the rest of the API references. Kept as aliases (rather than distinct wrapper types) so consumers can treat them as plain strings; the alias name signals intent.\n',
    symbols: [
      { module: 'noggin-api', name: 'ItemKey' },
      { module: 'noggin-api', name: 'ItemPath' },
      { module: 'noggin-api', name: 'IsoTimestamp' },
    ],
  },

  // ─── Atomic ops ───────────────────────────────────────────────
  {
    slug: 'api/atomic-ops/atomic-op/',
    title: 'AtomicOp',
    intro: '# `AtomicOp`\n\nThe discriminated union every state mutation goes through. Verbs compose lists of these and pass them to `NogginStore.apply(ops)` in a single call. Providers execute the list atomically — either every op lands or none do.\n',
    symbols: [{ module: 'noggin-api', name: 'AtomicOp' }],
  },
  {
    slug: 'api/atomic-ops/apply-ops/',
    title: 'applyOps',
    intro: '# `applyOps`\n\nApply a list of `AtomicOp`s to a `NogginDocument` in-place and validate the result. Used by providers inside their `apply()`; also useful for offline document manipulation and tests. Throws `NogginError` if any op references missing data or the resulting document is malformed.\n',
    symbols: [{ module: 'noggin-api', name: 'applyOps' }],
  },
  {
    slug: 'api/atomic-ops/document-utilities/',
    title: 'Document utilities',
    intro: '# Document utilities\n\nPure functions over `NogginDocument`. `validateDocument` and `normalizeDocument` are the input-boundary defence used by every serializer; `documentsEqual` / `diffDocuments` power the change-event pipeline; `freezeDocument` is what providers hand out so accessors can return references without worrying about consumer mutation.\n',
    symbols: [
      { module: 'noggin-api', name: 'validateDocument' },
      { module: 'noggin-api', name: 'normalizeDocument' },
      { module: 'noggin-api', name: 'documentsEqual' },
      { module: 'noggin-api', name: 'diffDocuments' },
      { module: 'noggin-api', name: 'freezeDocument' },
    ],
  },

  // ─── Events ───────────────────────────────────────────────────
  {
    slug: 'api/events/item-change/',
    title: 'ItemChange & ChangeEvent',
    intro: '# `ItemChange` and `ChangeEvent`\n\nThe vocabulary `noggin.onDidChange` fires with. `ItemChange` is one observable shift (added / removed / moved / updated / activeChanged); `ChangeEvent` is a flat list of them, describing every difference between the previous and current snapshot. Same shape whether the mutation originated in-process or from the provider observing an outside write.\n',
    symbols: [
      { module: 'noggin-api', name: 'ItemChange' },
      { module: 'noggin-api', name: 'ChangeEvent' },
    ],
  },
  {
    slug: 'api/events/event-disposable/',
    title: 'Event & Disposable',
    intro: '# `Event` and `Disposable`\n\nThe subscribe primitive. Every `on…` accessor on `Noggin` matches `Event<T>`: pass a handler, get back a `Disposable` whose `dispose()` unsubscribes. Modelled after `vscode.Event`.\n',
    symbols: [
      { module: 'noggin-api', name: 'Event' },
      { module: 'noggin-api', name: 'Disposable' },
    ],
  },

  // ─── Errors ───────────────────────────────────────────────────
  {
    slug: 'api/errors/noggin-error/',
    title: 'NogginError',
    intro: '# `NogginError`\n\nThe error class every engine function throws for usage or state errors. Carries a stable `code`, a CLI-mirrored `exitCode`, and a frozen structured `data` payload. Hosts key user-facing strings off `code`; `message` is a short host-neutral fallback.\n',
    symbols: [{ module: 'noggin-api', name: 'NogginError' }],
  },
  {
    slug: 'api/errors/noggin-error-code/',
    title: 'NogginErrorCode',
    intro: '# `NogginErrorCode`\n\nThe (closed-ish) union of stable error code strings. New codes can be added without a breaking change; renamed / removed codes always are one. Hosts that render user-facing strings key off this.\n',
    symbols: [{ module: 'noggin-api', name: 'NogginErrorCode' }],
  },
  {
    slug: 'api/errors/noggin-error-data/',
    title: 'NogginErrorData',
    intro: '# `NogginErrorData`\n\nThe structured payload attached to `NogginError.data`. Each `code` carries a known set of fields; hosts pattern-match on `code` and read the fields they need. Extra fields are non-breaking.\n',
    symbols: [{ module: 'noggin-api', name: 'NogginErrorData' }],
  },

  // ─── Response envelope ────────────────────────────────────────
  {
    slug: 'api/response-envelope/json-envelope/',
    title: 'JsonEnvelope',
    intro: '# `JsonEnvelope`\n\nThe versioned wrapper the CLI\'s `--json` mode, MCP tools, and RPC responses use to carry either a successful verb result or a structured error. Discriminated on `status`.\n',
    symbols: [
      { module: 'noggin-api', name: 'JsonEnvelope' },
      { module: 'noggin-api', name: 'SuccessEnvelope' },
      { module: 'noggin-api', name: 'ErrorEnvelope' },
    ],
  },
  {
    slug: 'api/response-envelope/envelope-helpers/',
    title: 'formatSuccess & formatError',
    intro: '# `formatSuccess` and `formatError`\n\nThe canonical builders for `JsonEnvelope` values. Hosts that hand-craft envelopes would drift on the version field; these functions stamp `envelopeVersion` and unwrap engine `NogginError`s into the wire payload for you.\n',
    symbols: [
      { module: 'noggin-api', name: 'formatSuccess' },
      { module: 'noggin-api', name: 'formatError' },
    ],
  },

  // ─── Path utilities (single page) ─────────────────────────────
  {
    slug: 'api/path-utilities/',
    title: 'Path utilities',
    intro: '# Path utilities\n\nPure walkers over a `{items, active}` document snapshot. Used inside verbs and provider implementations; hosts occasionally reach for them too when they want to resolve a path against a snapshot that isn\'t behind a live `Noggin`.\n\n`Noggin` and `NogginStore` bind path-resolution helpers on the handle itself (`noggin.pathOf(item)`, `noggin.resolvePath(p)`) — use those when you have a live noggin. The free functions below are for the offline / snapshot case.\n',
    symbols: [
      { module: 'noggin-api', name: 'resolvePath' },
      { module: 'noggin-api', name: 'tryResolvePath' },
      { module: 'noggin-api', name: 'pathOf' },
      { module: 'noggin-api', name: 'childrenOf' },
      { module: 'noggin-api', name: 'buildView' },
    ],
  },

  // ─── Constants (single page) ──────────────────────────────────
  {
    slug: 'api/constants/',
    title: 'Constants',
    intro: '# Constants\n\nVersioned numbers and stable strings the rest of the engine surface refers to. `SCHEMA_VERSION` versions the on-disk document; `RESPONSE_ENVELOPE_VERSION` versions the `JsonEnvelope` wrapper; `CLOSE_NOTE_TEXT` is the exact text of the system note appended when a verb closes an item.\n',
    symbols: [
      { module: 'noggin-api', name: 'SCHEMA_VERSION' },
      { module: 'noggin-api', name: 'RESPONSE_ENVELOPE_VERSION' },
      { module: 'noggin-api', name: 'CLOSE_NOTE_TEXT' },
    ],
  },

  // ─── Serializers ──────────────────────────────────────────────
  {
    slug: 'api/serializers/yaml/',
    title: 'serializers/yaml',
    intro: '# `serializers/yaml`\n\nCanonical YAML `<->` `NogginDocument` conversion. This is the flavour every provider writes to disk / storage; hosts occasionally use these directly when they need to work with document bytes without opening a live `Noggin`.\n',
    symbols: [
      { module: 'serializers/yaml', name: 'toYaml' },
      { module: 'serializers/yaml', name: 'fromYaml' },
    ],
  },
  {
    slug: 'api/serializers/json/',
    title: 'serializers/json',
    intro: '# `serializers/json`\n\nJSON `<->` `NogginDocument` conversion. The YAML form is what noggins live in on disk; the JSON form is what the CLI\'s `--json` mode and RPC payloads use for the document body of an envelope.\n',
    symbols: [
      { module: 'serializers/json', name: 'toJson' },
      { module: 'serializers/json', name: 'fromJson' },
    ],
  },
];

// ── Public entry point ───────────────────────────────────────────

/**
 * Build every API detail page. Returns an array of
 * `{ slug, title, body }` — body is fully-rendered HTML ready to
 * hand to the page template.
 *
 * Also fails loudly (throws) when the manifest drifts from the
 * engine's public surface — see {@link auditManifest}.
 */
export function buildApiPages() {
  runTypedoc();
  const modules = loadTypedocModules();
  const symbolIndex = indexSymbols(modules);
  auditManifest(PAGES, symbolIndex);
  const anchorMap = buildAnchorMap(PAGES, symbolIndex);
  const out = [];
  for (const p of PAGES) {
    const chunks = [];
    if (p.intro) chunks.push(p.intro.trim());
    const multi = (p.symbols ?? []).length > 1;
    for (const s of (p.symbols ?? [])) {
      const section = symbolIndex.get(sectionKey(s.module, s.name));
      if (!section) {
        chunks.push(`> **Missing TypeDoc section:** \`${s.name}\` (module \`${s.module}\`). Check the entry-points in \`docs/site/typedoc.json\` or the symbol name in the manifest.\n`);
        continue;
      }
      chunks.push(presentSymbolSection(section, multi));
    }
    const md = chunks.join('\n\n');
    const rewritten = rewriteCrossRefs(md, p.slug, anchorMap);
    const html = reconcileAnchorLinks(renderMarkdown(rewritten));
    out.push({ slug: p.slug, title: p.title, body: html });
  }
  return out;
}

// ── Drift audit ──────────────────────────────────────────────────

/**
 * Fail the build if the PAGES manifest and the engine's public
 * surface have drifted. Two kinds of drift caught:
 *
 *   1. **Orphaned symbols.** TypeDoc emitted a section for a
 *      `@public` (or unmarked) symbol that the manifest doesn't
 *      route anywhere. The symbol wouldn't appear anywhere in the
 *      docs — silent invisibility. Every new engine export triggers
 *      this until someone adds it to a page.
 *
 *   2. **Ghost entries.** The manifest names a symbol the engine
 *      no longer exports. The generated page would show a
 *      "Missing TypeDoc section" blockquote instead of content.
 *
 * Provider-specific symbols (anything under `providers/`) are
 * intentionally routed to the narrative `providers/` pages rather
 * than to per-symbol API pages; see EXPECTED_PROVIDER_ORPHANS.
 *
 * A single explicit ignore-set (EXPECTED_ORPHANS) is provided for
 * exports we've deliberately excluded from the API reference (e.g.
 * a deprecated re-export kept only for backward compat). Adding
 * to it should be rare; prefer either routing the symbol to a page
 * or marking it `@internal` at the source.
 */
function auditManifest(pages, symbolIndex) {
  const claimed = new Set();
  for (const p of pages) {
    for (const s of (p.symbols ?? [])) {
      claimed.add(sectionKey(s.module, s.name));
    }
  }

  const problems = [];

  // 1. Manifest → engine (ghost entries).
  for (const key of claimed) {
    if (!symbolIndex.has(key)) {
      const [module, name] = key.split('::');
      problems.push(
        `manifest names "${name}" in module "${module}" but TypeDoc emitted no such section. `
          + `Either the symbol was renamed / removed (remove or update the manifest entry) or the module `
          + `isn't in typedoc.json (add it there).`,
      );
    }
  }

  // 2. Engine → manifest (orphaned symbols).
  for (const key of symbolIndex.keys()) {
    if (claimed.has(key)) continue;
    const [module, name] = key.split('::');
    if (EXPECTED_ORPHANS.has(key)) continue;
    // Provider modules deliberately land in the narrative section.
    if (module.startsWith('providers/') && !EXPECTED_PROVIDER_ORPHANS.has(name)) continue;
    problems.push(
      `public engine export "${name}" (module "${module}") isn't referenced by any page in `
        + `docs/site/generators/api.mjs's PAGES manifest. Add it to the right group's detail page, `
        + `or add its key to EXPECTED_ORPHANS if it's intentionally hidden.`,
    );
  }

  if (problems.length === 0) return;
  const lines = [
    '',
    '── API docs drift ────────────────────────────────────────────',
    'The engine\'s public surface and docs/site/generators/api.mjs\'s',
    'PAGES manifest have drifted. Fix each item below:',
    '',
    ...problems.map((p) => `  • ${p}`),
    '',
    'This check exists so new engine exports never silently vanish',
    'from the docs. See CONTRIBUTING.md ("Documentation guardrails")',
    'for the full checklist.',
    '──────────────────────────────────────────────────────────────',
    '',
  ];
  throw new Error(lines.join('\n'));
}

/**
 * Explicit allow-list of TypeDoc-emitted symbols we've decided not
 * to route to any page. Keep this small; prefer either routing the
 * symbol to a page or marking it `@internal` in source.
 *
 * Format: `<module>::<symbol>` keys, matching `sectionKey(...)`.
 */
const EXPECTED_ORPHANS = new Set([
  // `JSON_SCHEMA_VERSION` is a deprecated alias of
  // `RESPONSE_ENVELOPE_VERSION`; the constant is documented once
  // on the constants page under its current name.
  'noggin-api::JSON_SCHEMA_VERSION',
  // `normalizeNote` is a small internal helper re-exported for use
  // by the serializers; not worth its own page.
  'noggin-api::normalizeNote',
]);

/**
 * Provider modules default to "narrative page owns everything";
 * only add a symbol name here if you want the audit to flag a
 * provider-module symbol as missing from the API tree (i.e. you
 * intended to give it its own API-section page).
 */
const EXPECTED_PROVIDER_ORPHANS = new Set([]);

// ── TypeDoc invocation ───────────────────────────────────────────

function runTypedoc() {
  if (!existsSync(typedocBin)) {
    throw new Error(
      `TypeDoc isn't installed. Run \`npm install\` in docs/site/.\n` +
      `Looked for: ${typedocBin}`,
    );
  }
  rmSync(typedocOut, { recursive: true, force: true });
  execFileSync(process.execPath, [typedocBin, '--options', typedocConfig], {
    cwd: siteRoot,
    stdio: 'inherit',
  });
}

// ── Module & symbol parsing ──────────────────────────────────────

// Modules TypeDoc emits (mirrors `entryPoints` in typedoc.json).
const MODULE_FILES = [
  'noggin-api',
  'providers/file',
  'providers/memory',
  'providers/localstorage',
  'providers/http',
  'serializers/yaml',
  'serializers/json',
];

// Provider-specific symbols aren't generated as detail pages here
// (they live in the narrative `providers/` section, which has its
// own hand-authored content covering each provider's factory,
// options, and behaviour). So TypeDoc cross-refs to them resolve
// to the narrative page's slug rather than a broken URL.
const MODULE_FALLBACK_SLUGS = {
  'providers/file': 'providers/file/',
  'providers/memory': 'providers/memory/',
  'providers/localstorage': 'providers/localstorage/',
  'providers/http': 'providers/http/',
  'serializers/yaml': 'api/serializers/yaml/',
  'serializers/json': 'api/serializers/json/',
};

function loadTypedocModules() {
  const modules = new Map();
  for (const mod of MODULE_FILES) {
    const file = path.join(typedocOut, ...mod.split('/')) + '.md';
    if (!existsSync(file)) {
      throw new Error(`typedoc output missing for module ${mod}: ${file}`);
    }
    modules.set(mod, readFileSync(file, 'utf8'));
  }
  return modules;
}

/**
 * Parse every module's markdown into a map keyed by
 * `<module>::<symbolName>` → the markdown slice for that symbol.
 *
 * TypeDoc emits per-symbol sections at H3 (`### Foo`) grouped under
 * H2 kind headings (`## Classes`, `## Interfaces`, ...). Symbols are
 * separated by a `***` horizontal rule. We split on that separator
 * within each H2 block.
 */
function indexSymbols(modules) {
  const out = new Map();
  for (const [mod, md] of modules) {
    // Chop off the first `# module` line — TypeDoc's module heading.
    // Everything after that is the H2/H3 body we care about.
    const body = md.replace(/^#\s+.*\n+/, '');
    // Split into H2 blocks. Each block starts with `## <Kind>`.
    const h2Blocks = body.split(/\n(?=## )/);
    for (const block of h2Blocks) {
      // Drop the `## Kind` header itself; keep the rest.
      const stripped = block.replace(/^## [^\n]*\n+/, '');
      // Split into H3 (symbol) sections on `\n***\n` separators.
      const sections = stripped.split(/\n\*\*\*\n+/);
      for (const raw of sections) {
        const section = raw.trim();
        if (!section) continue;
        const m = section.match(/^### (.+)$/m);
        if (!m) continue;
        // TypeDoc adornments: trailing `()` on functions, escaped
        // underscores in CONSTANT_LIKE names, and `~~name~~`
        // strikethrough for @deprecated symbols. Normalise all
        // three so the manifest can use the plain source-code name.
        const name = m[1]
          .replace(/^~~/, '').replace(/~~$/, '')
          .replace(/\(\)$/, '')
          .replace(/\\_/g, '_')
          .trim();
        out.set(sectionKey(mod, name), section);
      }
    }
  }
  return out;
}

function sectionKey(module, name) {
  return `${module}::${name}`;
}

// ── Cross-reference resolution ───────────────────────────────────

/**
 * Build a `lowercase-anchor -> slug` map by walking every symbol
 * section on every page. Includes:
 *
 *   - Top-level symbol names (`nogginerror`, `openNoggin`, ...).
 *   - Every inline `<a id="foo">` anchor TypeDoc emits inside a
 *     section (member properties, method disambiguators, etc.).
 *   - Base-name aliases for numbered anchors (`dispose-1` also
 *     resolves as `dispose`), so cross-refs that TypeDoc numbered
 *     against its whole-module ordering still find their home.
 *
 * When multiple sections define the same base name, the first
 * (in page-manifest order) wins — arbitrary but deterministic.
 */
function buildAnchorMap(pages, symbolIndex) {
  const map = new Map();
  const claim = (anchor, slug) => {
    if (!map.has(anchor)) map.set(anchor, slug);
  };
  for (const p of pages) {
    for (const s of (p.symbols ?? [])) {
      claim(s.name.toLowerCase(), p.slug);
      const section = symbolIndex.get(sectionKey(s.module, s.name));
      if (!section) continue;
      for (const m of section.matchAll(/id="([a-z0-9-]+)"/gi)) {
        const raw = m[1].toLowerCase();
        claim(raw, p.slug);
        const base = raw.replace(/-\d+$/, '');
        if (base !== raw) claim(base, p.slug);
      }
      // Every H4-H6 heading inside the section also becomes a slug
      // via the markdown renderer's `precomputeHeadingIds`. Feed
      // those too so refs like `#copy` (a `##### copy()` method
      // heading on the Verbs page) resolve.
      for (const m of section.matchAll(/^#{4,6}\s+(.+)$/gm)) {
        const text = m[1].replace(/\(\)$/, '').replace(/\\_/g, '_').trim();
        const slug = slugifyHeading(text);
        if (!slug) continue;
        claim(slug, p.slug);
      }
    }
  }
  return map;
}

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Rewrite the two kinds of TypeDoc cross-refs in `md` to point at
 * the right per-page URL:
 *
 *   `[Foo](#foo)`              intra-module hash. Repoint if `foo`
 *                              lives on another page.
 *   `[Foo](../bar.md#baz)`     inter-module reference. Always
 *                              repoint (the .md files aren't served).
 *
 * Anchors with a `-N` disambiguator suffix are matched against
 * their full form first, then their base name.
 */
function rewriteCrossRefs(md, currentSlug, anchorMap) {
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text, href) => {
    if (/^(?:https?:)?\/\//.test(href)) return whole;

    if (href.startsWith('#')) {
      const raw = href.slice(1).toLowerCase();
      const target = anchorMap.get(raw) ?? anchorMap.get(raw.replace(/-\d+$/, ''));
      if (!target || target === currentSlug) return whole;
      return `[${text}](${relativeUrl(currentSlug, target)}#${raw})`;
    }

    const mdRef = href.match(/^(?:\.\.\/)?([\w/-]+)\.md(?:#(.+))?$/);
    if (mdRef) {
      const [, modulePath, hash] = mdRef;
      if (hash) {
        const raw = hash.toLowerCase();
        const target = anchorMap.get(raw) ?? anchorMap.get(raw.replace(/-\d+$/, ''));
        if (target) return `[${text}](${relativeUrl(currentSlug, target)}#${raw})`;
      }
      // Module-level fallback: point at whichever slug we've
      // decided owns this module's content (narrative provider
      // pages for `providers/*`, our own per-module page for
      // serializers). Prefer this to dropping the link.
      const fallback = MODULE_FALLBACK_SLUGS[modulePath];
      if (fallback) return `[${text}](${relativeUrl(currentSlug, fallback)})`;
      return whole;
    }

    return whole;
  });
}

/**
 * Post-render HTML pass: for every `href="#foo-N"` whose target id
 * doesn't exist on the current page, try `#foo`, `#foo-N-1`,
 * `#foo-N-2`, ..., `#foo-1`, then `#foo-N+1`, `#foo-N+2`, ... and
 * rewrite to the first one that does exist. Leaves resolved links
 * alone. If nothing at all with that base exists, leaves the link
 * untouched so the issue is visible in source.
 *
 * Same behaviour as the reconciler the single-page generator used
 * to run; still needed here because TypeDoc's numeric suffixes are
 * computed against its own internal ordering and don't always line
 * up with the ids the page-scoped markdown renderer produces.
 */
function reconcileAnchorLinks(html) {
  const ids = new Set();
  for (const m of html.matchAll(/id="([a-z0-9-]+)"/gi)) ids.add(m[1]);

  return html.replace(/href="#([a-z0-9-]+)"/gi, (whole, target) => {
    if (ids.has(target)) return whole;
    const suffix = target.match(/^(.*?)-(\d+)$/);
    const base = suffix ? suffix[1] : target;
    if (!ids.has(base) && ![...ids].some((id) => id.startsWith(`${base}-`))) {
      return whole;
    }
    const n = suffix ? Number(suffix[2]) : 0;
    for (let k = n - 1; k >= 0; k--) {
      const candidate = k === 0 ? base : `${base}-${k}`;
      if (ids.has(candidate)) return `href="#${candidate}"`;
    }
    for (let k = n + 1; k < n + 32; k++) {
      const candidate = `${base}-${k}`;
      if (ids.has(candidate)) return `href="#${candidate}"`;
    }
    return whole;
  });
}

/**
 * Compute a relative URL from one slug to another. Both are
 * trailing-slashed (e.g. `api/handles/noggin/`).
 */
function relativeUrl(fromSlug, toSlug) {
  const fromParts = fromSlug.replace(/\/$/, '').split('/');
  const up = '../'.repeat(fromParts.length);
  return up + toSlug;
}

// ── Heading presentation ─────────────────────────────────────────

/**
 * Turn a raw TypeDoc section into the shape the page will render:
 *
 *   - **Single-symbol page.** The page's own `intro` supplies the H1,
 *     which already names the symbol. Strip the redundant `### Foo`
 *     header at the top of the TypeDoc section so we don't repeat
 *     the name (and don't render it in the site's small-caps H4
 *     style, which is designed for section labels like "Properties").
 *
 *   - **Multi-symbol page** (e.g. all the verb-options interfaces on
 *     one page). Promote the `### Foo` header to `## Foo` so each
 *     symbol becomes a proper H2 section boundary. Readers scanning
 *     the page can spot where one symbol ends and the next begins.
 *
 * Everything below the leading heading (`#### Extends`, `##### dispose()`,
 * ...) is left untouched — TypeDoc's H4–H6 map naturally to the
 * site's "small section label" / "method signature" / "detail" tiers.
 */
function presentSymbolSection(section, multiSymbolPage) {
  const lines = section.split('\n');
  const first = lines[0] ?? '';
  const isHeading = /^### /.test(first);
  if (!isHeading) return section;
  if (multiSymbolPage) {
    lines[0] = first.replace(/^### /, '## ');
    return lines.join('\n');
  }
  // Strip the leading H3 line plus any blank line that follows.
  lines.shift();
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  return lines.join('\n');
}



