// Electron main process — window shell + native application menu.
//
// The noggin engine, file provider, and HostServices run behind the
// per-window noggin-rpc server (see engine.ts). This file owns only:
//   - the BrowserWindow + window lifecycle
//   - the native application menu (built-in roles + Help links)
//
// The menu carries no noggin-specific actions and never talks to the
// renderer; app actions live in the renderer's own controls and
// keyboard accelerators.

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
// electron-updater is a CJS module. Node's ESM interop can't statically
// see `autoUpdater` as a named export, so we default-import and
// destructure at runtime — the syntax the error message prescribes.
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import path from 'node:path';
import url from 'node:url';

import { attachRpcServer, type AttachedRpcServer } from './engine.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev only: expose the Chromium DevTools Protocol on a fixed port so
// external tools (Playwright CDP, Chrome DevTools, etc.) can attach.
// Gated on the dev server being present so it doesn't fight Playwright's
// own `_electron` inspector during E2E (which runs unpackaged too).
// No-op in packaged builds.
if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch('remote-debugging-port', '9223');
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

// Windows: register the AppUserModelID before anything creates a window
// or emits a notification. Without this, Windows silently drops
// notifications from packaged apps (including the update-ready toast
// that electron-updater's checkForUpdatesAndNotify() tries to fire).
// The value must match electron-builder's `appId`.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.dornstein.noggin');
}

let mainWindow: BrowserWindow | null = null;
let attachedRpc: AttachedRpcServer | null = null;
let pendingUpdateVersion: string | null = null;

// ── Window ────────────────────────────────────────────────────────────────

/**
 * Resolve the BrowserWindow icon. Lives in `desktop/build/icon.png`
 * (the same file electron-builder uses to brand the packaged .exe).
 * In dev `__dirname` is `desktop/out/main/`, so the icon is two
 * levels up + `build/`. In a packaged build the .exe already carries
 * an embedded icon so the BrowserWindow option is mostly cosmetic
 * (taskbar grouping), but we still resolve it for consistency.
 */
function resolveWindowIcon(): string {
  return path.join(__dirname, '..', '..', 'build', 'icon.png');
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    title: 'noggin',
    icon: resolveWindowIcon(),
    // Hide the menu bar by default. Standard Windows behaviour:
    // Alt momentarily peeks it, and a second Alt collapses it again.
    // Users who keep it pinned can toggle it from View → Show menu
    // bar (which sets a per-window preference Electron remembers).
    autoHideMenuBar: true,
    // Backing colour shown between window creation and the renderer's
    // first paint. Pick it to match whichever side of the theme the
    // CSS will land on so the flash isn't jarring. `nativeTheme`
    // reads the OS dark/light preference; the renderer's
    // `@noggin/ui/themes/auto.css` picks up the same signal via
    // `prefers-color-scheme` so the two stay aligned.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      // Phase 4 of the noggin-rpc plan moved the engine to the main
      // process; the renderer now talks to it over noggin-rpc and no
      // longer needs Node access. Lock the renderer down to standard
      // Electron security defaults.
      sandbox: true,
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

  // Phase 4: engine lives in main now. Stand up the noggin-rpc server
  // bound to this window's webContents. One server per window.
  attachedRpc = attachRpcServer(mainWindow);
  mainWindow.on('closed', () => {
    void attachedRpc?.dispose();
    attachedRpc = null;
    mainWindow = null;
  });
}

// ── Application menu ──────────────────────────────────────────────────────
//
// Purely native: built-in Electron roles + external Help links. It
// carries no noggin-specific actions (New/Open/Close, sidebar, details
// layout, providers, about) — those live in the renderer's own
// controls and keyboard accelerators — so it never talks to the
// renderer and is built once at startup.

const REPO_URL = 'https://github.com/dornstein/noggin';
const ISSUES_URL = `${REPO_URL}/issues`;
const DOCS_URL = `${REPO_URL}#readme`;

/**
 * Build and install the application menu. Native roles only; the same
 * logical menu on every platform with small conventional differences:
 *   - Mac gets the app menu (About / Hide / Quit) + Window menu.
 *   - Windows/Linux put Quit in File and use Alt-key mnemonics.
 *   - Reload + Toggle DevTools only appear in dev builds.
 */
