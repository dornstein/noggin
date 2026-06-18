import * as vscode from 'vscode';
import { CliError, CliRunner } from './cli';
import { NogginStore } from './store';

interface ToolDeps {
  cli: CliRunner;
  store: NogginStore;
}

type ToolHandler = (input: any, deps: ToolDeps) => Promise<{ verb: string; args: string[] }>;

const TOOLS: Record<string, ToolHandler> = {
  noggin_show: async (input) => {
    const args: string[] = [];
    if (typeof input?.path === 'string' && input.path) args.push(input.path);
    if (input?.notes === true) args.push('--notes');
    if (input?.nokids === true) args.push('--nokids');
    return { verb: 'show', args };
  },

  noggin_push: async (input) => {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('noggin_push: title is required');
    return { verb: 'push', args: ['--title', title] };
  },

  noggin_add: async (input) => {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('noggin_add: title is required');
    const args = ['--title', title];
    const placements = ['before', 'after', 'into'].filter((k) => input?.[k]);
    if (placements.length > 1) throw new Error('noggin_add: choose at most one of before/after/into');
    for (const k of placements) args.push(`--${k}`, String(input[k]));
    if (input?.goto) args.push('--goto', String(input.goto));
    return { verb: 'add', args };
  },

  noggin_goto: async (input) => {
    const path = String(input?.path ?? '').trim();
    if (!path) throw new Error('noggin_goto: path is required');
    return { verb: 'goto', args: [path] };
  },

  noggin_done: async (input) => {
    const args: string[] = [];
    if (typeof input?.path === 'string' && input.path) args.push(input.path);
    return { verb: 'done', args };
  },

  noggin_pop: async () => ({ verb: 'pop', args: [] }),

  noggin_set_state: async (input) => {
    const state = input?.state;
    if (state !== 'done' && state !== 'undone') throw new Error('noggin_set_state: state must be "done" or "undone"');
    const args: string[] = [];
    if (typeof input?.path === 'string' && input.path) args.push(input.path);
    args.push(state === 'done' ? '--done' : '--undone');
    if (input?.goto) args.push('--goto', String(input.goto));
    return { verb: 'set-state', args };
  },

  noggin_note: async (input) => {
    const text = String(input?.text ?? '');
    if (!text.trim()) throw new Error('noggin_note: text is required');
    const args: string[] = [];
    if (typeof input?.path === 'string' && input.path) args.push(input.path);
    args.push(text);
    return { verb: 'note', args };
  },

  noggin_retitle: async (input) => {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('noggin_retitle: title is required');
    const args: string[] = [];
    if (typeof input?.path === 'string' && input.path) args.push(input.path);
    args.push('--title', title);
    return { verb: 'retitle', args };
  },

  noggin_move: async (input) => {
    const placements = ['before', 'after', 'into'].filter((k) => input?.[k]);
    if (placements.length !== 1) throw new Error('noggin_move: exactly one of before/after/into is required');
    const args: string[] = [];
    if (typeof input?.path === 'string' && input.path) args.push(input.path);
    for (const k of placements) args.push(`--${k}`, String(input[k]));
    return { verb: 'move', args };
  },

  noggin_delete: async (input) => {
    const path = String(input?.path ?? '').trim();
    if (!path) throw new Error('noggin_delete: path is required');
    const args = [path];
    if (input?.recursive === true) args.push('--recursive');
    return { verb: 'delete', args };
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
      const { verb, args } = await this.handler(options.input, this.deps);
      const result = await this.deps.cli.run(verb, args);
      this.deps.store.refresh();
      const payload = { status: 'ok', verb, data: result };
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2)),
      ]);
    } catch (err) {
      const msg = err instanceof CliError ? err.message : (err as Error).message;
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
