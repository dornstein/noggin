// AUTO-SYNCED FROM engine/providers/vscode-todo.d.mts — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Type declarations for engine/providers/vscode-todo.mjs.
//
// Importing this module side-effect-registers a provider under the
// `vscode-todo://` scheme with the engine's `providers` registry.

import type { NogginProvider, NogginStore } from '../noggin-api.mjs';

/**
 * @public
 * The vscode-todo provider's Noggin implementation. Registered
 * automatically on import under the `vscode-todo` scheme.
 *
 * Read-only. Projects VS Code's Copilot chat todo list (stored in a
 * workspace's `state.vscdb` under the `memento/chat-todo-list`
 * memento) as a noggin tree.
 */
export const vscodeTodoProvider: NogginProvider;

/**
 * @public
 * Convenience factory: open a vscode-todo noggin from a real
 * filesystem path to `state.vscdb`, without constructing a URL.
 * A `sessionId` is required — the provider always projects exactly
 * one chat session's todos.
 *
 * @param statePath  Absolute path to a VS Code workspace's
 *                   `state.vscdb` file
 *                   (`<workspaceStorage>/<workspaceId>/state.vscdb`).
 * @param opts       `sessionId` (required) selects which chat
 *                   session's todo list to project. Match the chat
 *                   session's `.jsonl` filename in
 *                   `<workspaceId>/chatSessions/`.
 *                   `pollIntervalMs` overrides the mtime-poll cadence
 *                   (default 2000ms; pass 0 to disable watching).
 */
export function openVscodeTodoNoggin(
  statePath: string,
  opts: {
    sessionId: string;
    pollIntervalMs?: number;
  },
): Promise<NogginStore>;

/**
 * @public
 * One session's summary — what a picker needs to render a row
 * without opening the noggin. Returned in descending
 * `lastMessageDate` order (most-recently-active first).
 *
 * Sourced primarily from VS Code's own `chat.ChatSessionStore.index`
 * (the same store the built-in Sessions sidebar reads), unioned
 * with the workspace's `manage_todo_list` memento for count /
 * first-todo details.
 */
export interface VscodeTodoSessionSummary {
  readonly sessionId: string;
  /** How many todo items live in the memento for this session.
   *  Zero when the session exists in the chat index but has never
   *  invoked the `manage_todo_list` tool. */
  readonly count: number;
  /** The first todo's title, or null when `count === 0`. */
  readonly firstTitle: string | null;
  /** Session title as VS Code renders it in the Sessions sidebar
   *  (the `customTitle` if the user renamed the session, else an
   *  LLM-generated summary, else `"New Chat"`). Null when the
   *  session isn't in the chat index. */
  readonly sessionTitle: string | null;
  /** `lastMessageDate` from the chat index — the wall-clock time
   *  of the most recent activity. Zero for sessions that only
   *  appear in the memento (should be rare in practice). */
  readonly mtimeMs: number;
  /** True when the session has a workspace-local `.jsonl`/`.json`
   *  in `chatSessions/`. False for external (Copilot CLI) sessions
   *  that live outside the workspace. */
  readonly hasSessionLog: boolean;
  /** True when VS Code flagged this session as external — Copilot
   *  CLI, cloud, agent-host, etc. Distinguishes native workspace
   *  chat sessions from ones that just happened to write into this
   *  workspace's memento. */
  readonly isExternal: boolean;
}

/**
 * @public
 * Enumerate every chat session VS Code knows about in this
 * workspace. Reads the same `chat.ChatSessionStore.index` row that
 * powers VS Code's Sessions sidebar (so titles and ordering match),
 * unioned with the workspace's `manage_todo_list` memento for count
 * and first-todo details. Sessions VS Code marks empty are
 * dropped.
 */
export function listVscodeTodoSessions(
  statePath: string,
): Promise<readonly VscodeTodoSessionSummary[]>;
