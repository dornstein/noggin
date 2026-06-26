#!/usr/bin/env node
// AUTO-SYNCED FROM cli/noggin.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Noggin CLI — thin wrapper over the engine.
//
// Responsibilities:
//   1. Parse argv into { verb, positional, flags }.
//   2. Resolve a noggin location (--noggin / $NOGGIN / default).
//   3. Translate flags into verb option objects.
//   4. Dispatch to `verbs.X(noggin, opts)` from the engine.
//   5. Format the result for a terminal.
//
// All noggin logic lives in the engine. This file owns nothing about
// the data model — only argv interpretation and terminal rendering.
//
// Embedding: I/O and noggin construction are injected. `runCommand(argv,
// { io, openNoggin, defaultLocationLabel })` returns a Promise<exitCode>
// and never touches `process` directly, so the same dispatcher powers
// the shebang entry below and the in-browser playground on the docs site.
//
// The Node file provider is imported lazily so the browser bundle can
// avoid pulling in `node:fs`/`node:os`/`node:path`.

import {
  NogginError,
  providers,
  formatSuccess, formatError,
  verbs,
} from '@noggin/engine';
import { cliErrorMessage } from './error-messages.mjs';

// ── Argument parsing ─────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['noggin', 'title', 'before', 'after', 'into']);
const OPTIONAL_VALUE_FLAGS = new Set(['goto']);
const BOOL_FLAGS = new Set([
  'json', 'with-json', 'help', 'no-children', 'with-notes', 'done', 'open',
  'recursive', 'with-siblings', 'with-descendants', 'with-all', 'force',
  'close-all',
]);

// Internal sentinel: fail() throws this so runCommand() can convert it
// into an exit code without unwinding into the embedder's stack.
class ExitSignal extends Error {
  constructor(code) { super(`exit:${code}`); this.code = code; this.name = 'ExitSignal'; }
}

function fail(ctx, msg, code = 2, errCode = 'noggin-error', data) {
  if (ctx.json) {
    const envelope = formatError({
      verb: ctx.verb,
      error: new NogginError(msg, { code: errCode, exitCode: code, data }),
    });
    ctx.io.stderr(JSON.stringify(envelope, null, 2) + '\n');
  } else {
    ctx.io.stderr(`noggin: ${msg}\n`);
  }
  throw new ExitSignal(code);
}

/** Render a NogginError into the CLI's user-facing form. */
function failWithNogginError(ctx, err) {
  const msg = cliErrorMessage({
    verb: ctx.verb,
    code: err.code,
    message: err.message,
    data: err.data,
  });
  if (ctx.json) {
    // The CLI's --json output represents the CLI, not the engine: the
    // message field carries the CLI-flavored string (with --flag
    // vocabulary). Structured `code` + `data` stay stable across
    // hosts; the catalog rendering is what differs.
    const cliErr = new NogginError(msg, { code: err.code, exitCode: err.exitCode, data: err.data });
    ctx.io.stderr(JSON.stringify(formatError({ verb: ctx.verb, error: cliErr }), null, 2) + '\n');
  } else {
    ctx.io.stderr(`noggin: ${msg}\n`);
  }
  throw new ExitSignal(err.exitCode);
}

function looksLikePath(value) {
  const text = String(value ?? '');
  if (text === '.' || text === '..' || text === '-' || text === '+') return true;
  if (text.startsWith('./') || text.startsWith('../')) return true;
  if (text.startsWith('-/') || text.startsWith('+/')) return true;
  if (/^\/?\d+(?:\/\d+)*$/.test(text)) return true;
  return false;
}

function parseFlagToken(token) {
  const eq = token.indexOf('=');
  if (eq < 0) return { key: token.slice(2), value: undefined, hasInlineValue: false };
  return { key: token.slice(2, eq), value: token.slice(eq + 1), hasInlineValue: true };
}

