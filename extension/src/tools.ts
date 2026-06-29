import * as vscode from 'vscode';
import {
  formatSuccess,
  formatError,
  providers,
  type Noggin,
  type Placement,
  type PlacementKind,
} from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';

interface ToolDeps {
  handle: NogginHandle;
}

/**
 * Per-tool handler. Receives:
 *   - input:  the LM-provided JSON-Schema-validated arguments
 *   - noggin: the resolved Noggin (open VS Code noggin OR a transient
 *             opened from `input.noggin`); `null` for introspection
 *             tools (`noggin_providers`) that don't operate on a noggin
 *
 * Throwing surfaces as an error envelope; the returned value becomes
 * `data` in a success envelope.
 */
type ToolHandler = (input: any, noggin: Noggin | null) => unknown | Promise<unknown>;

/**
 * Tool descriptor. `needsNoggin` is true for the 11 verbs that operate
 * on a noggin (everything except `noggin_providers`). When true, the
 * wrapper resolves `input.noggin` via the handle (defaulting to the
 * open noggin) and passes it to the handler.
 */
interface ToolDef {
  handler: ToolHandler;
  needsNoggin: boolean;
}

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

const TOOLS: Record<string, ToolDef> = {
  noggin_show: {
    needsNoggin: true,
    handler: (input, noggin) => noggin!.show({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      withNotes: input?.withNotes === true,
      includeChildren: input?.noChildren === true ? false : undefined,
      withSiblings: input?.withSiblings === true || input?.withAll === true,
      withDescendants: input?.withDescendants === true || input?.withAll === true,
    }),
  },

  noggin_push: {
    needsNoggin: true,
    handler: (input, noggin) => {
      const title = String(input?.title ?? '').trim();
      if (!title) throw new Error('noggin_push: title is required');
      return noggin!.push({ title });
    },
  },

  noggin_add: {
    needsNoggin: true,
    handler: (input, noggin) => {
      const title = String(input?.title ?? '').trim();
      if (!title) throw new Error('noggin_add: title is required');
      let placement: Placement | undefined;
      try { placement = placementFrom(input, { required: false }); }
      catch (e) { throw new Error(`noggin_add: ${(e as Error).message}`); }
      return noggin!.add({
        title,
        placement,
        goto: input?.goto !== undefined ? input.goto : undefined,
      });
    },
  },

  noggin_goto: {
    needsNoggin: true,
    handler: (input, noggin) => {
      const p = String(input?.path ?? '').trim();
      if (!p) throw new Error('noggin_goto: path is required');
      return noggin!.goto({ path: p });
    },
  },

  noggin_done: {
    needsNoggin: true,
    handler: (input, noggin) => noggin!.done({
      path: typeof input?.path === 'string' && input.path ? input.path : undefined,
      force: input?.force === true,
      closeAll: input?.closeAll === true,
    }),
  },

  noggin_pop: {
    needsNoggin: true,
    handler: (input, noggin) => noggin!.pop({
      force: input?.force === true,
      closeAll: input?.closeAll === true,
    }),
  },

  noggin_edit: {
    needsNoggin: true,
    handler: (input, noggin) => {
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
      return noggin!.edit({
        path: typeof input?.path === 'string' && input.path ? input.path : undefined,
        done: hasState ? state === 'done' : undefined,
        title: hasTitle ? rawTitle : undefined,
        force: input?.force === true,
        closeAll: input?.closeAll === true,
        goto: input?.goto !== undefined ? input.goto : undefined,
      });
    },
  },

  noggin_note: {
    needsNoggin: true,
    handler: (input, noggin) => {
      const text = String(input?.text ?? '');
      if (!text.trim()) throw new Error('noggin_note: text is required');
      return noggin!.note({
        path: typeof input?.path === 'string' && input.path ? input.path : undefined,
        text,
      });
    },
  },

  noggin_move: {
    needsNoggin: true,
    handler: (input, noggin) => {
      let placement: Placement;
      try { placement = placementFrom(input, { required: true })!; }
      catch (e) { throw new Error(`noggin_move: ${(e as Error).message}`); }
      return noggin!.move({
        path: typeof input?.path === 'string' && input.path ? input.path : undefined,
        placement,
      });
    },
  },

  noggin_delete: {
    needsNoggin: true,
    handler: (input, noggin) => {
      const p = String(input?.path ?? '').trim();
      if (!p) throw new Error('noggin_delete: path is required');
      return noggin!.delete({ path: p, recursive: input?.recursive === true });
    },
  },

  noggin_where: {
    needsNoggin: true,
    handler: (_input, noggin) => noggin!.describe(),
  },

  noggin_providers: {
    needsNoggin: false,
    handler: () => providers.list(),
  },

  // noggin_copy stays at the handle level because it takes TWO
  // noggins (from + to) — the standard `noggin` arg + handle.resolve()
  // shape doesn't fit. handle.copy() applies the same defaulting rules
  // (each side defaults to the open noggin if omitted).
  noggin_copy: {
    needsNoggin: false,
    handler: async (input, _noggin) => {
      const from = typeof input?.from === 'string' && input.from.trim() ? input.from.trim() : undefined;
      const to = typeof input?.to === 'string' && input.to.trim() ? input.to.trim() : undefined;
      if (!from && !to) {
        throw new Error('noggin_copy: pass at least one of `from` or `to` (the unspecified side defaults to the open noggin)');
      }
      // Stashed on the closure via the wrapper below.
      throw new Error('noggin_copy: wrapper should have intercepted this');
    },
  },
};

class NogginTool implements vscode.LanguageModelTool<any> {
  constructor(
    private readonly name: string,
    private readonly def: ToolDef,
    private readonly deps: ToolDeps,
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<any>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const verb = this.name.replace(/^noggin_/, '').replace(/_/g, '-');
    const input = options.input ?? {};
    try {
      let data: unknown;
      if (this.name === 'noggin_copy') {
        // Special-case: two noggins, both optional, both default to
        // the open one. handle.copy() owns the open/dispose lifecycle.
        data = await this.deps.handle.copy({
          from: typeof input.from === 'string' && input.from.trim() ? input.from.trim() : undefined,
          to: typeof input.to === 'string' && input.to.trim() ? input.to.trim() : undefined,
        });
      } else if (this.def.needsNoggin) {
        // Resolve the target noggin: input.noggin overrides, else the open one.
        const resolved = await this.deps.handle.resolve(
          typeof input.noggin === 'string' ? input.noggin : null,
        );
        try {
          data = await this.def.handler(input, resolved.noggin);
        } finally {
          await resolved.dispose();
        }
      } else {
        data = await this.def.handler(input, null);
      }
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
  if (input?.noggin) bits.push(`@${input.noggin}`);
  if (input?.path) bits.push(String(input.path));
  if (input?.title) bits.push(`"${input.title}"`);
  if (input?.text) bits.push(`"${truncate(String(input.text), 40)}"`);
  if (input?.state) bits.push(`--${input.state}`);
  if (input?.force) bits.push('--force');
  if (input?.closeAll) bits.push('--close-all');
  for (const k of ['before', 'after', 'into', 'goto', 'from', 'to']) {
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
  for (const [name, def] of Object.entries(TOOLS)) {
    context.subscriptions.push(
      vscode.lm.registerTool(name, new NogginTool(name, def, deps)),
    );
  }
}
