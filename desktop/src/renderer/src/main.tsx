import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Dev only: warn if any --noggin-* token pair falls below WCAG AA
// against the active theme. Disabled in production builds.
if (import.meta.env.DEV) {
  void import('@noggin/ui/contrast-check').then((m) => m.checkTokenContrast());
}

// Pick the initial location:
//   - ?mock              → in-memory demo noggin (no file I/O)
//   - last-opened recent → reuse the most recent location so users
//     pick up where they left off (matches every other editor's
//     "remembers what was open" behaviour)
//   - otherwise          → null; the welcome state prompts the user
//     to open or create one.
function initialLocation(): string | null {
  if (typeof location !== 'undefined' && location.search.includes('mock')) return 'memory://demo';

  try {
    const raw = JSON.parse(localStorage.getItem('noggin:recents:v2') || '[]');
    if (Array.isArray(raw) && raw[0] && typeof raw[0].location === 'string') {
      return raw[0].location;
    }
  } catch { /* fall through */ }

  return null;
}

createRoot(root).render(
  <StrictMode>
    <App initialLocation={initialLocation()} />
  </StrictMode>,
);