function parseArgs(ctx, argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const { key, value, hasInlineValue } = parseFlagToken(a);
      if (BOOL_FLAGS.has(key)) { flags[key] = true; continue; }
      if (OPTIONAL_VALUE_FLAGS.has(key)) {
        if (hasInlineValue) {
          flags[key] = value || true;
        } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && looksLikePath(argv[i + 1])) {
          flags[key] = argv[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
        continue;
      }
      if (VALUE_FLAGS.has(key)) {
        const val = hasInlineValue ? value : argv[i + 1];
        if (val === undefined || val.startsWith('--')) {
          fail(ctx, `flag --${key} requires a value`);
        }
        flags[key] = val;
        if (!hasInlineValue) i++;
        continue;
      }
      fail(ctx, `unknown flag: --${key}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function splitCommand(ctx, argv) {
  const leading = [];
  let i = 0;
  while (i < argv.length && (argv[i].startsWith('--') || argv[i] === '-h')) {
    const a = argv[i];
    leading.push(a);
    const parsedFlag = a.startsWith('--') ? parseFlagToken(a) : null;
    const key = a === '--help' || a === '-h' ? 'help' : parsedFlag ? parsedFlag.key : null;
    if (key && VALUE_FLAGS.has(key)) {
      if (parsedFlag?.hasInlineValue) {
        i++;
      } else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
        fail(ctx, `flag --${key} requires a value`);
      } else {
        leading.push(argv[i + 1]);
        i += 2;
      }
    } else if (key && OPTIONAL_VALUE_FLAGS.has(key) && !parsedFlag?.hasInlineValue &&
      argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && looksLikePath(argv[i + 1])) {
      leading.push(argv[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  return {
    verb: argv[i],
    args: [...leading, ...argv.slice(i + 1)],
  };
}

// ── Output formatting (terminal-only helpers) ────────────────────────────────

function formatItemLine(item, activeKey, indent) {
  const leading = [];
  if (item.key === activeKey) leading.push('📍');
  if (item.done) leading.push('✅');
  const prefix = leading.length ? leading.join('') + ' ' : '';
  const trailing = Array.isArray(item.notes) && item.notes.length ? ' ✏️' : '';
  return `${indent}${item.path ?? '?'} ${prefix}${item.title}${trailing}`;
}

function printView(ctx, view, opts = {}) {
  if (!view || !Array.isArray(view.items) || view.items.length === 0) {
    ctx.io.stdout('(no item)\n');
    return;
  }
  const lines = [];
  function walk(node, depth) {
    const indent = '  '.repeat(depth);
    lines.push(formatItemLine(node, view.activeKey, indent));
    if (Array.isArray(node.children)) {
      for (const kid of node.children) walk(kid, depth + 1);
    }
    if (opts.includeNotes && node.key === view.targetKey) {
      const notes = Array.isArray(node.notes) ? node.notes : [];
      lines.push(`${indent}  notes:${notes.length ? '' : ' (none)'}`);
      for (const note of notes) {
        lines.push(`${indent}    - ${note.timestamp || '(no timestamp)'}`);
        for (const ln of (note.text || '').split('\n')) lines.push(`${indent}      ${ln}`);
      }
    }
  }
  for (const root of view.items) walk(root, 0);
  ctx.io.stdout(lines.join('\n') + '\n');
}

function printJson(ctx, envelope) {
  ctx.io.stdout(JSON.stringify(envelope, null, 2) + '\n');
}

function emitOutput(ctx, flags, human, data) {
  if (flags.json) {
    printJson(ctx, formatSuccess({ verb: ctx.verb, data }));
    return;
  }
  human();
  if (flags['with-json']) {
    ctx.io.stdout('\n');
    printJson(ctx, formatSuccess({ verb: ctx.verb, data }));
  }
}

function emitView(ctx, view, flags, opts = {}) {
  if (view === null || view === undefined) {
    emitOutput(ctx, flags, () => ctx.io.stdout('(no item)\n'), view ?? null);
    return;
  }
  emitOutput(
    ctx,
    flags,
    () => printView(ctx, view, { includeNotes: Boolean(opts.includeNotes) }),
    view,
  );
}

// ── Flag → verb opts translators ─────────────────────────────────────────────

function hasGoto(flags) { return Object.prototype.hasOwnProperty.call(flags, 'goto'); }
function gotoOpt(flags) { return hasGoto(flags) ? flags.goto : undefined; }

function parsePlacement(ctx, flags, commandName) {
  const present = ['before', 'after', 'into'].filter((k) => flags[k] !== undefined);
  if (present.length === 0) return undefined;
  if (present.length > 1) fail(ctx, `${commandName}: --before, --after, and --into are mutually exclusive`);
  const kind = present[0];
  return { kind, anchor: flags[kind] };
}

function closeFlags(flags) {
  return {
    force: flags.force === true,
    closeAll: flags['close-all'] === true,
  };
}

// ── Command dispatch ─────────────────────────────────────────────────────────

async function cmdPush(ctx, { positional, flags }) {
  const title = (flags.title || positional.join(' ')).trim();
  if (!title) fail(ctx, 'push: title required (--title or positional)', 2, 'title-required');
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.push(noggin, { title }), flags);
}

async function cmdAdd(ctx, { positional, flags }) {
  const title = (flags.title || positional.join(' ')).trim();
  if (!title) fail(ctx, 'add: title required (--title or positional)', 2, 'title-required');
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.add(noggin, {
    title,
    placement: parsePlacement(ctx, flags, 'add'),
    goto: gotoOpt(flags),
  }), flags);
}

async function cmdMove(ctx, { positional, flags }) {
  if (positional.length > 1) fail(ctx, 'move: accepts at most one path');
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.move(noggin, {
    path: positional[0],
    placement: parsePlacement(ctx, flags, 'move'),
    goto: gotoOpt(flags),
  }), flags);
}

async function cmdGoto(ctx, { positional, flags }) {
  if (!positional[0]) fail(ctx, 'goto: path required');
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.goto(noggin, { path: positional[0] }), flags);
}

async function cmdDone(ctx, { positional, flags }) {
  if (positional.length > 1) fail(ctx, 'done: accepts at most one path');
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.done(noggin, {
    path: positional[0],
    ...closeFlags(flags),
    ...(hasGoto(flags) ? { goto: flags.goto } : {}),
  }), flags);
}

async function cmdPop(ctx, { positional, flags }) {
  if (positional.length > 0) fail(ctx, 'pop: takes no path; pop always operates on the active item');
  if (hasGoto(flags)) fail(ctx, "pop: --goto is not supported; pop always moves to the active item's parent");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.pop(noggin, closeFlags(flags)), flags);
}

async function cmdEdit(ctx, { positional, flags }) {
  if (flags.done === true && flags.open === true) {
    fail(ctx, 'edit: --done and --open are mutually exclusive');
  }
  if (positional.length > 1) fail(ctx, 'edit: accepts at most one path');
  const noggin = await ctx.openNoggin(flags);
  const opts = {
    path: positional[0],
    goto: gotoOpt(flags),
    ...closeFlags(flags),
  };
  if (flags.done === true) opts.done = true;
  else if (flags.open === true) opts.done = false;
  if (flags.title !== undefined) opts.title = flags.title;
  emitView(ctx, await verbs.edit(noggin, opts), flags);
}

async function cmdShow(ctx, { positional, flags }) {
  const noggin = await ctx.openNoggin(flags);
  const withSiblings = flags['with-siblings'] === true || flags['with-all'] === true;
  const withDescendants = flags['with-descendants'] === true || flags['with-all'] === true;
  const noChildren = flags['no-children'] === true;
  if (withDescendants && noChildren) {
    fail(ctx, 'show: --with-descendants and --no-children are mutually exclusive');
  }
  const view = await verbs.show(noggin, {
    path: positional[0],
    includeChildren: !noChildren,
    withSiblings,
    withDescendants,
    goto: gotoOpt(flags),
  });
  if (view === null) {
    emitOutput(ctx, flags, () => ctx.io.stdout('(no active item; pass a path)\n'), null);
    return;
  }
  emitView(ctx, view, flags, { includeNotes: flags['with-notes'] === true });
}

async function cmdNote(ctx, { positional, flags }) {
  const noggin = await ctx.openNoggin(flags);
  let pathArg;
  let textParts = positional;
  if (positional.length > 0 && looksLikePath(positional[0])) {
    pathArg = positional[0];
    textParts = positional.slice(1);
  }
  emitView(ctx, await verbs.note(noggin, {
    path: pathArg,
    text: textParts.join(' ').trim(),
    goto: gotoOpt(flags),
  }), flags);
}

async function cmdDelete(ctx, { positional, flags }) {
  if (hasGoto(flags)) fail(ctx, 'delete: --goto is not supported');
  if (positional.length === 0) fail(ctx, 'delete: path required');
  if (positional.length > 1) fail(ctx, 'delete: accepts at most one path');
  const noggin = await ctx.openNoggin(flags);
  const result = await verbs.delete(noggin, {
    path: positional[0],
    recursive: flags.recursive === true,
  });
  emitOutput(
    ctx,
    flags,
    () => {
      const tail = result.descendantCount ? ` and ${result.descendantCount} descendant(s)` : '';
      ctx.io.stdout(`deleted ${result.deleted.path}${tail}\n`);
      if (result.view) printView(ctx, result.view);
      else ctx.io.stdout('(tree is now empty)\n');
    },
    result,
  );
}

async function cmdWhere(ctx, { flags }) {
  const noggin = await ctx.openNoggin(flags);
  const location = noggin.describe();
  emitOutput(
    ctx,
    flags,
    () => { ctx.io.stdout(`${location}\n`); },
    location,
  );
}

async function cmdCopy(ctx, { positional, flags }) {
  // `noggin copy <from> <to>` — open both via the engine (separate from
  // ctx.openNoggin which is tied to --noggin/$NOGGIN/default) and call
  // verbs.copy. v1 is a whole-noggin append-only copy; see SKILL.md.
  if (positional.length < 2) {
    fail(ctx, 'copy: usage: noggin copy <from> <to>', 2, 'usage');
  }
  const [fromLoc, toLoc] = positional;
  const source = await ctx.openNogginAt(fromLoc);
  const dest = await ctx.openNogginAt(toLoc);
  const result = await verbs.copy(source, dest, {});
  emitOutput(
    ctx,
    flags,
    () => {
      ctx.io.stdout(`copied ${result.copied} item(s) from ${source.describe()} to ${dest.describe()}\n`);
    },
    result,
  );
}

async function cmdProviders(ctx, { flags }) {
  const list = providers.list();
  emitOutput(
    ctx,
    flags,
    () => {
      if (list.length === 0) { ctx.io.stdout('(no providers registered)\n'); return; }
      const w = Math.max(...list.map((f) => f.scheme.length), 6);
      ctx.io.stdout(`${'scheme'.padEnd(w)}  default\n`);
      ctx.io.stdout(`${'-'.repeat(w)}  -------\n`);
      for (const f of list) {
        ctx.io.stdout(`${f.scheme.padEnd(w)}  ${f.default ? 'yes' : ''}\n`);
      }
    },
    list,
  );
}

async function cmdHelp(ctx) {
  ctx.io.stdout([
    'noggin — working-memory tree CLI',
    '',
    'An item has: title, done flag, timestamps, and append-only notes.',
    'No fixed schema for content. Anything worth saying goes in a note.',
    '',
    'Addressing:',
    '  path   absolute starts with `/` (e.g. "/1/2/3");',
    '         everything else is relative to the active item:',
    '         "." ".." "-" "+" "./X" "../X" "-/X" "+/X" or bare "X/Y" (= "./X/Y")',
    '  tree   "<path> 📍✅ title ✏️" — 📍 active, ✅ done (before title),',
    '         ✏️ has notes (after title)',
    '',
    'Verbs:',
    '  push <title>                    child of active, becomes active',
    '  add  <title> [--before|--after|--into <path>] [--goto [path]]',
    '                                  child of active by default; placement flags pick a different spot',
    '  move [<path>] (--before|--after|--into <path>) [--goto [path]]',
    '                                  relocate an item; required placement flag picks the destination',
    '  goto <path>                     make <path> the active item',
    '  done [<path>] [--force|--close-all]',
    '                                  mark done, then make the parent active (idempotent);',
    '                                  --close-all closes any open descendants first;',
    '                                  --force closes the target anyway, leaving kids open',
    '  pop [--force|--close-all]       same as `done` on the active item (no path)',
    '  edit [<path>] [--done|--open] [--title T] [--force|--close-all] [--goto [path]]',
    '                                  edit an item\'s state and/or title (idempotent);',
    '                                  --done/--open change lifecycle state;',
    '                                  --title T renames the item;',
    '                                  pass at least one of those three',
    '  show [<path>] [--no-children|--with-descendants] [--with-siblings] [--with-all] [--with-notes] [--goto [path]]',
    '                                  current tree view; --with-notes adds note bodies;',
    '                                  --with-siblings includes all sibling rows along the spine;',
    '                                  --with-descendants expands the target subtree recursively;',
    '                                  --with-all = --with-siblings --with-descendants',
    '  note [<path>] <text…> [--goto [path]]',
    '                                  append a timestamped note',
    '  delete <path> [--recursive]     remove an item; --recursive also removes its subtree',
    '  where                           print which noggin would be used and why',
    '  copy <from> <to>                append every item from <from> into <to> (whole-noggin, append-only, fresh keys; notes and timestamps preserved)',
    '  providers                       list registered providers (file://, etc.)',
    '  help',
    '',
    'Item creation flags (push/add):',
    '  --title T                       title (alternative to positional)',
    '',
    'Common:',
    '  --noggin <location>             override the noggin location (highest priority)',
    '  --goto [path]                   move after command; relative paths resolve from target',
    '  --json                          structured output',
    '  --with-json                     human output followed by structured output',
    '',
    'Noggin location (highest first):',
    '  1. --noggin <location>',
    '  2. $NOGGIN env var',
    `  3. ${ctx.defaultLocationLabel}`,
    '',
    'Locations may be a bare path (defaults to the file provider) or a',
    'URI like `file:///abs/path.yaml`. Run `noggin providers` to see all',
    'registered providers.',
    '',
  ].join('\n'));
}

