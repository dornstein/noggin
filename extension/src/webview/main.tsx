// Webview entry — mounts the full @noggin/ui App over a RemoteNoggin
// driving the noggin-rpc server in the extension host.
//
// The host posts an initial `{ kind: 'session', location }` frame to
// tell us what to open. Whenever the location changes (user invokes
// "Noggin: Open File" from the command palette), the host posts a
// new session frame and we re-open.
//
// Bundled by esbuild (extension/esbuild.mjs).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@noggin/ui/styles.css';
import '@noggin/ui/themes/vscode.css';

import { App } from './App';
import './app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Dev only: warn if any --noggin-* token pair falls below WCAG AA
// against the active VS Code theme. Helps catch theme regressions and
// spots where a host override misses one half of a pair.
if (process.env.NODE_ENV !== 'production') {
  void import('@noggin/ui/contrast-check').then((m) => m.checkTokenContrast());
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
