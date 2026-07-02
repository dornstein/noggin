// Renderer-side subscription to the main-process electron-updater
// state machine. Preload exposes `window.updater`; this hook drives
// the title-bar update indicator (see TitleBar.tsx).

import { useEffect, useState } from 'react';

import type { UpdaterBridge } from '../../preload/index';
import type { UpdaterStatus } from '@shared/updater';

declare global {
  interface Window {
    updater?: UpdaterBridge;
  }
}

export type { UpdaterStatus } from '@shared/updater';

export interface UpdaterState {
  status: UpdaterStatus;
  checkNow: () => void;
  restartNow: () => void;
}

const NOOP: UpdaterState = {
  status: { kind: 'idle' },
  checkNow: () => { /* no bridge in this host */ },
  restartNow: () => { /* no bridge in this host */ },
};

export function useUpdaterState(): UpdaterState {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: 'idle' });

  useEffect(() => {
    const u = window.updater;
    if (!u) return;
    let cancelled = false;
    u.getStatus().then((s) => { if (!cancelled) setStatus(s); }).catch(() => {});
    const unsub = u.onStatus(setStatus);
    return () => { cancelled = true; unsub(); };
  }, []);

  const u = window.updater;
  if (!u) return NOOP;

  return {
    status,
    checkNow: () => u.checkNow(),
    restartNow: () => u.restartNow(),
  };
}
