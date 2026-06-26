// VS Code Extension Development Host launcher + CDP attach helper.
//
// Each test gets a fresh `code.exe` (or `code` on macOS/Linux) child
// process pointed at:
//   - the extension under development (extensionDevelopmentPath)
//   - an isolated user-data-dir + extensions-dir (so tests can run in
//     parallel and don't touch the developer's real VS Code profile)
//   - a temp workspace folder containing a single .noggin.yaml
//   - a unique --remote-debugging-port so we can connect over CDP
//
// We connect with `chromium.connectOverCDP(http://localhost:<port>)`,
// find the workbench page, surface the noggin webview's frame, and
// hand the spec a small `NogginHost` facade.

import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Path to VS Code's executable. On Windows the `code` shim is a .cmd
// file that doesn't accept --remote-debugging-port the same way, so we
// reach into the standard install location for Code.exe. Override via
// $NOGGIN_E2E_VSCODE if your install lives elsewhere.
function resolveVsCodeExe(): string {
  if (process.env.NOGGIN_E2E_VSCODE) return process.env.NOGGIN_E2E_VSCODE;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return candidates[0];
  }
  if (process.platform === 'darwin') {
    return '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';
  }
  return '/usr/share/code/code';
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('no port')));
      }
    });
  });
}

async function waitForCdp(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`CDP port ${port} did not become available: ${String(lastErr)}`);
}

export interface NogginHostOptions {
  /** Absolute path to the extension under test (extensionDevelopmentPath). */
  extensionPath: string;
  /** Absolute path to the workspace folder to open. Must already contain
   *  a .noggin.yaml the extension is meant to find. */
  workspaceFolder: string;
  /** Optional CDP port; default = auto-pick. */
  cdpPort?: number;
}

export interface NogginHost {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly workbench: Page;
  readonly webview: FrameLocator;
  readonly cdpPort: number;
  close(): Promise<void>;
}

/**
 * Launch a VS Code Extension Development Host, connect via CDP, and
 * resolve once the noggin webview has rendered (its tree role is
 * present). The webview is opened by invoking the
 * `noggin.openWorkspaceNoggin` command via VS Code's Command Palette.
 */
