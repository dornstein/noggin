// Renderer-side access to noggin-rpc host services.
//
// The sidebar `+` menu needs native file dialogs. Those are host
// services: they flow client -> server over noggin-rpc, the server's
// HostServices runs the native dialog in the host process (Electron
// main), and returns the chosen path. This replaces the old
// `window.shell` file-dialog channel — the dialogs now ride the one
// noggin-rpc channel like everything else.

import { getRpcClient } from './rpc-client';
import type {
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
} from '@noggin/rpc';

/** Native open dialog. Returns the chosen path, or null on cancel /
 *  when the rpc bridge is unavailable (e.g. plain-browser iteration). */
export async function pickFile(): Promise<string | null> {
  try {
    const req: HostPickFileRequest = {
      title: 'Open noggin',
      filters: [
        { name: 'Noggin (YAML)', extensions: ['yaml', 'yml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const res = await getRpcClient().request<HostPickFileResponse>('host.pickFile', req);
    return res.paths[0] ?? null;
  } catch {
    return null;
  }
}

/** Native save dialog. Returns the chosen path (the host seeds an
 *  empty noggin there if the file is new), or null on cancel. */
export async function pickNewFile(): Promise<string | null> {
  try {
    const req: HostPickNewFileRequest = {
      title: 'Create new noggin',
      defaultPath: '.noggin.yaml',
      filters: [{ name: 'Noggin (YAML)', extensions: ['yaml'] }],
    };
    const res = await getRpcClient().request<HostPickNewFileResponse>('host.pickNewFile', req);
    return res.path;
  } catch {
    return null;
  }
}
