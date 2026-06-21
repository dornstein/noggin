#!/usr/bin/env node
// AUTO-SYNCED FROM cli/noggin.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Noggin CLI — thin wrapper over noggin-api.mjs.
//
// Responsibilities:
//   1. Parse argv into { verb, positional, flags }.
//   2. Resolve the noggin file (--file / $NOGGIN_FILE / ~/.noggin.yaml).
//   3. Translate flags into the verb's typed options object.
//   4. Invoke the API; catch NogginError; format output.
//
// All noggin logic lives in noggin-api.mjs. This file owns nothing about
// the data model — only how to interpret argv and how to render results
// for a terminal.

import {
  apiPush, apiAdd, apiMove, apiGoto, apiDone, apiPop, apiSet,
  apiShow, apiNote, apiDelete, apiWhere,
  resolveFile, DEFAULT_FILE, NogginError,
  formatSuccess, formatError,
} from './noggin-api.mjs';

// ── Argument parsing ─────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['file', 'title', 'before', 'after', 'into']);
const OPTIONAL_VALUE_FLAGS = new Set(['goto']);
const BOOL_FLAGS = new Set(['json', 'debug', 'help', 'nokids', 'notes', 'done', 'undone', 'recursive', 'allup', 'alldown', 'all', 'force', 'closeall']);

// Mutable handle so fail() can include the verb / file / --json state
// regardless of where in the dispatch lifecycle the error fires.
const exitContext = { verb: null, file: null, json: false };

function fail(msg, code = 2, errCode = 'noggin-error') {
  if (exitContext.json) {
    const envelope = formatError({
      verb: exitContext.verb,
      file: exitContext.file,
      error: new NogginError(msg, { code: errCode, exitCode: code }),
    });
    process.stderr.write(JSON.stringify(envelope, null, 2) + '\n');
  } else {
    process.stderr.write(`noggin: ${msg}\n`);
  }
  process.exit(code);
}

function looksLikePath(value) {
  const text = String(value ?? '');
  if (text === '.' || text === '..' || text === '-' || text === '+') return true;
  if (text.startsWith('./') || text.startsWith('../')) return true;
  if (text.startsWith('-/') || text.startsWith('+/')) return true;
  // Position sequences. Absolute starts with `/`; bare `1/2/3` is relative
  // (short for `./1/2/3`). looksLikePath only decides "is this an argument
  // that looks like a path?" — the resolver decides what it means.
  if (/^\/?\d+(?:\/\d+)*$/.test(text)) return true;
  return false;
}

function parseFlagToken(token) {
  const eq = token.indexOf('=');
  if (eq < 0) return { key: token.slice(2), value: undefined, hasInlineValue: false };
  return { key: token.slice(2, eq), value: token.slice(eq + 1), hasInlineValue: true };
}

