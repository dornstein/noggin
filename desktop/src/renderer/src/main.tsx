import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Tag <body> with the OS so styles.css can adjust the title-bar
// caption reservation (Mac traffic lights on the left, Windows/Linux
// caption buttons on the right). We probe via userAgent since the
// renderer has no direct access to `process.platform`.
if (typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)) {
  document.body.classList.add('platform-darwin');
}

// Dev only: warn if any --noggin-* token pair falls below WCAG AA
// against the active theme. Disabled in production builds.
if (import.meta.env.DEV) {
  void import('@noggin/ui/contrast-check').then((m) => m.checkTokenContrast());
}

// Pick the initial location:
//   - ?mock              → in-memory demo noggin (no file I/O)
//   - MRU top entry      → the URI the user was most recently on
//   - otherwise          → null; the welcome state prompts them to
//     open or create one.
function initialLocation(): string | null {
  if (typeof location !== 'undefined' && location.search.includes('mock')) return 'memory://demo';

  try {
    const raw = JSON.parse(localStorage.getItem('noggin:mru:v1') || '{}');
    if (raw && typeof raw === 'object') {
      let bestUri: string | null = null;
      let bestTs = '';
      for (const [uri, ts] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof uri !== 'string' || !uri) continue;
        if (typeof ts !== 'string') continue;
        if (ts.localeCompare(bestTs) > 0) { bestUri = uri; bestTs = ts; }
      }
      return bestUri;
    }
  } catch { /* fall through */ }

  return null;
}

createRoot(root).render(
  <StrictMode>
    <App initialLocation={initialLocation()} />
  </StrictMode>,
);
