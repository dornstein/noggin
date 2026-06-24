// Electron main process — application shell only.
//
// After the single-process collapse, the noggin engine + file backend
// run in the renderer (nodeIntegration: true). This file's job is just:
//   - own the BrowserWindow + window lifecycle
//   - build the application menu and forward actions to the renderer
//   - handle native dialogs (open/save/error) on behalf of the renderer
//
// No engine, no verbs, no recents persistence — the renderer owns all
// that.

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import url from 'node:url';

import { SHELL_IPC, type MenuAction, type MenuState } from '@shared/ipc';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev only: expose the Chromium DevTools Protocol on a fixed port so
// external tools (Playwright, Chrome DevTools, etc.) can attach.
// No-op in packaged builds.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9223');
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

let mainWindow: BrowserWindow | null = null;
let lastMenuState: MenuState = { hasNoggin: false, sidebarOpen: true, detailsLocation: 'right' };

// ── Window ────────────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    title: 'noggin',
    autoHideMenuBar: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      // Renderer holds the engine and file backend in-process. This is
      // a single-author app loading only our own bundle; we accept the
      // tradeoff of a fully-Node-capable renderer in exchange for
      // dropping the IPC layer.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: true,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

// ── Shell IPC ─────────────────────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.handle(SHELL_IPC.pickFile, async () => {
    if (!mainWindow) return { ok: false, error: { code: 'no-window', message: 'no window' } };
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open noggin',
        properties: ['openFile'],
        filters: [
          { name: 'Noggin (YAML)', extensions: ['yaml', 'yml'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: true, data: null };
      return { ok: true, data: result.filePaths[0] };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: { code: 'dialog-failed', message: e.message } };
    }
  });

  ipcMain.handle(SHELL_IPC.pickNewFile, async (_e, defaultName?: string) => {
    if (!mainWindow) return { ok: false, error: { code: 'no-window', message: 'no window' } };
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Create new noggin',
        defaultPath: defaultName || '.noggin.yaml',
        filters: [{ name: 'Noggin (YAML)', extensions: ['yaml'] }],
      });
      if (result.canceled || !result.filePath) return { ok: true, data: null };
      return { ok: true, data: result.filePath };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: { code: 'dialog-failed', message: e.message } };
    }
  });

  ipcMain.on(SHELL_IPC.showError, (_e, { message, detail }: { message: string; detail?: string }) => {
    if (!mainWindow) return;
    dialog.showErrorBox(message, detail || '');
  });

  ipcMain.on(SHELL_IPC.setMenuState, (_e, state: MenuState) => {
    lastMenuState = state;
    installMenu();
  });
}

// ── Application menu ──────────────────────────────────────────────────────

const REPO_URL = 'https://github.com/dornstein/noggin';
const ISSUES_URL = `${REPO_URL}/issues`;
const DOCS_URL = `${REPO_URL}#readme`;

function fireMenu(action: MenuAction): void {
  mainWindow?.webContents.send(SHELL_IPC.menuAction, action);
}

function installMenu(): void {
  const isMac = process.platform === 'darwin';
  const { hasNoggin, sidebarOpen, detailsLocation } = lastMenuState;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        } as MenuItemConstructorOptions]
      : []),
    {
      label: '&File',
      submenu: [
        { label: 'New Noggin…', accelerator: 'CmdOrCtrl+N', click: () => fireMenu('new') },
        { label: 'Open Noggin…', accelerator: 'CmdOrCtrl+O', click: () => fireMenu('open') },
        { type: 'separator' },
        {
          label: 'Close Noggin',
          accelerator: 'CmdOrCtrl+W',
          enabled: hasNoggin,
          click: () => fireMenu('close'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Show Sidebar',
          accelerator: 'CmdOrCtrl+B',
          type: 'checkbox',
          checked: sidebarOpen,
          click: () => fireMenu('toggleSidebar'),
        },
        { type: 'separator' },
        {
          label: 'Details on the Right',
          type: 'radio',
          checked: detailsLocation === 'right',
          click: () => fireMenu('detailsRight'),
        },
        {
          label: 'Details Below the Tree',
          type: 'radio',
          checked: detailsLocation === 'below',
          click: () => fireMenu('detailsBelow'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Window',
      role: 'windowMenu',
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal(DOCS_URL) },
        { label: 'GitHub Repository', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue…', click: () => shell.openExternal(ISSUES_URL) },
        { type: 'separator' },
        { label: 'Keyboard Shortcuts', click: () => fireMenu('shortcuts') },
        { type: 'separator' },
        { label: `About ${app.name}`, click: () => fireMenu('about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  registerIpc();
  installMenu();
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