export async function launchNogginHost(opts: NogginHostOptions): Promise<NogginHost> {
  const exe = resolveVsCodeExe();
  const cdpPort = opts.cdpPort ?? await pickFreePort();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'noggin-e2e-udd-'));
  const extensionsDir = mkdtempSync(path.join(tmpdir(), 'noggin-e2e-ext-'));

  // Pre-seed the user-data-dir with settings that suppress as many
  // first-run modals / nudges as possible. The Copilot welcome modal
  // is the most disruptive; we also disable it via --disable-extension
  // below, but settings cover the other built-in nudges.
  const userSettingsDir = path.join(userDataDir, 'User');
  mkdirSync(userSettingsDir, { recursive: true });
  writeFileSync(path.join(userSettingsDir, 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off',
    'workbench.startupEditor': 'none',
    'update.mode': 'none',
    'update.showReleaseNotes': false,
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'security.workspace.trust.enabled': false,
    'security.workspace.trust.startupPrompt': 'never',
    'chat.commandCenter.enabled': false,
    'workbench.welcomePage.walkthroughs.openOnInstall': false,
  }, null, 2), 'utf8');

  const args = [
    '--new-window',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--remote-debugging-port=${cdpPort}`,
    '--disable-workspace-trust',
    '--disable-telemetry',
    '--disable-updates',
    // Built-in Copilot tries to show a sign-in welcome modal on first
    // launch, which captures keyboard focus and breaks command-palette
    // automation. Disable it explicitly. Our --extensions-dir is empty
    // so third-party extensions won't load either way.
    '--disable-extension', 'GitHub.copilot',
    '--disable-extension', 'GitHub.copilot-chat',
    `--extensionDevelopmentPath=${opts.extensionPath}`,
    opts.workspaceFolder,
  ];

  const child: ChildProcess = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
  });
  child.on('error', (e) => { console.error('VS Code spawn error:', e); });

  await waitForCdp(cdpPort);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];

  // Find the workbench window. VS Code's workbench page URL contains
  // `workbench.html`.
  const workbench = await waitForWorkbench(context);

  // Recent VS Code ships GitHub Copilot built-in, and its welcome
  // modal hijacks keyboard input until dismissed. Click through any
  // visible welcome / sign-in dialogs before we drive the workbench.
  await dismissBlockingModals(workbench);

  // If a welcome modal is still in the DOM, dump diagnostics and bail
  // loudly. Iterating after this point is pointless when keyboard
  // input is being eaten.
  const stillBlocked = await isWelcomeModalVisible(workbench);
  if (stillBlocked) {
    const diag = await collectDiagnostics(workbench);
    throw new Error(
      `Welcome / sign-in modal could not be dismissed. Diagnostics:\n${diag}`,
    );
  }

  // Focus the Noggin sidebar so VS Code mounts our WebviewViewProvider.
  await focusNogginSidebar(workbench);

  // Wait for the noggin webview iframe to mount (the "no noggin open"
  // empty state shows three buttons; we click "Open Workspace Noggin"
  // to load the .noggin.yaml in the workspace).
  const webview = await waitForNogginWebview(workbench);
  await webview.getByRole('button', { name: 'Open Workspace Noggin', exact: true })
    .click({ timeout: 10_000 });

  // Wait for the tree to render with at least one row — that's the
  // signal that the webview successfully opened the file via RPC.
  await webview.locator('[role="tree"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await webview.getByRole('treeitem').first().waitFor({ state: 'visible', timeout: 15_000 });

  return {
    browser,
    context,
    workbench,
    webview,
    cdpPort,
    async close() {
      try { await browser.close(); } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
      // Give the child a beat to release its lock files before we wipe.
      await new Promise((r) => setTimeout(r, 200));
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(extensionsDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

async function waitForWorkbench(context: BrowserContext, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      if (/workbench\.html/.test(p.url())) return p;
    }
    // Newly-created pages.
    try {
      const p = await context.waitForEvent('page', { timeout: 500 });
      if (/workbench\.html/.test(p.url())) return p;
    } catch { /* poll again */ }
  }
  throw new Error('workbench page never appeared');
}

/**
 * Best-effort dismissal of any welcome / sign-in modal VS Code
 * (or a bundled extension like Copilot) might show on first launch
 * into a fresh user-data-dir. The "Welcome to Visual Studio Code"
 * walkthrough has three steps (Sign In, Color Theme, Done); we keep
 * clicking the Close button until the dialog goes away, since the
 * X always closes the whole walkthrough regardless of step.
 */
async function dismissBlockingModals(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /Welcome to Visual Studio Code|Welcome to VS Code/i });
  try {
    await dialog.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    // Dialog never appeared. Nothing to dismiss; carry on.
    return;
  }

  // Try up to 6 dismiss attempts. The dialog is multi-step; each
  // close attempt either closes the whole thing or advances a step
  // we then re-dismiss.
  for (let attempt = 0; attempt < 6; attempt++) {
    if (!(await dialog.isVisible().catch(() => false))) return;

    // Prefer the dedicated dismiss / opt-out affordances in priority
    // order. The X "Close" button is always present and closes the
    // whole walkthrough — that's our reliable lever.
    const buttonNames = [
      'Continue without Signing In',
      'Close',
      'Mark Done',
      'Skip',
    ];
    let clicked = false;
    for (const name of buttonNames) {
      const btn = dialog.getByRole('button', { name, exact: true });
      if ((await btn.count().catch(() => 0)) > 0) {
        try {
          await btn.first().click({ timeout: 2_000, force: true });
          clicked = true;
          break;
        } catch { /* try next name */ }
      }
    }
    if (!clicked) {
      // Couldn't find any dismiss button. Try Escape and break.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      break;
    }
    // Give the dialog a moment to either close or advance.
    await page.waitForTimeout(300);
  }

  // Wait until the dialog is genuinely gone before returning so
  // subsequent keyboard input goes to the workbench.
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

async function openCommandPalette(page: Page): Promise<void> {
  await page.waitForSelector('.monaco-workbench', { timeout: 30_000 });
  // Cmd+Shift+P on mac, Ctrl+Shift+P elsewhere.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Shift+P`);
  await page.waitForSelector('.quick-input-widget', { timeout: 10_000 });
}

/**
 * Click the Noggin activity-bar tab to focus its sidebar view. This
 * is what causes VS Code to resolve our WebviewViewProvider and
 * mount the noggin iframe. We use a tab click rather than a command
 * because the underlying command id (`workbench.view.extension.noggin`)
 * isn't surfaced in the palette as a friendly title.
 */