function parseArgs(argv) {
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
          fail(`flag --${key} requires a value`);
        }
        flags[key] = val;
        if (!hasInlineValue) i++;
        continue;
      }
      fail(`unknown flag: --${key}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function splitCommand(argv) {
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
        fail(`flag --${key} requires a value`);
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

/**
 * Format one row from an ItemView. Layout:
 *
 *   [indent]<path> (📍)(✅) title (✏️)
 *
 * The absolute path replaces the bracket-position notation so spine
 * ancestors (which only show one item per depth, with trimmed siblings)
 * still self-describe — `/1/3` reads as "third child of root 1" without
 * needing the surrounding peers for context.
 *
 * - 📍 (active) and ✅ (done) sit between the path and the title.
 * - ✏️ (has notes) is appended after the title.
 */
function formatItemLine(item, activeKey, indent) {
  const leading = [];
  if (item.key === activeKey) leading.push('📍');
  if (item.done) leading.push('✅');
  const prefix = leading.length ? leading.join('') + ' ' : '';
  const trailing = Array.isArray(item.notes) && item.notes.length ? ' ✏️' : '';
  return `${indent}${item.path ?? '?'} ${prefix}${item.title}${trailing}`;
}

/**
 * Render a CurrentTreeView as the human "current tree" view. The view is
 * a recursive tree of nodes — each node has an optional `children` slot
 * that's either `null` (a leaf of this view) or an array of more nodes.
 * Walk it directly: print the node, recurse into children if present,
 * append note bodies when we hit the target.
 */
function printView(view, opts = {}) {
  if (!view || !Array.isArray(view.items) || view.items.length === 0) {
    process.stdout.write('(no item)\n');
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
  process.stdout.write(lines.join('\n') + '\n');
}

function printJson(envelope) {
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

function emitOutput(flags, human, data) {
  if (flags.json) {
    printJson(formatSuccess({ verb: exitContext.verb, file: exitContext.file, data }));
    return;
  }
  human();
  if (flags.debug) {
    process.stdout.write('\n');
    printJson(formatSuccess({ verb: exitContext.verb, file: exitContext.file, data }));
  }
}

/** Render a verb's CurrentTreeView in both human and JSON modes. */
function emitView(view, flags, opts = {}) {
  if (view === null || view === undefined) {
    emitOutput(flags, () => process.stdout.write('(no item)\n'), view ?? null);
    return;
  }
  emitOutput(
    flags,
    () => printView(view, { includeNotes: Boolean(opts.includeNotes) }),
    view,
  );
}

// ── Flag → API options translators ───────────────────────────────────────────

function getFile(flags) {
  const file = resolveFile({ file: flags.file }).file;
  exitContext.file = file;
  return file;
}
function hasGoto(flags) { return Object.prototype.hasOwnProperty.call(flags, 'goto'); }
function gotoOpt(flags) { return hasGoto(flags) ? flags.goto : undefined; }

function parsePlacement(flags, commandName) {
  const present = ['before', 'after', 'into'].filter((k) => flags[k] !== undefined);
  if (present.length === 0) return undefined;
  if (present.length > 1) fail(`${commandName}: --before, --after, and --into are mutually exclusive`);
  const kind = present[0];
  return { kind, anchor: flags[kind] };
}

// ── Command dispatch ─────────────────────────────────────────────────────────

function cmdPush({ positional, flags }) {
  const title = flags.title || positional.join(' ').trim();
  const file = getFile(flags);
  emitView(apiPush(file, { title }), flags);
}

function cmdAdd({ positional, flags }) {
  const title = flags.title || positional.join(' ').trim();
  const file = getFile(flags);
  emitView(apiAdd(file, {
    title,
    placement: parsePlacement(flags, 'add'),
    goto: gotoOpt(flags),
  }), flags);
}

function cmdMove({ positional, flags }) {
  if (positional.length > 1) fail('move: accepts at most one path');
  const file = getFile(flags);
  emitView(apiMove(file, {
    path: positional[0],
    placement: parsePlacement(flags, 'move'),
    goto: gotoOpt(flags),
  }), flags);
}

function cmdGoto({ positional, flags }) {
  if (!positional[0]) fail('goto: path required');
  const file = getFile(flags);
  emitView(apiGoto(file, { path: positional[0] }), flags);
}

function closeFlags(flags) {
  return {
    force: flags.force === true,
    closeAll: flags.closeall === true,
  };
}

function cmdDone({ positional, flags }) {
  if (positional.length > 1) fail('done: accepts at most one path');
  const file = getFile(flags);
  emitView(apiDone(file, {
    path: positional[0],
    ...closeFlags(flags),
    ...(hasGoto(flags) ? { goto: flags.goto } : {}),
  }), flags);
}

function cmdPop({ positional, flags }) {
  if (positional.length > 0) fail('pop: takes no path; pop always operates on the active item');
  if (hasGoto(flags)) fail('pop: --goto is not supported; pop always moves to the active item\'s parent');
  const file = getFile(flags);
  emitView(apiPop(file, closeFlags(flags)), flags);
}

function cmdSet({ positional, flags }) {
  if (flags.done === true && flags.undone === true) {
    fail('set: --done and --undone are mutually exclusive');
  }
  if (positional.length > 1) fail('set: accepts at most one path');
  const file = getFile(flags);
  const opts = {
    path: positional[0],
    goto: gotoOpt(flags),
    ...closeFlags(flags),
  };
  if (flags.done === true) opts.done = true;
  else if (flags.undone === true) opts.done = false;
  if (flags.title !== undefined) opts.title = flags.title;
  emitView(apiSet(file, opts), flags);
}

function cmdShow({ positional, flags }) {
  const file = getFile(flags);
  const allUp = flags.allup === true || flags.all === true;
  const allDown = flags.alldown === true || flags.all === true;
  if (allDown && flags.nokids === true) {
    fail('show: --alldown and --nokids are mutually exclusive');
  }
  const view = apiShow(file, {
    path: positional[0],
    nokids: flags.nokids === true,
    allUp,
    allDown,
    goto: gotoOpt(flags),
  });
  if (view === null) {
    emitOutput(flags, () => process.stdout.write('(no active item; pass a path)\n'), null);
    return;
  }
  emitView(view, flags, { includeNotes: flags.notes === true });
}

function cmdNote({ positional, flags }) {
  const file = getFile(flags);
  let pathArg;
  let textParts = positional;
  if (positional.length > 0 && looksLikePath(positional[0])) {
    pathArg = positional[0];
    textParts = positional.slice(1);
  }
  emitView(apiNote(file, {
    path: pathArg,
    text: textParts.join(' ').trim(),
    goto: gotoOpt(flags),
  }), flags);
}

function cmdDelete({ positional, flags }) {
  if (hasGoto(flags)) fail('delete: --goto is not supported');
  if (positional.length === 0) fail('delete: path required');
  if (positional.length > 1) fail('delete: accepts at most one path');
  const file = getFile(flags);
  const result = apiDelete(file, {
    path: positional[0],
    recursive: flags.recursive === true,
  });
  emitOutput(
    flags,
    () => {
      const tail = result.descendantCount ? ` and ${result.descendantCount} descendant(s)` : '';
      process.stdout.write(`deleted ${result.deleted.path}${tail}\n`);
      if (result.view) printView(result.view);
      else process.stdout.write('(tree is now empty)\n');
    },
    result,
  );
}

function cmdWhere({ flags }) {
  const info = apiWhere({ file: flags.file });
  exitContext.file = info.file;
  emitOutput(
    flags,
    () => {
      process.stdout.write(`${info.file}\n`);
      process.stdout.write(`  source: ${info.source}\n`);
      process.stdout.write(`  exists: ${info.exists}\n`);
    },
    info,
  );
}

function cmdHelp() {
  process.stdout.write([
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
    '  done [<path>] [--force|--closeall]',
    '                                  mark done, then make the parent active (idempotent);',
    '                                  --closeall closes any open descendants first;',
    '                                  --force closes the target anyway, leaving kids open',
    '  pop [--force|--closeall]        same as `done` on the active item (no path)',
    '  set [<path>] [--done|--undone] [--title T] [--force|--closeall] [--goto [path]]',
    '                                  set an item\'s state and/or title (idempotent);',
    '                                  --done/--undone change lifecycle state;',
    '                                  --title T renames the item;',
    '                                  pass at least one of those three',
    '  show [<path>] [--nokids|--alldown] [--allup] [--all] [--notes] [--goto [path]]',
    '                                  current tree view; --notes adds note bodies;',
    '                                  --allup shows all sibling rows along the spine;',
    '                                  --alldown expands the target subtree recursively;',
    '                                  --all = --allup --alldown',
    '  note [<path>] <text…> [--goto [path]]',
    '                                  append a timestamped note',
    '  delete <path> [--recursive]     remove an item; --recursive also removes its subtree',
    '  where                           print which noggin file would be used and why',
    '  help',
    '',
    'Item creation flags (push/add):',
    '  --title T                       title (alternative to positional)',
    '',
    'Common:',
    '  --file <path>                   override the file resolution (highest priority)',
    '  --goto [path]                   move after command; relative paths resolve from target',
    '  --json                          structured output',
    '  --debug                         human output followed by structured output',
    '',
    'File resolution (highest first):',
    '  1. --file <path>',
    `  2. $NOGGIN_FILE env var`,
    `  3. ${DEFAULT_FILE}`,
    '',
  ].join('\n'));
}

// ── Main ─────────────────────────────────────────────────────────────────────

function dispatch(verb, parsed) {
  switch (verb) {
    case 'push':      return cmdPush(parsed);
    case 'add':       return cmdAdd(parsed);
    case 'move':      return cmdMove(parsed);
    case 'goto':      return cmdGoto(parsed);
    case 'done':      return cmdDone(parsed);
    case 'pop':       return cmdPop(parsed);
    case 'set':       return cmdSet(parsed);
    case 'show':      return cmdShow(parsed);
    case 'note':      return cmdNote(parsed);
    case 'delete':    return cmdDelete(parsed);
    case 'where':     return cmdWhere(parsed);
    case 'help':
    case '--help':
    case '-h':        cmdHelp(); return;
    default:          fail(`unknown command: ${verb} (try 'help')`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { cmdHelp(); process.exit(0); }
  const { verb, args } = splitCommand(argv);
  const parsed = parseArgs(args);
  exitContext.verb = verb || null;
  exitContext.json = Boolean(parsed.flags.json);
  if (parsed.flags.help) { cmdHelp(); process.exit(0); }
  try {
    dispatch(verb, parsed);
  } catch (e) {
    if (e instanceof NogginError) {
      fail(e.message, e.exitCode, e.code);
    }
    throw e;
  }
}

main();
