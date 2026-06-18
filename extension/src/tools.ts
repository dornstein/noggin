import * as vscode from 'vscode';
import type { Placement, PlacementKind } from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';

interface ToolDeps {
  handle: NogginHandle;
}

type ToolHandler = (input: any, deps: ToolDeps) => unknown;

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
    notes: input?.notes === true,
    nokids: input?.nokids === true,
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
  }),

  noggin_pop: (_input, { handle }) => handle.pop(),

  noggin_set_state: (input, { handle }) => {
    const state = input?.state;
    if (state !== 'done' && state !== 'undone') throw new Error('noggin_set_state: state must be "done" or "undone"');
    return handle.setState({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      done: state === 'done',
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

  noggin_retitle: (input, { handle }) => {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('noggin_retitle: title is required');
    return handle.retitle({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      title,
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
    try {
      const data = this.handler(options.input, this.deps);
      const payload = { status: 'ok', tool: this.name, data };
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2)),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({ status: 'error', tool: this.name, error: msg })),
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
