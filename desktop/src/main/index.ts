// Electron main process.
//
// Owns the BrowserWindow, the open noggin (singleton for now), and a
// small IPC dispatch table that maps each `noggin:*` channel to the
// matching engine verb. Calls into `verbs.X` and `openNoggin` happen
// in this process directly — no sub-process, no JSON-RPC.

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

import {
  NogginError,
  openNoggin,
  verbs,
  type Noggin,
} from '../../skills/noggin/noggin-api.mjs';
import '../../skills/noggin/backends/file.mjs'; // side-effect: registers file://

import { IPC, type IpcResult } from '@shared/ipc';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Open noggin state ─────────────────────────────────────────────────────

let current: Noggin | null = null;
let currentLocation: string | null = null;
let changeUnsub: (() => void) | null = null;
let mainWindow: BrowserWindow | null = null;

const DEFAULT_LOCATION = path.join(os.homedir(), '.noggin.yaml');
const EMPTY_DOC = 'schemaVersion: 1\nactive: null\nitems: []\n';

async function openLocation(location: string): Promise<string> {
  // Tear down the previous noggin's watcher / queue cleanly.
  if (changeUnsub) { try { changeUnsub(); } catch { /* ignore */ } changeUnsub = null; }
  if (current) { try { await (current as any).dispose?.(); } catch { /* ignore */ } }

  // Seed the file if it doesn't exist yet — first-run case.
  if (location === DEFAULT_LOCATION && !fs.existsSync(location)) {
    fs.writeFileSync(location, EMPTY_DOC, 'utf8');
  }

  const noggin = await openNoggin(location, { watch: true });
  current = noggin;
  currentLocation = noggin.describe();

  // Bridge engine change events to the renderer.
  if (typeof (noggin as any).onDidChange === 'function') {
    const sub = (noggin as any).onDidChange(() => {
      mainWindow?.webContents.send(IPC.changed);
    });
    changeUnsub = sub?.dispose ? () => sub.dispose() : sub;
  }

  return currentLocation;
}

function requireOpen(): Noggin {
  if (!current) {
    throw new NogginError('no noggin is open', { code: 'no-file', exitCode: 2 });
  }
  return current;
}

// ── IPC dispatch ──────────────────────────────────────────────────────────

function envelope<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true as const, data }))
    .catch((err: unknown) => {
      const e = err as { code?: string; message?: string };
      return {
        ok: false as const,
        error: {
          code: e?.code ?? 'noggin-error',
          message: e?.message ?? String(err),
        },
      };
    });
}

function registerIpc(): void {
  ipcMain.handle(IPC.open, (_e, file: string) => envelope(() => openLocation(file)));
  ipcMain.handle(IPC.where, () => envelope(() => currentLocation));
  ipcMain.handle(IPC.show, (_e, opts) => envelope(() => verbs.show(requireOpen(), opts)));
  ipcMain.handle(IPC.push, (_e, opts) => envelope(() => verbs.push(requireOpen(), opts)));
  ipcMain.handle(IPC.add, (_e, opts) => envelope(() => verbs.add(requireOpen(), opts)));
  ipcMain.handle(IPC.goto, (_e, p: string) => envelope(() => verbs.goto(requireOpen(), { path: p })));
  ipcMain.handle(IPC.done, (_e, opts) => envelope(() => verbs.done(requireOpen(), opts)));
  ipcMain.handle(IPC.pop, (_e, opts) => envelope(() => verbs.pop(requireOpen(), opts)));
  ipcMain.handle(IPC.edit, (_e, opts) => envelope(() => verbs.edit(requireOpen(), opts)));
  ipcMain.handle(IPC.note, (_e, opts) => envelope(() => verbs.note(requireOpen(), opts)));
  ipcMain.handle(IPC.move, (_e, opts) => envelope(() => verbs.move(requireOpen(), opts)));
  ipcMain.handle(IPC.delete, (_e, opts) => envelope(() => verbs.delete(requireOpen(), opts)));
}

// ── Window lifecycle ──────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 480,
    minHeight: 320,
    title: 'noggin',
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      sandbox: false, // we need Node features in preload (path, url)
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // electron-vite injects ELECTRON_RENDERER_URL for dev; falls back to
  // the built index.html otherwise.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

async function bootstrap(): Promise<void> {
  registerIpc();
  try {
    await openLocation(DEFAULT_LOCATION);
  } catch (err) {
    dialog.showErrorBox('noggin', `Failed to open ${DEFAULT_LOCATION}\n\n${(err as Error).message}`);
  }
  await createWindow();
}

app.whenReady().then(bootstrap).catch((err) => {
  dialog.showErrorBox('noggin', String((err as Error)?.stack ?? err));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) bootstrap();
});

app.on('before-quit', async () => {
  if (changeUnsub) { try { changeUnsub(); } catch { /* ignore */ } }
  if (current) { try { await (current as any).dispose?.(); } catch { /* ignore */ } }
});