function installMenu(): void {
  const isMac = process.platform === 'darwin';

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

    // File — Win/Linux only (just Exit; noggin actions live in the UI).
    // On Mac, Quit is in the app menu, so there's nothing to put here.
    ...(isMac
      ? [] as MenuItemConstructorOptions[]
      : [{
          label: '&File',
          submenu: [{ role: 'quit' as const, label: 'E&xit' }],
        } as MenuItemConstructorOptions]),

    // Edit — Electron's built-in role gives us Undo / Redo / Cut / Copy /
    // Paste / Paste-and-match-style / Delete / Select-All with the
    // right per-platform accelerators automatically.
    { label: '&Edit', role: 'editMenu' },

    // View — window-level chrome only (zoom, full screen, dev tools).
    {
      label: '&View',
      submenu: [
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

    // Help — external links + About / update check.
    {
      label: '&Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal(DOCS_URL) },
        { label: 'GitHub Repository', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue\u2026', click: () => shell.openExternal(ISSUES_URL) },
        { type: 'separator' },
        { label: 'Check for Updates\u2026', click: () => { void handleCheckForUpdates(); } },
        { label: `About ${app.name}`, click: () => { void handleAbout(); } },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Help actions ──────────────────────────────────────────────────────────

/**
 * Show a native About dialog. Cross-platform via `dialog.showMessageBox`
 * so the version + links are identical on Windows / Linux / Mac.
 * (Mac's app-menu `role: 'about'` still uses the OS panel — we populate
 * it via `setAboutPanelOptions` at boot so both entry points match.)
 */
async function handleAbout(): Promise<void> {
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  await dialog.showMessageBox(parent!, {
    type: 'info',
    title: `About ${app.name}`,
    message: `noggin ${app.getVersion()}`,
    detail: [
      'A working-memory tree tool for in-flight work.',
      '',
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node ${process.versions.node}`,
      '',
      REPO_URL,
    ].join('\n'),
    buttons: ['OK', 'Open Repository'],
    defaultId: 0,
    cancelId: 0,
  }).then((r) => {
    if (r.response === 1) void shell.openExternal(REPO_URL);
  });
}

/**
 * Manually trigger an update check and report the result. In packaged
 * builds this hits the same GitHub-Releases feed as the automatic
 * launch-time check; in dev builds we tell the user why nothing
 * happened instead of failing silently.
 */
async function handleCheckForUpdates(): Promise<void> {
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;

  if (!app.isPackaged) {
    await dialog.showMessageBox(parent!, {
      type: 'info',
      title: 'Check for Updates',
      message: 'Update checks are disabled in development builds.',
      detail: `Running noggin ${app.getVersion()} from source.`,
    });
    return;
  }

  // If an update is already downloaded from an earlier launch-time
  // check, prompt for restart instead of re-checking.
  if (pendingUpdateVersion) {
    void promptRestartForUpdate(pendingUpdateVersion);
    return;
  }

  installUpdaterHandlers();
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    if (!latest || latest === app.getVersion()) {
      await dialog.showMessageBox(parent!, {
        type: 'info',
        title: 'Check for Updates',
        message: `noggin ${app.getVersion()} is the latest version.`,
      });
    } else {
      // update-downloaded will fire once the background download
      // finishes and prompt the user for restart. Give a nudge here so
      // they know something is happening.
      await dialog.showMessageBox(parent!, {
        type: 'info',
        title: 'Update Available',
        message: `noggin ${latest} is downloading.`,
        detail: 'You will be prompted to restart when the download finishes.',
      });
    }
  } catch (err) {
    await dialog.showMessageBox(parent!, {
      type: 'error',
      title: 'Check for Updates',
      message: 'Update check failed.',
      detail: String((err as Error)?.message ?? err),
    });
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  installMenu();
  await createWindow();
  scheduleUpdateCheck();
}

// electron-updater reads the `publish:` block from electron-builder.yml
// (baked into app-update.yml at package time) and checks the GitHub
// Release matching the current version. Only meaningful in packaged
// builds — dev runs have no app-update.yml. Failures are logged and
// swallowed so an offline launch never blocks the UI.
function scheduleUpdateCheck(): void {
  if (!app.isPackaged) return;
  installUpdaterHandlers();
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[noggin] update check failed:', err);
  });
}

// Wire the electron-updater event surface exactly once. We rely on
// `update-downloaded` firing a modal dialog instead of
// checkForUpdatesAndNotify()'s silent native toast — Windows drops
// those toasts for packaged apps that lack a Start-Menu-registered
// AppUserModelID, and unsigned installers frequently don't register
// one. A dialog is universally reliable and prompts the user to
// restart, which is what the toast was supposed to trigger anyway.
let updaterHandlersInstalled = false;
function installUpdaterHandlers(): void {
  if (updaterHandlersInstalled) return;
  updaterHandlersInstalled = true;

  // Route updater's own logging to the main-process console so it's
  // visible in DevTools (attached externally in packaged builds).
  autoUpdater.logger = {
    info: (...a: unknown[]) => console.log('[updater]', ...a),
    warn: (...a: unknown[]) => console.warn('[updater]', ...a),
    error: (...a: unknown[]) => console.error('[updater]', ...a),
    debug: (...a: unknown[]) => console.debug('[updater]', ...a),
  } as unknown as typeof autoUpdater.logger;

  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err);
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info.version;
    void promptRestartForUpdate(info.version);
  });
}

async function promptRestartForUpdate(version: string): Promise<void> {
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const r = await dialog.showMessageBox(parent!, {
    type: 'info',
    title: 'Update Ready',
    message: `noggin ${version} has been downloaded.`,
    detail: 'Restart now to install, or the update will be applied automatically the next time you quit noggin.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) {
    // isSilent=true so NSIS runs headless; isForceRunAfter=true so the
    // new version launches once the swap completes.
    autoUpdater.quitAndInstall(true, true);
  }
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
