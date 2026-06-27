#!/usr/bin/env node
// AUTO-SYNCED FROM mcp/noggin-mcp.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// noggin MCP server — exposes the noggin verbs over the Model Context Protocol
// via stdio. Hosts that can't see the VS Code language-model tools (GitHub
// Copilot CLI, Claude Code, Codex) can spawn this server to get the same
// toolset.
//
// Multi-noggin: every tool call requires a `noggin` parameter, a canonical
// location string (e.g. `~/.noggin.yaml`, `./.noggin.yaml`, `file:///abs/path`).
// The server opens that noggin per call, caches the result for the lifetime
// of the process, and routes the verb to it. There is no server-wide default
// and no env-var fallback — every call carries the noggin it operates on so
// agents can work with multiple noggins in one session.
//
// Wire-up (varies by host):
//   - Codex CLI: declared in plugin/.codex-plugin/plugin.json
//   - Claude Code / GitHub Copilot CLI: user adds an mcpServers entry pointing here
//   - VS Code (outside the extension): user adds the same to .vscode/mcp.json
//
// The protocol layer (request parsing, schema validation, stdio framing) is
// provided by @modelcontextprotocol/sdk. Tool bodies just call the existing
// in-process API and wrap results in the same JSON envelope the CLI emits.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  formatSuccess, formatError,
  providers, openNoggin as engineOpenNoggin, verbs,
} from '@noggin/engine';
import '@noggin/engine/providers/file'; // side-effect: registers the file:// provider
import url from 'node:url';
import pkg from './package.json' with { type: 'json' };
import { mcpErrorMessage } from './error-messages.mjs';

// Bundled clients (Codex plugin) and direct runs (npx noggin-mcp) both pick
// up the version from package.json — esbuild inlines the JSON, Node imports
// it at runtime.
const PKG = { name: 'noggin-mcp', version: pkg.version };

// Per-process cache of opened noggins by canonical location string. Each
// noggin's mutator queue serializes its own writes, so the only sharing
// hazard is multiple cache entries for the same physical file under
// different location strings — that's fine because each FileNoggin holds
// its own cross-process lock at write time.
const _noggins = new Map();
async function openNogginByLocation(location) {
  let p = _noggins.get(location);
  if (!p) {
    p = engineOpenNoggin(location);
    _noggins.set(location, p);
    // If open fails, drop the rejected promise so a retry can try again
    // (e.g. user fixes the path).
    p.catch(() => _noggins.delete(location));
  }
  return p;
}

function placementFrom(input, { required }) {
  const kinds = ['before', 'after', 'into'];
  const present = kinds.filter((k) => input?.[k]);
  if (present.length === 0) {
    if (required) throw new Error('exactly one of before/after/into is required');
    return undefined;
  }
  if (present.length > 1) throw new Error('choose at most one of before/after/into');
  const kind = present[0];
  return { kind, anchor: String(input[kind]) };
}

const NOGGIN_PROP = {
  type: 'string',
  description: 'canonical location of the noggin to operate on — e.g. `~/.noggin.yaml`, `./.noggin.yaml`, `/abs/path.yaml`, or `file:///abs/path.yaml`. Required on every tool call.',
};
const PATH_PROP = { type: 'string', description: 'noggin path (absolute /1/2 or relative — see SKILL.md)' };
const TITLE_PROP = { type: 'string', description: 'item title (one line)' };
const GOTO_PROP = { type: ['string', 'boolean'], description: 'true = goto the target; string = goto this path after the verb' };
const PLACEMENT_PROPS = {
  before: { type: 'string', description: 'place as sibling before this anchor path' },
  after: { type: 'string', description: 'place as sibling after this anchor path' },
  into: { type: 'string', description: 'place as last child of this anchor path' },
};
const CLOSE_FLAGS = {
  force: { type: 'boolean', description: 'close even if open descendants exist (leaves them open)' },
  closeAll: { type: 'boolean', description: 'cascade-close all open descendants first' },
};

// Helper: build an inputSchema with `noggin` required first, plus any
// extra required keys. Avoids repeating the required/properties wiring
// in every tool definition.
function schemaWithNoggin({ properties = {}, required = [] } = {}) {
  return {
    type: 'object',
    required: ['noggin', ...required],
    properties: { noggin: NOGGIN_PROP, ...properties },
  };
}

