// Custom title bar for the Electron desktop shell.
//
// Rendered at the top of App.tsx above the workspace. The main
// process configures `titleBarStyle: 'hidden'` (or `'hiddenInset'` on
// macOS), so the OS still paints the min/max/close glyphs in their
// native positions but the rest of the strip is a transparent zone
// for us to paint into. `-webkit-app-region: drag` on the container
// makes the whole strip act as a window drag handle; interactive
// islands opt back out with `no-drag`.
//
// A frameless-hidden window doesn't get the native Alt-to-show-menu
// behaviour on Windows/Linux (there's no room for the menu strip to
// draw next to the caption glyphs). The hamburger menu below is the
// discoverable replacement — matches the pattern used by VS Code,
// GitHub Desktop, Slack, and every other custom-titlebar Electron
// app. The native app menu is still registered so its keyboard
// accelerators (zoom in/out, fullscreen, DevTools in dev) stay wired.
//
// See `desktop/src/main/index.ts` (window options + updater state
// machine) and `desktop/src/renderer/src/updater.ts` (React hook)
// for the pieces that feed the update indicator.

import { Icon } from '@noggin/ui';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';

import type { HelpBridge } from '../../preload/index';
import { useUpdaterState, type UpdaterStatus } from './updater';

// True when running under `electron-vite dev`. Aligns with
// `app.isPackaged === false` in the main process; used to swap the
// passive check-for-updates button for a "DEV" badge so it's obvious
// why the updater state machine never transitions.
const IS_DEV = import.meta.env.DEV;

declare global {
  interface Window {
    help?: HelpBridge;
  }
}

const REPO_URL = 'https://github.com/dornstein/noggin';
const ISSUES_URL = `${REPO_URL}/issues`;
const DOCS_URL = `${REPO_URL}#readme`;

export function TitleBar() {
  const updater = useUpdaterState();

  return (
    <div className="titlebar" role="banner">
      <div className="titlebar-left">
        <AppMenu updater={updater} />
        <span className="titlebar-brand" aria-hidden="true">
          <span className="titlebar-brand-dot" />
        </span>
        <span className="titlebar-title">noggin</span>
      </div>

      <div className="titlebar-right">
        {IS_DEV ? <DevBadge /> : (
          <UpdateIndicator
            status={updater.status}
            onCheck={updater.checkNow}
            onRestart={updater.restartNow}
          />
        )}
      </div>
    </div>
  );
}

// ── Hamburger menu ───────────────────────────────────────────────────

function AppMenu({ updater }: { updater: ReturnType<typeof useUpdaterState> }) {
  const openUrl = (url: string) => window.help?.openUrl(url);
  const showAbout = () => window.help?.showAbout();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="titlebar-icon-btn"
          title="Menu"
          aria-label="Menu"
        >
          <Icon name="menu" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="titlebar-menu"
          align="start"
          sideOffset={4}
        >
          <DropdownMenu.Item className="titlebar-menu-item" onSelect={() => openUrl(DOCS_URL)}>
            <Icon name="book" /> Documentation
          </DropdownMenu.Item>
          <DropdownMenu.Item className="titlebar-menu-item" onSelect={() => openUrl(REPO_URL)}>
            <Icon name="github" /> GitHub Repository
          </DropdownMenu.Item>
          <DropdownMenu.Item className="titlebar-menu-item" onSelect={() => openUrl(ISSUES_URL)}>
            <Icon name="bug" /> Report an Issue…
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="titlebar-menu-separator" />
          <DropdownMenu.Item className="titlebar-menu-item" onSelect={updater.checkNow}>
            <Icon name="cloud-download" /> Check for Updates…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="titlebar-menu-item" onSelect={showAbout}>
            <Icon name="info" /> About noggin
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ── DEV badge ────────────────────────────────────────────────────────

function DevBadge() {
  return (
    <span
      className="titlebar-pill titlebar-pill--dev"
      title={
        'Running from source (electron-vite dev). Auto-update is disabled '
        + 'in development builds — the packaged app checks GitHub Releases '
        + 'on launch and shows update status here.'
      }
    >
      <Icon name="tools" />
      <span>DEV</span>
    </span>
  );
}

// ── Update indicator ─────────────────────────────────────────────────

interface IndicatorProps {
  status: UpdaterStatus;
  onCheck: () => void;
  onRestart: () => void;
}

function UpdateIndicator({ status, onCheck, onRestart }: IndicatorProps) {
  // Show a transient "Up to date" chip for a few seconds after an
  // explicit check comes back clean, then fade back to the passive
  // check button. Avoids the pill living permanently in the strip.
  const [showUpToDate, setShowUpToDate] = useState(false);
  useEffect(() => {
    if (status.kind !== 'up-to-date') return;
    setShowUpToDate(true);
    const t = setTimeout(() => setShowUpToDate(false), 3000);
    return () => clearTimeout(t);
  }, [status]);

  switch (status.kind) {
    case 'idle':
      return <PassiveCheckButton onClick={onCheck} />;
    case 'checking':
      return (
        <StatusPill tone="neutral" title="Checking for updates…">
          <Icon name="sync" className="titlebar-spin" />
          <span>Checking…</span>
        </StatusPill>
      );
    case 'up-to-date':
      return showUpToDate ? (
        <StatusPill tone="success" title={`noggin ${status.currentVersion} is the latest version`}>
          <Icon name="check" />
          <span>Up to date</span>
        </StatusPill>
      ) : (
        <PassiveCheckButton onClick={onCheck} />
      );
    case 'available':
      return (
        <StatusPill tone="accent" title={`noggin ${status.version} is available; downloading…`}>
          <Icon name="cloud-download" />
          <span>Update available</span>
        </StatusPill>
      );
    case 'downloading': {
      const pct = Math.max(0, Math.min(100, Math.round(status.percent)));
      const rate = status.bytesPerSecond
        ? ` · ${formatBytes(status.bytesPerSecond)}/s`
        : '';
      return (
        <StatusPill
          tone="accent"
          title={`Downloading noggin ${status.version} (${pct}%${rate})`}
        >
          <Icon name="cloud-download" />
          <span>Downloading {pct}%</span>
          <span
            className="titlebar-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span className="titlebar-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        </StatusPill>
      );
    }
    case 'downloaded':
      return (
        <button
          type="button"
          className="titlebar-pill titlebar-pill--accent titlebar-pill--action"
          onClick={onRestart}
          title={`noggin ${status.version} is ready — click to restart and install`}
        >
          <Icon name="debug-restart" />
          <span>Restart to install</span>
        </button>
      );
    case 'error':
      return (
        <button
          type="button"
          className="titlebar-pill titlebar-pill--danger titlebar-pill--action"
          onClick={onCheck}
          title={`Update check failed: ${status.message}\nClick to retry.`}
        >
          <Icon name="warning" />
          <span>Update failed</span>
        </button>
      );
  }
}

// ── Small building blocks ─────────────────────────────────────────────

function PassiveCheckButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="titlebar-icon-btn"
      onClick={onClick}
      title="Check for updates"
      aria-label="Check for updates"
    >
      <Icon name="cloud-download" />
    </button>
  );
}

interface PillProps {
  tone: 'neutral' | 'accent' | 'success' | 'danger';
  title?: string;
  children: React.ReactNode;
}

function StatusPill({ tone, title, children }: PillProps) {
  return (
    <span className={`titlebar-pill titlebar-pill--${tone}`} title={title}>
      {children}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
