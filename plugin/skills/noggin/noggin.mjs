#!/usr/bin/env node
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
  apiPush, apiAdd, apiMove, apiGoto, apiDone, apiPop, apiSetState,
  apiShow, apiNote, apiRetitle, apiDelete, apiWhere,
  loadStore, resolveFile, DEFAULT_FILE, NogginError,
} from './noggin-api.mjs';

// ── Argument parsing ─────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['file', 'title', 'before', 'after', 'into']);
const OPTIONAL_VALUE_FLAGS = new Set(['goto']);
const BOOL_FLAGS = new Set(['json', 'debug', 'help', 'nokids', 'notes', 'done', 'undone', 'recursive']);

function fail(msg, code = 2) {
  process.stderr.write(`noggin: ${msg}\n`);
  process.exit(code);
}

function looksLikePath(value) {
  const text = String(value ?? '');
  if (text === '.' || text === '..' || text === '-' || text === '+') return true;
  if (text.startsWith('./') || text.startsWith('../')) return true;
  if (text.startsWith('-/') || text.startsWith('+/')) return true;
  if (/^\d+(?:\/\d+)*$/.test(text)) return true;
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

function findByKey(items, key) {
  if (!key) return null;
  return items.find((f) => f.key === key) || null;
}

function childrenOf(items, parentKey) {
  return items.filter((f) => f.parentKey === parentKey);
}

function positionOf(items, item) {
  if (!item) return null;
  const siblings = childrenOf(items, item.parentKey);
  const index = siblings.findIndex((s) => s.key === item.key);
  return index >= 0 ? index + 1 : null;
}

function ancestorsOf(items, item) {
  const chain = [];
  let f = item;
  while (f && f.parentKey) {
    const p = findByKey(items, f.parentKey);
    if (!p) break;
    chain.unshift(p);
    f = p;
  }
  return chain;
}

function formatItemLine(items, f, activeKey, indent) {
  const position = positionOf(items, f);
  const indicators = [];
  if (f.key === activeKey) indicators.push('📍');
  if (f.done) indicators.push('✅');
  if (Array.isArray(f.notes) && f.notes.length) indicators.push('✏️');
  return `${indent}[${position}${indicators.join('')}] ${f.title}`;
}

function printItem(items, f, opts = {}) {
  if (!f) { process.stdout.write('(no item)\n'); return; }
  const lineage = opts.includeAncestors ? [...ancestorsOf(items, f), f] : [f];
  const lines = [];

  function appendItemDetails(item, depth) {
    const detailIndent = '  '.repeat(depth);
    if (opts.includeChildren) {
      const kids = childrenOf(items, item.key);
      const childIndent = '  '.repeat(depth + 1);
      for (const k of kids) {
        lines.push(formatItemLine(items, k, opts.activeKey, childIndent));
      }
    }
    if (opts.includeNotes) {
      const notes = Array.isArray(item.notes) ? item.notes : [];
      lines.push(`${detailIndent}  notes:${notes.length ? '' : ' (none)'}`);
      for (const note of notes) {
        lines.push(`${detailIndent}    - ${note.timestamp || '(no timestamp)'}`);
        for (const ln of (note.text || '').split('\n')) lines.push(`${detailIndent}      ${ln}`);
      }
    }
  }

  function appendSpine(depth) {
    const currentAtDepth = lineage[depth];
    const indent = '  '.repeat(depth);
    const peers = opts.includeSiblings
      ? childrenOf(items, currentAtDepth.parentKey || null)
      : [currentAtDepth];
    for (const peer of peers) {
      lines.push(formatItemLine(items, peer, opts.activeKey, indent));
      if (peer.key !== currentAtDepth.key) continue;
      if (depth === lineage.length - 1) {
        appendItemDetails(currentAtDepth, depth);
      } else {
        appendSpine(depth + 1);
      }
    }
  }

  appendSpine(0);
  process.stdout.write(lines.join('\n') + '\n');
}

function pruneDefaults(value) {
  if (Array.isArray(value)) return value.map(pruneDefaults);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const v = pruneDefaults(raw);
    if (v === null || v === undefined) continue;
    if (v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    result[key] = v;
  }
  return result;
}

function printJson(data) {
  process.stdout.write(JSON.stringify(pruneDefaults({ status: 'ok', data }), null, 2) + '\n');
}

function emitOutput(flags, human, data) {
  if (flags.json) {
    printJson(data);
    return;
  }
  human();
  if (flags.debug) {
    process.stdout.write('\n');
    printJson(data);
  }
}

// Render a verb's CurrentTreeView. Re-loads the file so the human printer
// can walk siblings at every spine depth, not just those carried in the view.
function emitView(file, view, flags, opts = {}) {
  if (view === null || view === undefined) {
    emitOutput(flags, () => process.stdout.write('(no item)\n'), view ?? null);
    return;
  }
  emitOutput(
    flags,
    () => {
      const store = loadStore(file);
      const target = findByKey(store.items, view.key);
      if (!target) { process.stdout.write('(no item)\n'); return; }
      printItem(store.items, target, {
        activeKey: store.active,
        includeAncestors: true,
        includeSiblings: true,
        includeChildren: opts.includeChildren !== false,
        includeNotes: Boolean(opts.includeNotes),
      });
    },
    view,
  );
}

// ── Flag → API options translators ───────────────────────────────────────────

function getFile(flags) { return resolveFile({ file: flags.file }).file; }
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
  const view = apiPush(file, { title });
  emitView(file, view, flags);
}

