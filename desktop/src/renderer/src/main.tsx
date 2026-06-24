import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Pick the initial location:
//   - ?mock              → in-memory demo noggin (no file I/O)
//   - last-opened recent → reuse the most recent location so users
//     pick up where they left off (matches every other editor's
//     "remembers what was open" behaviour)
//   - otherwise          → ~/.noggin.yaml as a sensible default
// The renderer reaches into Node directly because nodeIntegration is
// on; this is fine because we only load our own bundle.
function initialLocation(): string {
  if (typeof location !== 'undefined' && location.search.includes('mock')) return 'memory://demo';

  // Prefer the most-recently-opened noggin (recents is persisted in
  // localStorage by `recents.ts`). Falls through to the home default
  // when recents is empty or unreadable.
  try {
    const raw = JSON.parse(localStorage.getItem('noggin:recents:v2') || '[]');
    if (Array.isArray(raw) && raw[0] && typeof raw[0].location === 'string') {
      return raw[0].location;
    }
  } catch { /* fall through */ }

  // In the Electron renderer (nodeIntegration: true) we can require
  // node builtins to compute a sensible default. In a plain browser
  // these aren't available, so fall back to a memory noggin.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (window as unknown as { require?: (id: string) => unknown }).require;
    if (typeof req !== 'function') return 'memory://demo';
    const os = req('node:os') as typeof import('node:os');
    const path = req('node:path') as typeof import('node:path');
    return path.join(os.homedir(), '.noggin.yaml');
  } catch {
    return 'memory://demo';
  }
}

createRoot(root).render(
  <StrictMode>
    <App initialLocation={initialLocation()} />
  </StrictMode>,
);
