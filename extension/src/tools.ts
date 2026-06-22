import * as vscode from 'vscode';
import {
  formatSuccess,
  formatError,
  type Placement,
  type PlacementKind,
} from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';

interface ToolDeps {
  handle: NogginHandle;
}

type ToolHandler = (input: any, deps: ToolDeps) => unknown | Promise<unknown>;

function placementFrom(input: any, opts: { required: boolean }): Placement | undefined {
  const kinds: PlacementKind[] = ['before', 'after', 'into'];
  const present = kinds.filter((k) => input?.[k]);
  if (present.length === 0) {
    if (opts.required) throw new Error('exactly one of before/after/into is required');
    return undefined;
  }
  if (present.length > 1) throw new Error('choose at most one of before/after/into');
  const kind = present[0]!;
  return { kind, anchor: String(input[kind]) };
}

const TOOLS: Record<string, ToolHandler> = {
  noggin_show: (input, { handle }) => handle.show({
    path: typeof input?.path === 'string' && input.path ? input.path : undefined,
    withNotes: input?.withNotes === true,
    includeChildren: input?.noChildren === true ? false : undefined,
    withSiblings: input?.withSiblings === true || input?.withAll === true,
    withDescendants: input?.withDescendants === true || input?.withAll === true,
  }),

  noggin_push: (input, { handle }) => {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('noggin_push: title is required');
    return handle.push({ title });
  },

  noggin_add: (input, { handle }) => {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('noggin_add: title is required');
    let placement: Placement | undefined;
    try { placement = placementFrom(input, { required: false }); }
    catch (e) { throw new Error(`noggin_add: ${(e as Error).message}`); }
    return handle.add({
      title,
      placement,
      goto: input?.goto !== undefined ? input.goto : undefined,
    });
  },

  noggin_goto: (input, { handle }) => {
    const p = String(input?.path ?? '').trim();
    if (!p) throw new Error('noggin_goto: path is required');
    return handle.goto(p);
  },

  noggin_done: (input, { handle }) => handle.done({
    path: typeof input?.path === 'string' && input.path ? input.path : undefined,
    force: input?.force === true,
    closeAll: input?.closeAll === true,
  }),

  noggin_pop: (input, { handle }) => handle.pop({
    force: input?.force === true,
    closeAll: input?.closeAll === true,
  }),

  noggin_edit: (input, { handle }) => {
    const state = input?.state;
    const hasState = state === 'done' || state === 'open';
    const rawTitle = typeof input?.title === 'string' ? input.title : undefined;
    const hasTitle = typeof rawTitle === 'string' && rawTitle.trim() !== '';
    if (!hasState && !hasTitle) {
      throw new Error('noggin_edit: pass at least one of state ("done"/"open") or title');
    }
    if (state !== undefined && !hasState) {
      throw new Error('noggin_edit: state must be "done" or "open"');
    }
    return handle.edit({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      done: hasState ? state === 'done' : undefined,
      title: hasTitle ? rawTitle : undefined,
      force: input?.force === true,
      closeAll: input?.closeAll === true,
      goto: input?.goto !== undefined ? input.goto : undefined,
    });
  },

  noggin_note: (input, { handle }) => {
    const text = String(input?.text ?? '');
    if (!text.trim()) throw new Error('noggin_note: text is required');
    return handle.note({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      text,
    });
  },

  noggin_move: (input, { handle }) => {
    let placement: Placement;
    try { placement = placementFrom(input, { required: true })!; }
    catch (e) { throw new Error(`noggin_move: ${(e as Error).message}`); }
    return handle.move({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      placement,
    });
  },

  noggin_delete: (input, { handle }) => {
    const p = String(input?.path ?? '').trim();
    if (!p) throw new Error('noggin_delete: path is required');
    return handle.delete({ path: p, recursive: input?.recursive === true });
  },
};

class NogginTool implements vscode.LanguageModelTool<any> {
  constructor(
    private readonly name: string,
    private readonly handler: ToolHandler,
    private readonly deps: ToolDeps,
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<any>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const verb = this.name.replace(/^noggin_/, '').replace(/_/g, '-');
    try {
      const data = await this.handler(options.input, this.deps);
      const envelope = formatSuccess({ verb, data });
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(envelope, null, 2)),
      ]);
    } catch (err) {
      const envelope = formatError({ verb, error: err });
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(envelope, null, 2)),
      ]);
    }
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<any>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const summary = summarize(this.name, options.input);
    return { invocationMessage: summary };
  }
}

function summarize(name: string, input: any): string {
  const verb = name.replace(/^noggin_/, '').replace(/_/g, '-');
  const bits: string[] = [];
  if (input?.path) bits.push(String(input.path));
  if (input?.title) bits.push(`"${input.title}"`);
  if (input?.text) bits.push(`"${truncate(String(input.text), 40)}"`);
  if (input?.state) bits.push(`--${input.state}`);
  if (input?.force) bits.push('--force');
  if (input?.closeAll) bits.push('--close-all');
  for (const k of ['before', 'after', 'into', 'goto']) {
    if (input?.[k]) bits.push(`--${k} ${input[k]}`);
  }
  return `noggin ${verb}${bits.length ? ' ' + bits.join(' ') : ''}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  deps: ToolDeps,
): void {
  for (const [name, handler] of Object.entries(TOOLS)) {
    context.subscriptions.push(
      vscode.lm.registerTool(name, new NogginTool(name, handler, deps)),
    );
  }
}
