// Electron main process.
//
// Owns the BrowserWindow, the single open noggin, the recents list,
// and IPC dispatch. Calls into `verbs.X` and `openNoggin` happen in
// this process directly — no sub-process, no JSON-RPC.

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

import { IPC, type IpcResult, type RecentEntry, type OpenState } from '@shared/ipc';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Open noggin state ─────────────────────────────────────────────────────

let current: Noggin | null = null;
let currentLocation: string | null = null;
let changeUnsub: (() => void) | null = null;
let mainWindow: BrowserWindow | null = null;

const DEFAULT_LOCATION = path.join(os.homedir(), '.noggin.yaml');
const EMPTY_DOC = 'schemaVersion: 1\nactive: null\nitems: []\n';

function broadcastOpenState(): void {
  const state: OpenState = {
    location: currentLocation,
    exists: !!currentLocation && fileExists(currentLocation),
  };
  mainWindow?.webContents.send(IPC.openChanged, state);
}

async function openLocation(location: string): Promise<string> {
  if (changeUnsub) { try { changeUnsub(); } catch { /* ignore */ } changeUnsub = null; }
  if (current) { try { await (current as any).dispose?.(); } catch { /* ignore */ } current = null; }

  // Seed an empty doc for the default location on first run.
  if (location === DEFAULT_LOCATION && !fs.existsSync(location)) {
    fs.writeFileSync(location, EMPTY_DOC, 'utf8');
  }

  const noggin = await openNoggin(location, { watch: true });
  current = noggin;
  currentLocation = noggin.describe();

  if (typeof (noggin as any).onDidChange === 'function') {
    const sub = (noggin as any).onDidChange(() => {
      mainWindow?.webContents.send(IPC.changed);
    });
    changeUnsub = sub?.dispose ? () => sub.dispose() : sub;
  }

  bumpRecent(currentLocation);
  broadcastOpenState();
  return currentLocation;
}

async function closeCurrent(): Promise<void> {
  if (changeUnsub) { try { changeUnsub(); } catch { /* ignore */ } changeUnsub = null; }
  if (current) { try { await (current as any).dispose?.(); } catch { /* ignore */ } }
  current = null;
  currentLocation = null;
  broadcastOpenState();
}

function requireOpen(): Noggin {
  if (!current) throw new NogginError('no noggin is open', { code: 'no-file', exitCode: 2 });
  return current;
}

// ── Recents persistence ───────────────────────────────────────────────────

interface StoredRecent { location: string; lastOpenedAt: string; }

const RECENTS_MAX = 25;

function recentsPath(): string {
  return path.join(app.getPath('userData'), 'recents.json');
}

function loadRecents(): StoredRecent[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(recentsPath(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is StoredRecent => r && typeof r.location === 'string' && typeof r.lastOpenedAt === 'string')
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function saveRecents(list: StoredRecent[]): void {
  try {
    fs.mkdirSync(path.dirname(recentsPath()), { recursive: true });
    fs.writeFileSync(recentsPath(), JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('noggin: failed to save recents:', err);
  }
}

let recentsCache: StoredRecent[] = [];

function bumpRecent(location: string): void {
  const now = new Date().toISOString();
  recentsCache = [
    { location, lastOpenedAt: now },
    ...recentsCache.filter((r) => r.location !== location),
  ].slice(0, RECENTS_MAX);
  saveRecents(recentsCache);
}

function removeRecent(location: string): void {
  const before = recentsCache.length;
  recentsCache = recentsCache.filter((r) => r.location !== location);
  if (recentsCache.length !== before) saveRecents(recentsCache);
}

function publicRecents(): RecentEntry[] {
  return recentsCache.map((r) => ({
    location: r.location,
    label: basenameOrFull(r.location),
    lastOpenedAt: r.lastOpenedAt,
    exists: fileExists(r.location),
  }));
}

function basenameOrFull(location: string): string {
  const noScheme = location.replace(/^file:\/\//i, '');
  const base = path.basename(noScheme);
  return base || noScheme;
}

function fileExists(location: string): boolean {
  try {
    const noScheme = location.replace(/^file:\/\//i, '').replace(/^~/, os.homedir());
    return fs.existsSync(noScheme);
  } catch {
    return false;
  }
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
  ipcMain.handle(IPC.close, () => envelope(() => closeCurrent()));
  ipcMain.handle(IPC.where, () => envelope<OpenState>(() => ({
    location: currentLocation,
    exists: !!currentLocation && fileExists(currentLocation),
  })));

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

  ipcMain.handle(IPC.recentsList, () => envelope(() => publicRecents()));
  ipcMain.handle(IPC.recentsRemove, (_e, location: string) => envelope(() => { removeRecent(location); }));
  ipcMain.handle(IPC.recentsPickFile, () => envelope(async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open noggin',
      defaultPath: os.homedir(),
      properties: ['openFile', 'createDirectory', 'promptToCreate'],
      filters: [
        { name: 'Noggin (YAML)', extensions: ['yaml', 'yml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }));
}

// ── Window lifecycle ──────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    title: 'noggin',
    autoHideMenuBar: true,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => broadcastOpenState());
}

async function bootstrap(): Promise<void> {
  recentsCache = loadRecents();
  registerIpc();
  try {
    await openLocation(DEFAULT_LOCATION);
  } catch (err) {
    // Don't bail — the UI will show "no noggin open" and the user can
    // pick another one from the sidebar.
    console.error('noggin: failed to open default file:', err);
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