// ── Embedding entry point ───────────────────────────────────────────────────
//
// `runCommand(argv, opts)` is the engine of the CLI. It accepts an array
// of argv tokens (no program name; just what would come after `noggin`)
// and a bundle of injected dependencies, and returns the exit code.
//
//   opts.io.stdout(str)        — write a chunk of stdout text
//   opts.io.stderr(str)        — write a chunk of stderr text
//   opts.io.exit(code)         — optional; called with the final exit code
//   opts.openNoggin(flags)     — async (flags) => Noggin; resolves the provider
//   opts.openNogginAt(location)— optional; async (location) => Noggin; opens an arbitrary
//                                location (used by `copy` which needs two noggins at once)
//   opts.defaultLocationLabel  — optional; string shown in help text as
//                                the default noggin location
//
// When `openNoggin`/`openNogginAt`/`defaultLocationLabel` are omitted
// the node file provider is loaded lazily (so a browser bundle that
// supplies its own openNoggin never pulls in `node:fs` et al.).

export async function runCommand(argv, opts = {}) {
  const io = opts.io || defaultNodeIo();
  const openNogginFn = opts.openNoggin || await defaultNodeOpenNoggin();
  const openNogginAtFn = opts.openNogginAt || await defaultNodeOpenNogginAt();
  const defaultLocationLabel = opts.defaultLocationLabel
    || (opts.openNoggin ? '(injected)' : await defaultNodeLocationLabel());
  const ctx = {
    verb: null,
    json: false,
    io,
    openNoggin: openNogginFn,
    openNogginAt: openNogginAtFn,
    defaultLocationLabel,
  };

  let exitCode = 0;
  try {
    if (!argv || argv.length === 0) { await cmdHelp(ctx); return finish(io, 0); }
    const { verb, args } = splitCommand(ctx, argv);
    const parsed = parseArgs(ctx, args);
    ctx.verb = verb || null;
    ctx.json = Boolean(parsed.flags.json);
    if (parsed.flags.help) { await cmdHelp(ctx); return finish(io, 0); }
    try {
      await dispatch(ctx, verb, parsed);
    } catch (e) {
      if (e instanceof NogginError) {
        failWithNogginError(ctx, e);
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof ExitSignal) {
      exitCode = e.code;
    } else {
      io.stderr(`noggin: ${e && e.message ? e.message : e}\n`);
      exitCode = 1;
    }
  }
  return finish(io, exitCode);
}

function finish(io, code) {
  if (typeof io.exit === 'function') io.exit(code);
  return code;
}

async function dispatch(ctx, verb, parsed) {
  switch (verb) {
    case 'push':      return await cmdPush(ctx, parsed);
    case 'add':       return await cmdAdd(ctx, parsed);
    case 'move':      return await cmdMove(ctx, parsed);
    case 'goto':      return await cmdGoto(ctx, parsed);
    case 'done':      return await cmdDone(ctx, parsed);
    case 'pop':       return await cmdPop(ctx, parsed);
    case 'edit':      return await cmdEdit(ctx, parsed);
    case 'show':      return await cmdShow(ctx, parsed);
    case 'note':      return await cmdNote(ctx, parsed);
    case 'delete':    return await cmdDelete(ctx, parsed);
    case 'where':     return await cmdWhere(ctx, parsed);
    case 'copy':      return await cmdCopy(ctx, parsed);
    case 'providers': return await cmdProviders(ctx, parsed);
    case 'help':
    case '--help':
    case '-h':        await cmdHelp(ctx); return;
    default:          fail(ctx, `unknown command: ${verb} (try 'help')`);
  }
}

// ── Lazy node defaults ──────────────────────────────────────────────────────
//
// These helpers are only invoked when the caller leaves the matching
// opt unset. The dynamic import of `@noggin/engine/providers/file` means a
// browser bundle that always passes its own io/openNoggin never pulls in
// `node:fs`/`node:os`/`node:path`.

function defaultNodeIo() {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    exit: (code) => process.exit(code),
  };
}