function cmdAdd({ positional, flags }) {
  const title = flags.title || positional.join(' ').trim();
  const file = getFile(flags);
  const view = apiAdd(file, {
    title,
    placement: parsePlacement(flags, 'add'),
    goto: gotoOpt(flags),
  });
  emitView(file, view, flags);
}

function cmdMove({ positional, flags }) {
  if (positional.length > 1) fail('move: accepts at most one path');
  const file = getFile(flags);
  const view = apiMove(file, {
    path: positional[0],
    placement: parsePlacement(flags, 'move'),
    goto: gotoOpt(flags),
  });
  emitView(file, view, flags);
}

function cmdGoto({ positional, flags }) {
  if (!positional[0]) fail('goto: path required');
  const file = getFile(flags);
  const view = apiGoto(file, { path: positional[0] });
  emitView(file, view, flags);
}

function cmdDone({ positional, flags }) {
  if (positional.length > 1) fail('done: accepts at most one path');
  const file = getFile(flags);
  const view = apiDone(file, {
    path: positional[0],
    ...(hasGoto(flags) ? { goto: flags.goto } : {}),
  });
  emitView(file, view, flags);
}

function cmdPop({ positional, flags }) {
  if (positional.length > 0) fail('pop: takes no path; pop always operates on the active item');
  if (hasGoto(flags)) fail('pop: --goto is not supported; pop always moves to the active item\'s parent');
  const file = getFile(flags);
  const view = apiPop(file, {});
  emitView(file, view, flags);
}

function cmdSetState({ positional, flags }) {
  if (flags.done === true && flags.undone === true) fail('set-state: choose exactly one of --done or --undone');
  if (flags.done !== true && flags.undone !== true) fail('set-state: choose exactly one of --done or --undone');
  if (positional.length > 1) fail('set-state: accepts at most one path');
  const file = getFile(flags);
  const view = apiSetState(file, {
    path: positional[0],
    done: flags.done === true,
    goto: gotoOpt(flags),
  });
  emitView(file, view, flags);
}

function cmdShow({ positional, flags }) {
  const file = getFile(flags);
  const view = apiShow(file, {
    path: positional[0],
    nokids: flags.nokids === true,
    goto: gotoOpt(flags),
  });
  if (view === null) {
    emitOutput(flags, () => process.stdout.write('(no active item; pass a path)\n'), null);
    return;
  }
  emitView(file, view, flags, {
    includeChildren: flags.nokids !== true,
    includeNotes: flags.notes === true,
  });
}

function cmdNote({ positional, flags }) {
  const file = getFile(flags);
  let pathArg;
  let textParts = positional;
  if (positional.length > 0 && looksLikePath(positional[0])) {
    pathArg = positional[0];
    textParts = positional.slice(1);
  }
  const view = apiNote(file, {
    path: pathArg,
    text: textParts.join(' ').trim(),
    goto: gotoOpt(flags),
  });
  emitView(file, view, flags);
}

function cmdRetitle({ positional, flags }) {
  const file = getFile(flags);
  let pathArg;
  let textStart = 0;
  if (positional.length > 0 && looksLikePath(positional[0])) {
    pathArg = positional[0];
    textStart = 1;
  }
  const view = apiRetitle(file, {
    path: pathArg,
    title: flags.title || positional.slice(textStart).join(' ').trim(),
    goto: gotoOpt(flags),
  });
  emitView(file, view, flags);
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
  if (result.view) {
    emitView(file, result.view, flags);
  } else {
    emitOutput(
      flags,
      () => process.stdout.write(`deleted ${result.deleted}${result.descendantCount ? ` and ${result.descendantCount} descendant(s)` : ''}\n`),
      { deleted: result.deleted, descendantCount: result.descendantCount, active: null },
    );
  }
}

function cmdWhere({ flags }) {
  const info = apiWhere({ file: flags.file });
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
    '  path   absolute 1-based positions, e.g. "1/2/3"',
    '         or relative to active: ".", "..", "-", "+", "./X/Y", "../X", "-/X/Y", "+/X/Y"',
    '  tree   bracket indicators: 📍 active, ✅ done, ✏️ has notes',
    '',
    'Verbs:',
    '  push <title>                    child of active, becomes active',
    '  add  <title> [--before|--after|--into <path>] [--goto [path]]',
    '                                  child of active by default; placement flags pick a different spot',
    '  move [<path>] (--before|--after|--into <path>) [--goto [path]]',
    '                                  relocate an item; required placement flag picks the destination',
    '  goto <path>                     make <path> the active item',
    '  done [<path>]                   mark done, then make the parent active',
    '  pop                             same as `done` on the active item (no path)',
    '  set-state [<path>] (--done|--undone) [--goto [path]]',
    '                                  explicitly set state; --goto with no path activates target',
    '  show [<path>] [--nokids] [--notes] [--goto [path]]',
    '                                  current tree view; add --notes to include note bodies',
    '  note [<path>] <text…> [--goto [path]]',
    '                                  append a timestamped note',
    '  retitle [<path>] <new title…> [--goto [path]]',
    '                                  change an item title',
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
    case 'set-state': return cmdSetState(parsed);
    case 'show':      return cmdShow(parsed);
    case 'note':      return cmdNote(parsed);
    case 'retitle':   return cmdRetitle(parsed);
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
  if (parsed.flags.help) { cmdHelp(); process.exit(0); }
  try {
    dispatch(verb, parsed);
  } catch (e) {
    if (e instanceof NogginError) {
      fail(e.message, e.exitCode);
    }
    throw e;
  }
}

main();
