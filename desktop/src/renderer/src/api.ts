// Typed accessor for the API the preload script exposed on `window`.
// Centralized so the renderer never types `(window as any).noggin`.

import type { NogginIpc } from '@shared/ipc';

declare global {
  interface Window {
    noggin: NogginIpc;
  }
}

export const noggin: NogginIpc = window.noggin;
