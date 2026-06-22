// File backend for noggin.
//
// `fileNoggin(path, opts?)` is the public entry point for opening a
// noggin that lives in a YAML file on the local filesystem. Returns
// a live `Noggin` instance — see ../noggin-api.mjs for the surface.
//
// Cross-process safety:
// Every verb call takes an exclusive advisory lock on the file via a
// `mkdir`-based lock directory (atomic on every POSIX filesystem and
// on NTFS). Stale locks are detected via PID liveness checks. This
// means concurrent CLI invocations or extension + CLI usage against
// the same noggin won't lose updates. Single-machine local filesystem
// only — network mounts (NFS, SMB) are not guaranteed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Noggin } from '../noggin-api.mjs';

const DEFAULT_LOCK_TIMEOUT = 5000;
const LOCK_SUFFIX = '.lock';
const STALE_AFTER_MS = 30_000;

/**
 * Open a noggin backed by a YAML file. Performs the initial load
 * asynchronously; the returned `Noggin` is ready to use. Pass
 * `{ watch: true }` to subscribe to external file changes via
 * `fs.watch`.
 *
 * @param {string} filePath Absolute path to the noggin file.
 * @param {{ watch?: boolean, lockTimeout?: number }} [opts]
 * @returns {Promise<Noggin>}
 */
export async function fileNoggin(filePath, opts) {
  if (!filePath) throw new TypeError('fileNoggin: file path required');
  const noggin = new Noggin(filePath, opts);
  const timeout = (opts && opts.lockTimeout) || DEFAULT_LOCK_TIMEOUT;
  noggin._runLocked = (task) => withFileLock(filePath, timeout, task);
  await noggin._init();
  return noggin;
}

/**
 * Acquire an exclusive advisory lock on `filePath`, run `task`, and
 * release. The lock is a sibling directory `<path>.lock`; `mkdir` is
 * atomic so only one process at a time wins. We write a tiny
 * heartbeat file inside containing the pid + timestamp so stale locks
 * (process died holding the lock) can be reclaimed.
 */
async function withFileLock(filePath, timeout, task) {
  const lockDir = filePath + LOCK_SUFFIX;
  const deadline = Date.now() + timeout;
  let acquired = false;
  while (!acquired) {
    try {
      fs.mkdirSync(lockDir);
      acquired = true;
    } catch (err) {
      if (err && err.code !== 'EEXIST') throw err;
      if (reclaimIfStale(lockDir)) continue;
      if (Date.now() >= deadline) {
        const e = new Error(`could not acquire lock on ${filePath} within ${timeout}ms`);
        e.code = 'lock-timeout';
        throw e;
      }
      await sleep(25 + Math.floor(Math.random() * 50));
    }
  }
  writeHeartbeat(lockDir);
  try {
    return await task();
  } finally {
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeHeartbeat(lockDir) {
  try {
    fs.writeFileSync(
      path.join(lockDir, 'pid'),
      `${process.pid}\n${Date.now()}\n`,
      'utf8',
    );
  } catch { /* ignore — best-effort */ }
}

/** If the existing lock's PID is gone or it's older than STALE_AFTER_MS, remove it. */
function reclaimIfStale(lockDir) {
  let pidFile;
  try { pidFile = fs.readFileSync(path.join(lockDir, 'pid'), 'utf8'); }
  catch { /* no pid file — treat as fresh */ return false; }
  const [pidStr, tsStr] = pidFile.split('\n');
  const pid = Number(pidStr);
  const ts = Number(tsStr);
  if (!Number.isFinite(pid) || !Number.isFinite(ts)) return false;
  if (Date.now() - ts < STALE_AFTER_MS && isAlive(pid)) return false;
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch { return false; }
}

function isAlive(pid) {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (err) { return err && err.code === 'EPERM'; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-exported so the CLI can resolve a default path without reaching
// into the engine package. Not part of the public Noggin surface.

/** Default location used when no file path is supplied. */
export const DEFAULT_NOGGIN_FILE = path.join(os.homedir(), '.noggin.yaml');

/**
 * Resolve a noggin file path with the same priority the CLI uses:
 *   1. `opts.file`
 *   2. `opts.env.NOGGIN_FILE` (defaults to process.env)
 *   3. `DEFAULT_NOGGIN_FILE`
 *
 * Returns the resolved path plus diagnostic metadata. CLI-internal:
 * not exported as part of the engine's public API.
 *
 * @param {{ file?: string, env?: Record<string, string|undefined> }} [opts]
 */
export function resolveFilePath(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  let file, source;
  if (o.file) { file = o.file; source = 'flag'; }
  else if (env.NOGGIN_FILE) { file = env.NOGGIN_FILE; source = 'env'; }
  else { file = DEFAULT_NOGGIN_FILE; source = 'default'; }
  return {
    file,
    source,
    exists: fs.existsSync(file),
    defaultFile: DEFAULT_NOGGIN_FILE,
    env: env.NOGGIN_FILE || null,
  };
}


