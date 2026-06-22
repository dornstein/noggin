#!/usr/bin/env node
// AUTO-SYNCED FROM cli/noggin-mcp.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// noggin MCP server — exposes the noggin verbs over the Model Context Protocol
// via stdio. Hosts that can't see the VS Code language-model tools (Copilot CLI,
// Claude Code, Codex CLI) can spawn this server to get the same toolset.
//
// Usage:
//   noggin-mcp                 # uses NOGGIN env or default ~/.noggin.yaml
//   NOGGIN=/path npx noggin-mcp
//
// Wire-up (varies by host):
//   - Codex CLI: declared in plugin/.codex-plugin/plugin.json
//   - Claude Code / Copilot CLI: user adds an mcpServers entry pointing here
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
  factories, openNoggin as engineOpenNoggin, verbs,
} from './noggin-api.mjs';
import './backends/file.mjs'; // side-effect: registers the file:// factory
import os from 'node:os';
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

// Bundled clients (Codex plugin) and direct runs (npx noggin-mcp) both pick
// up the version from package.json — esbuild inlines the JSON, Node imports
// it at runtime.
const PKG = { name: 'noggin-mcp', version: pkg.version };

async function openNoggin() {
  const location = (process.env && process.env.NOGGIN) || path.join(os.homedir(), '.noggin.yaml');
  return engineOpenNoggin(location);
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

// Each tool: name, JSON-Schema inputSchema, and a handler that returns a
// value to embed in the envelope's `data` field. Throwing surfaces an error.
const TOOLS = [
  {
    name: 'noggin_show',
    description: 'Show the current-position view (spine + peers + first-level children). Default target is active.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        noChildren: { type: 'boolean', description: 'omit first-level children of the target' },
        withSiblings: { type: 'boolean', description: 'also include ancestor sibling rows at every depth' },
        withDescendants: { type: 'boolean', description: 'expand the target subtree recursively' },
        withAll: { type: 'boolean', description: 'shorthand for withSiblings + withDescendants' },
        withNotes: { type: 'boolean', description: 'include note bodies after the tree (human-readable)' },
      },
    },
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
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: { title: TITLE_PROP },
    },
    handler: (input, noggin) => {
      const title = String(input.title ?? '').trim();
      if (!title) throw new Error('title is required');
      return verbs.push(noggin, { title });
    },
  },
  {
    name: 'noggin_add',
    description: 'Add a child without making it active (capture a deferred todo).',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: TITLE_PROP,
        ...PLACEMENT_PROPS,
        goto: GOTO_PROP,
      },
    },
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
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: PATH_PROP },
    },
    handler: (input, noggin) => {
      const p = String(input.path ?? '').trim();
      if (!p) throw new Error('path is required');
      return verbs.goto(noggin, { path: p });
    },
  },
  {
    name: 'noggin_done',
    description: 'Mark target done and surface to its parent. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_PROP, ...CLOSE_FLAGS },
    },
    handler: (input, noggin) => verbs.done(noggin, {
      path: input.path,
      force: input.force === true,
      closeAll: input.closeAll === true,
    }),
  },
  {
    name: 'noggin_pop',
    description: 'Shorthand for done on the active item.',
    inputSchema: {
      type: 'object',
      properties: CLOSE_FLAGS,
    },
    handler: (input, noggin) => verbs.pop(noggin, {
      force: input.force === true,
      closeAll: input.closeAll === true,
    }),
  },
  {
    name: 'noggin_edit',
    description: 'Idempotent mutation of an item\'s state and/or title. Pass at least one of state or title.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        state: { type: 'string', enum: ['done', 'open'], description: 'set done/open state' },
        title: { type: 'string', description: 'new title (rename)' },
        ...CLOSE_FLAGS,
        goto: GOTO_PROP,
      },
    },
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
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        path: PATH_PROP,
        text: { type: 'string', description: 'note body (free-form)' },
      },
    },
    handler: (input, noggin) => {
      const text = String(input.text ?? '');
      if (!text.trim()) throw new Error('text is required');
      return verbs.note(noggin, { path: input.path, text });
    },
  },
  {
    name: 'noggin_move',
    description: 'Relocate an item. Exactly one of before/after/into is required.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_PROP, ...PLACEMENT_PROPS },
    },
    handler: (input, noggin) => verbs.move(noggin, {
      path: input.path,
      placement: placementFrom(input, { required: true }),
    }),
  },
  {
    name: 'noggin_delete',
    description: 'Remove an item. Pass recursive=true if it has descendants.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: PATH_PROP,
        recursive: { type: 'boolean', description: 'also delete descendants' },
      },
    },
    handler: (input, noggin) => {
      const p = String(input.path ?? '').trim();
      if (!p) throw new Error('path is required');
      return verbs.delete(noggin, { path: p, recursive: input.recursive === true });
    },
  },
  {
    name: 'noggin_where',
    description: 'Report which noggin would be used and why.',
    inputSchema: { type: 'object', properties: {} },
    handler: (_input, noggin) => noggin.describe(),
  },
  {
    name: 'noggin_factories',
    description: 'List registered backend factories.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => factories.list(),
  },
];

const server = new Server(PKG, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const tool = TOOLS.find((t) => t.name === name);
  const verb = name.replace(/^noggin_/, '').replace(/_/g, '-');
  const noggin = await openNoggin();
  if (!tool) {
    const envelope = formatError({ verb, error: new Error(`unknown tool: ${name}`) });
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
  }
  try {
    const data = await tool.handler(args, noggin);
    const envelope = formatSuccess({ verb, data });
    return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
  } catch (err) {
    const envelope = formatError({ verb, error: err });
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
