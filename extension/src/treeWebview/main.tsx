// React entry point for the noggin tree webview.
// Bundled by esbuild into out/webview/treeView.js (IIFE).

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('noggin tree webview: #root element missing');

createRoot(root).render(<App />);