/**
 * Default openNoggin(flags): resolves the location by the standard
 * priority and opens via the engine's provider registry. Imports the
 * file provider for side-effect (registers the file:// provider).
 */
async function defaultNodeOpenNoggin() {
  await import('@noggin/engine/providers/file');
  const { openNoggin } = await import('@noggin/engine');
  const defaultLoc = await defaultNodeLocationLabel();
  return (flags) => openNoggin(resolveLocation(flags, defaultLoc));
}

/**
 * Default openNogginAt(location): opens an explicit location string
 * via the engine. Used by `copy` and any other verb that needs to
 * open a noggin from a path argument rather than the resolved
 * --noggin/$NOGGIN/default. Imports the file provider side-effect
 * the same way as defaultNodeOpenNoggin.
 */
async function defaultNodeOpenNogginAt() {
  await import('@noggin/engine/providers/file');
  const { openNoggin } = await import('@noggin/engine');
  return (location) => openNoggin(location);
}

async function defaultNodeLocationLabel() {
  // The default noggin location is `~/.noggin.yaml` in canonical form.
  // The file provider's expandHome() turns this into the actual home dir
  // at open time, but the *location string* stays symbolic so `where`
  // shows the human-readable form.
  return '~/.noggin.yaml';
}

function resolveLocation(flags, defaultLocation) {
  if (flags && flags.noggin) return flags.noggin;
  if (typeof process !== 'undefined' && process.env && process.env.NOGGIN) return process.env.NOGGIN;
  return defaultLocation;
}

// ── Shebang main ────────────────────────────────────────────────────────────

if (typeof process !== 'undefined' && Array.isArray(process.argv)) {
  runCommand(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`noggin: ${e && e.message ? e.message : e}\n`);
    process.exit(1);
  });
}
