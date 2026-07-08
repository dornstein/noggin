// Shared helper: locate the workspace's `state.vscdb` and pick one
// of its chat sessions. Used by both the palette command
// (`noggin.openCopilotTodo`) and the RPC-driven picker exposed to
// the webview `+` menu (`ProviderFlows.pickToOpen('vscode-todo://')`).
//
// The picker unions three per-workspace registries (panel
// `chatSessions/*.jsonl`, the todo memento, and the Copilot CLI
// session catalog). Each row can be:
//   - a session with a todo list to view (labelled with the first
//     todo's title, badged with the count), or
//   - a session that hasn't used the todo tool yet (labelled with
//     the session's own title or short id; picking it opens an
//     empty noggin that fills in live if the session starts writing
//     to `manage_todo_list`).
//
// Returns `vscode-todo://<path>#<sid>` or null when the user
// cancelled / no state.vscdb yet / no sessions to pick from.

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { listVscodeTodoSessions } from '../skills/noggin/providers/vscode-todo.mjs';

/**
 * "Current" tag threshold. Only mark the most-recently-touched
 * session as "current" when its .jsonl was written within this
 * window. Prevents the tag from landing on a session someone last
 * touched days ago.
 */
const CURRENT_TAG_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Resolve the workspace's `state.vscdb`. Extensions get
 * `context.storageUri` pointing at
 * `<userDataDir>/User/workspaceStorage/<workspaceId>/<extId>/`; the
 * DB is one level up. Returns null when the folder doesn't exist
 * (no workspace open, or VS Code hasn't provisioned it yet).
 */
export function resolveWorkspaceStateDb(context: vscode.ExtensionContext): string | null {
  const storage = context.storageUri;
  if (!storage) return null;
  const workspaceDir = path.dirname(storage.fsPath);
  const dbPath = path.join(workspaceDir, 'state.vscdb');
  return existsSync(dbPath) ? dbPath : null;
}

/**
 * Show a quick-pick for the workspace's chat sessions. Sessions
 * with todos appear first, then sessions without. Returns
 * `vscode-todo://<path>#<sid>` on selection, or null when the user
 * cancelled or there's nothing to pick.
 *
 * Surfaces warning toasts for the two empty states (no DB yet, no
 * sessions at all) so the caller can stay a simple
 * `if (uri) session.open(uri)` two-liner.
 */
export async function pickVscodeTodoLocation(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const dbPath = resolveWorkspaceStateDb(context);
  if (!dbPath) {
    void vscode.window.showWarningMessage(
      'Noggin: no Copilot workspace storage found yet. '
      + 'Open a folder and use Copilot Chat once so state.vscdb is created, then try again.',
    );
    return null;
  }

  let sessions;
  try {
    sessions = await listVscodeTodoSessions(dbPath);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Noggin: could not read state.vscdb (${(err as Error).message}).`,
    );
    return null;
  }

  if (sessions.length === 0) {
    void vscode.window.showWarningMessage(
      'Noggin: no chat sessions found in this workspace yet. '
      + 'Start a Copilot Chat conversation, then try again.',
    );
    return null;
  }

  // Pure MRU order — the engine already returns rows sorted by
  // descending mtime (most recently active first). We keep that
  // exact order in the picker so it matches VS Code's own Sessions
  // sidebar.
  const ordered = sessions;

  // Find the freshest session and tag it "current" IF it was touched
  // recently enough. Anything older wouldn't feel like a "current"
  // session in the sidebar sense.
  const freshest = ordered.reduce<typeof ordered[number] | null>(
    (best, s) => (s.mtimeMs > (best?.mtimeMs ?? 0) ? s : best),
    null,
  );
  const currentSid = freshest && freshest.mtimeMs > 0
    && Date.now() - freshest.mtimeMs < CURRENT_TAG_WINDOW_MS
    ? freshest.sessionId
    : null;

  interface Pick extends vscode.QuickPickItem {
    sessionId: string;
  }
  const items: Pick[] = [];
  for (const s of ordered) {
    const shortId = s.sessionId.length > 8 ? s.sessionId.slice(0, 8) : s.sessionId;
    const isCurrent = s.sessionId === currentSid;
    // Label: session title only. Never a todo title — the picker is
    // for choosing WHICH chat session to view, and users navigate by
    // the session's own identity, not by the first todo's wording.
    const label = s.sessionTitle && s.sessionTitle.trim()
      ? s.sessionTitle
      : `Session ${shortId}`;
    const countPart = s.count > 0
      ? `${s.count} todo${s.count === 1 ? '' : 's'}`
      : 'no todo list yet';
    const description = isCurrent ? `${countPart} \u00b7 current` : countPart;
    const detail = `${shortId} \u00b7 ${friendlyRecency(s.mtimeMs)}`;
    items.push({ sessionId: s.sessionId, label, description, detail });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Open Copilot todo list',
    placeHolder: 'Pick a chat session (most recent first)',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked || !picked.sessionId) return null;

  return `vscode-todo://${dbPath.replace(/\\/g, '/')}#${picked.sessionId}`;
}

function friendlyRecency(mtimeMs: number): string {
  if (!mtimeMs) return 'unknown time';
  const diff = Math.max(0, Date.now() - mtimeMs);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