// Each tool: name, JSON-Schema inputSchema, and a handler that returns a
// value to embed in the envelope's `data` field. Throwing surfaces an error.
//
// Exported so the docs site can render a generated tool reference without
// spawning the server. Anything importing this module gets the metadata
// for free; the stdio transport is only attached when this file is the
// entry point (see the main-guard at the bottom).
export const TOOLS = [
  {
    name: 'noggin_show',
    description: 'Show the current-position view (spine + peers + first-level children). Default target is active.',
    inputSchema: schemaWithNoggin({
      properties: {
        path: PATH_PROP,
        noChildren: { type: 'boolean', description: 'omit first-level children of the target' },
        withSiblings: { type: 'boolean', description: 'also include ancestor sibling rows at every depth' },
        withDescendants: { type: 'boolean', description: 'expand the target subtree recursively' },
        withAll: { type: 'boolean', description: 'shorthand for withSiblings + withDescendants' },
        withNotes: { type: 'boolean', description: 'include note bodies after the tree (human-readable)' },
      },
    }),
    handler: (input, noggin) => verbs.show(noggin, {
      path: input.path,
      includeChildren: input.noChildren === true ? false : undefined,
      withSiblings: input.withSiblings === true || input.withAll === true,
      withDescendants: input.withDescendants === true || input.withAll === true,
      withNotes: input.withNotes === true,
    }),
  },
  {
    name: 'noggin_push',
    description: 'Create a child of active and immediately become it (going on a side-quest).',
    inputSchema: schemaWithNoggin({
      required: ['title'],
      properties: { title: TITLE_PROP },
    }),
    handler: (input, noggin) => {
      const title = String(input.title ?? '').trim();
      if (!title) throw new Error('title is required');
      return verbs.push(noggin, { title });
    },
  },
  {
    name: 'noggin_add',
    description: 'Add a child without making it active (capture a deferred todo).',
    inputSchema: schemaWithNoggin({
      required: ['title'],
      properties: {
        title: TITLE_PROP,
        ...PLACEMENT_PROPS,
        goto: GOTO_PROP,
      },
    }),
    handler: (input, noggin) => {
      const title = String(input.title ?? '').trim();
      if (!title) throw new Error('title is required');
      return verbs.add(noggin, {
        title,
        placement: placementFrom(input, { required: false }),
        goto: input.goto,
      });
    },
  },
  {
    name: 'noggin_goto',
    description: 'Make the item at the given path active.',
    inputSchema: schemaWithNoggin({
      required: ['path'],
      properties: { path: PATH_PROP },
    }),
    handler: (input, noggin) => {
      const p = String(input.path ?? '').trim();
      if (!p) throw new Error('path is required');
      return verbs.goto(noggin, { path: p });
    },
  },
  {
    name: 'noggin_done',
    description: 'Mark target done and surface to its parent. Idempotent.',
    inputSchema: schemaWithNoggin({
      properties: { path: PATH_PROP, ...CLOSE_FLAGS },
    }),
    handler: (input, noggin) => verbs.done(noggin, {
      path: input.path,
      force: input.force === true,
      closeAll: input.closeAll === true,
    }),
  },
  {
    name: 'noggin_pop',
    description: 'Shorthand for done on the active item.',
    inputSchema: schemaWithNoggin({
      properties: CLOSE_FLAGS,
    }),
    handler: (input, noggin) => verbs.pop(noggin, {
      force: input.force === true,
      closeAll: input.closeAll === true,
    }),
  },
  {
    name: 'noggin_edit',
    description: 'Idempotent mutation of an item\'s state and/or title. Pass at least one of state or title.',
    inputSchema: schemaWithNoggin({
      properties: {
        path: PATH_PROP,
        state: { type: 'string', enum: ['done', 'open'], description: 'set done/open state' },
        title: { type: 'string', description: 'new title (rename)' },
        ...CLOSE_FLAGS,
        goto: GOTO_PROP,
      },
    }),
    handler: (input, noggin) => {
      const state = input.state;
      const hasState = state === 'done' || state === 'open';
      const rawTitle = typeof input.title === 'string' ? input.title : undefined;
      const hasTitle = typeof rawTitle === 'string' && rawTitle.trim() !== '';
      if (!hasState && !hasTitle) throw new Error('pass at least one of state ("done"/"open") or title');
      if (state !== undefined && !hasState) throw new Error('state must be "done" or "open"');
      return verbs.edit(noggin, {
        path: input.path,
        done: hasState ? state === 'done' : undefined,
        title: hasTitle ? rawTitle : undefined,
        force: input.force === true,
        closeAll: input.closeAll === true,
        goto: input.goto,
      });
    },
  },
  {
    name: 'noggin_note',
    description: 'Append a timestamped note to an item (default: active).',
    inputSchema: schemaWithNoggin({
      required: ['text'],
      properties: {
        path: PATH_PROP,
        text: { type: 'string', description: 'note body (free-form)' },
      },
    }),
    handler: (input, noggin) => {
      const text = String(input.text ?? '');
      if (!text.trim()) throw new Error('text is required');
      return verbs.note(noggin, { path: input.path, text });
    },
  },
  {
    name: 'noggin_move',
    description: 'Relocate an item. Exactly one of before/after/into is required.',
    inputSchema: schemaWithNoggin({
      properties: { path: PATH_PROP, ...PLACEMENT_PROPS },
    }),
    handler: (input, noggin) => verbs.move(noggin, {
      path: input.path,
      placement: placementFrom(input, { required: true }),
    }),
  },
  {
    name: 'noggin_delete',
    description: 'Remove an item. Pass recursive=true if it has descendants.',
    inputSchema: schemaWithNoggin({
      required: ['path'],
      properties: {
        path: PATH_PROP,
        recursive: { type: 'boolean', description: 'also delete descendants' },
      },
    }),
    handler: (input, noggin) => {
      const p = String(input.path ?? '').trim();
      if (!p) throw new Error('path is required');
      return verbs.delete(noggin, { path: p, recursive: input.recursive === true });
    },
  },
  {
    name: 'noggin_where',
    description: 'Return the canonical location string of the given noggin (echoes back the `noggin` parameter, useful for confirming the value the server interpreted).',
    inputSchema: schemaWithNoggin(),
    handler: (_input, noggin) => noggin.describe(),
  },
  {
    name: 'noggin_copy',
    description: 'Append every item from `from` into `to` (whole-noggin, append-only). New keys are generated; notes, done state, and createdAt timestamps are preserved verbatim. Use to migrate a noggin between locations or duplicate a tree under one root.',
    inputSchema: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', description: 'canonical location of the SOURCE noggin (read-only)' },
        to: { type: 'string', description: 'canonical location of the DESTINATION noggin (mutated)' },
      },
    },
    // Two noggins, neither of them the standard `noggin` arg, so we
    // bypass the single-noggin dispatch path and open both ourselves.
    skipNoggin: true,
    handler: async (input) => {
      const fromLoc = typeof input.from === 'string' ? input.from.trim() : '';
      const toLoc = typeof input.to === 'string' ? input.to.trim() : '';
      if (!fromLoc) throw new Error('`from` is required: the source noggin location');
      if (!toLoc) throw new Error('`to` is required: the destination noggin location');
      const source = await openNogginByLocation(fromLoc);
      const dest = await openNogginByLocation(toLoc);
      return verbs.copy(source, dest, {});
    },
  },
  {
    name: 'noggin_providers',
    description: 'List providers registered in this MCP server (e.g. file://). Useful for discovering what location forms the server accepts.',
    // No `noggin` param: this verb introspects the server itself, not a noggin.
    inputSchema: { type: 'object', properties: {} },
    handler: () => providers.list(),
    skipNoggin: true,
  },
];


// Only attach the stdio transport when this file is the entry point. Importing
// the module (e.g. from the docs generator) must not start a server.
if (typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1] &&
    import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  const server = new Server(PKG, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tool = TOOLS.find((t) => t.name === name);
    const verb = name.replace(/^noggin_/, '').replace(/_/g, '-');
    if (!tool) {
      const envelope = formatError({ verb, error: new Error(`unknown tool: ${name}`) });
      envelope.error.message = mcpErrorMessage({ verb, ...envelope.error });
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    }
    try {
      let data;
      if (tool.skipNoggin) {
        data = await tool.handler(args);
      } else {
        const location = typeof args.noggin === 'string' ? args.noggin.trim() : '';
        if (!location) throw new Error('`noggin` parameter is required: pass the canonical location of the noggin to operate on (e.g. "~/.noggin.yaml")');
        const noggin = await openNogginByLocation(location);
        data = await tool.handler(args, noggin);
      }
      const envelope = formatSuccess({ verb, data });
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    } catch (err) {
      const envelope = formatError({ verb, error: err });
      envelope.error.message = mcpErrorMessage({ verb, ...envelope.error });
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
