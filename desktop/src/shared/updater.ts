// Shared updater IPC contract between the Electron main process and
// the renderer. The main process owns the electron-updater lifecycle;
// the renderer subscribes to status changes to drive the title-bar
// update indicator, and requests actions (check / restart) via IPC.

export const UPDATER_IPC = {
  /** main → renderer: state changed. Payload: `UpdaterStatus`. */
  status: 'updater:status',
  /** renderer → main: request current status. `invoke`-style. */
  getStatus: 'updater:get-status',
  /** renderer → main: trigger a check now. Fire-and-forget. */
  checkNow: 'updater:check-now',
  /** renderer → main: quit and install a downloaded update. */
  restartNow: 'updater:restart-now',
} as const;

/**
 * Full lifecycle of an update from the renderer's perspective.
 * Emitted whenever the main-process updater state machine transitions.
 *
 * - `idle` — no check has run yet (or last check was too long ago and
 *   we've forgotten).
 * - `checking` — asked the feed, waiting on a reply.
 * - `up-to-date` — feed replied, we're on latest. `version` is ours.
 * - `available` — a newer version exists; download is starting.
 * - `downloading` — download in progress with percent + rate.
 * - `downloaded` — staged installer is ready; caller can `restartNow()`.
 * - `error` — check or download failed; retry via `checkNow()`.
 */
export type UpdaterStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; currentVersion: string }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };
