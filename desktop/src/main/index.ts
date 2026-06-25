// Electron main process — application shell only.
//
// The noggin engine + file provider run in the renderer (single-process
// collapse, `nodeIntegration: true`). This file owns:
//   - the BrowserWindow + window lifecycle
//   - native dialogs (open / save / error)
//   - the application menu (one template, two `isMac` guards)
//   - opening external URLs in the OS default browser
//
// No engine, no verbs, no recents persistence — the renderer owns
// all of that.

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import url from 'node:url';

import { SHELL_IPC, type MenuAction, type MenuState } from '@shared/ipc';
import { attachRpcServer, type AttachedRpcServer } from './engine.js';

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
let attachedRpc: AttachedRpcServer | null = null;

// Most recent renderer-pushed state. The menu rebuilds against this
// every time it changes so enablement/checks stay accurate.
let lastMenuState: MenuState = {
  hasNoggin: false,
  sidebarOpen: true,
  detailsLocation: 'right',
};

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
      // Renderer holds the engine and file provider in-process. This
      // is a single-author app loading only our own bundle; we accept
      // the tradeoff of a fully-Node-capable renderer in exchange for
      // dropping the IPC layer.
      //
      // contextIsolation MUST be false. With it on, Node APIs are
      // only in the preload's isolated world; the renderer main
      // world has no `require` and the engine's `import x from
      // 'node:y'` shims (see electron.vite.config.ts) crash at load
      // with "require is not defined".
      sandbox: false,
      contextIsolation: false,
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

  // Phase 4: engine lives in main now. Stand up the noggin-rpc server
  // bound to this window's webContents. One server per window.
  attachedRpc = attachRpcServer(mainWindow);
  mainWindow.on('closed', () => {
    void attachedRpc?.dispose();
    attachedRpc = null;
    mainWindow = null;
  });
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

  ipcMain.on(SHELL_IPC.openExternal, (_e, openUrl: string) => {
    if (typeof openUrl !== 'string') return;
    // Only allow http(s) URLs to avoid handler abuse from the
    // renderer (mailto:, file://, app: links could surprise users).
    if (!/^https?:\/\//i.test(openUrl)) return;
    shell.openExternal(openUrl);
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

/**
 * Build and install the application menu. Same logical menu on every
 * platform; small platform-conventional differences:
 *   - Mac gets the app menu (About / Hide / Quit) + Window menu.
 *   - Windows/Linux put About in Help, Quit in File, and use Alt-key
 *     mnemonics (the `&` prefixes; Mac silently strips them).
 *   - Reload + Toggle DevTools only appear in dev builds.
 */
function installMenu(): void {
  const isMac = process.platform === 'darwin';
  const { hasNoggin, sidebarOpen, detailsLocation } = lastMenuState;

  const template: MenuItemConstructorOptions[] = [
    // App menu — Mac only.
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

    // File
    {
      label: '&File',
      submenu: [
        { label: 'New Noggin', accelerator: 'CmdOrCtrl+N', click: () => fireMenu('new') },
        { label: 'Open Noggin\u2026', accelerator: 'CmdOrCtrl+O', click: () => fireMenu('open') },
        { type: 'separator' },
        {
          label: 'Close Noggin',
          accelerator: 'CmdOrCtrl+W',
          enabled: hasNoggin,
          click: () => fireMenu('close'),
        },
        ...(isMac
          ? [] as MenuItemConstructorOptions[]
          : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'E&xit' }]),
      ],
    },

    // Edit — Electron's built-in role gives us Undo / Redo / Cut / Copy /
    // Paste / Paste-and-match-style / Delete / Select-All with the
    // right per-platform accelerators automatically.
    { label: '&Edit', role: 'editMenu' },

    // View
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
        { role: 'resetZoom' },
        // Custom Zoom In accelerator. Electron's default `zoomIn`
        // role binds to `CmdOrCtrl+Plus`, which on a US QWERTY
        // keyboard requires Shift (since `+` is Shift+`=`). Users
        // overwhelmingly expect Ctrl+= (no shift) and Ctrl++ to both
        // work; we register the `=` form here and add an invisible
        // sibling below for the explicit-Shift form so both fire.
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=', label: 'Zoom In' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+Shift+=', visible: false },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged
          ? [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const },
            ]
          : []),
      ],
    },

    // Window — Mac only (Win/Linux apps don't traditionally have one;
    // window management lives in the taskbar).
    ...(isMac ? [{ label: 'Window', role: 'windowMenu' as const }] : []),

    // Help
    {
      label: '&Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal(DOCS_URL) },
        { label: 'GitHub Repository', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue\u2026', click: () => shell.openExternal(ISSUES_URL) },
        { type: 'separator' },
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => fireMenu('shortcuts') },
        ...(isMac
          ? [] as MenuItemConstructorOptions[]
          : [{ type: 'separator' as const }, { label: 'About noggin', click: () => fireMenu('about') }]),
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