async function focusNogginSidebar(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Noggin', exact: true });
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  // The tab may already be selected from a previous run; click is a
  // no-op in that case.
  await tab.click({ timeout: 3_000 });
}
async function runCommand(page: Page, label: string): Promise<void> {
  await openCommandPalette(page);
  // Clear any leftover text (>"" prefix from earlier invocations).
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(label, { delay: 5 });
  // Let VS Code filter settle before pressing Enter.
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  // Wait for the palette to close so subsequent calls don't race
  // against its still-being-dismissed state.
  await page.waitForSelector('.quick-input-widget', { state: 'hidden', timeout: 5_000 }).catch(() => {});
}

async function waitForNogginWebview(page: Page, timeoutMs = 30_000): Promise<FrameLocator> {
  // VS Code mounts multiple webviews (release notes, welcome page,
  // settings, ours). Filter the outer iframe by extensionId so we
  // only target the noggin webview, not whichever VS Code system
  // webview happens to be visible.
  const outerSelector =
    'iframe.webview.ready[src*="extensionId=davidorn.noggin-vscode"]';
  try {
    await page.waitForSelector(outerSelector, { timeout: timeoutMs });
  } catch (err) {
    const diag = await collectDiagnostics(page);
    throw new Error(
      `noggin webview iframe never mounted. Diagnostics:\n${diag}\n\nOriginal error: ${(err as Error).message}`,
    );
  }
  const outer = page.frameLocator(outerSelector);
  // The outer iframe loads an HTML page that itself contains an
  // iframe (`#active-frame`) with the extension's React app.
  const inner = outer.frameLocator('#active-frame');
  // Confirm the inner frame's React app has at least rendered SOMETHING
  // (either the "No noggin open" empty state OR the tree). Picking
  // 'body *' avoids requiring the tree role, since the empty state
  // shows only buttons.
  await inner.locator('body').first().waitFor({ state: 'visible', timeout: timeoutMs });
  return inner;
}

async function collectDiagnostics(page: Page): Promise<string> {
  const frames = page.frames().map((f) => f.url()).join('\n  ');
  const visibleText = await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    return text.replace(/\n+/g, ' | ').slice(0, 800);
  }).catch(() => '<eval failed>');
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map((f) => ({
      cls: f.className,
      src: (f.src || '').slice(0, 160),
    }));
  }).catch(() => [] as Array<{ cls: string; src: string }>);
  const iframeDump = iframes.map((f, i) => `  [${i}] ${f.cls} :: ${f.src}`).join('\n');
  return [
    `frames (${page.frames().length}):`,
    `  ${frames}`,
    `iframes in workbench DOM:`,
    iframeDump || '  (none)',
    `visible workbench text:`,
    `  ${visibleText}`,
  ].join('\n');
}

async function isWelcomeModalVisible(page: Page): Promise<boolean> {
  const dialog = page.getByRole('dialog', { name: /Welcome to Visual Studio Code|Welcome to VS Code/i });
  return dialog.isVisible({ timeout: 500 }).catch(() => false);
}

/** Convenience: write a NogginDocument YAML to disk for test setup. */
export function seedNogginFile(file: string, doc: { items: Array<{ key: string; title: string; done?: boolean; parentKey?: string | null }>; active?: string | null }): void {
  const items = doc.items.map((i) => ({
    key: i.key,
    parentKey: i.parentKey ?? null,
    title: i.title,
    done: !!i.done,
    createdAt: '2026-01-01T00:00:00.000Z',
    notes: [] as unknown[],
  }));
  // Hand-rolled YAML: keep this file standalone (no engine import) so
  // the test setup is obvious to read.
  const lines: string[] = [];
  lines.push('schemaVersion: 1');
  lines.push(`active: ${doc.active ?? 'null'}`);
  lines.push('items:');
  for (const it of items) {
    lines.push(`  - key: ${it.key}`);
    lines.push(`    parentKey: ${it.parentKey === null ? 'null' : it.parentKey}`);
    lines.push(`    title: ${JSON.stringify(it.title)}`);
    lines.push(`    done: ${it.done}`);
    lines.push(`    createdAt: ${it.createdAt}`);
    lines.push('    notes: []');
  }
  writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}
