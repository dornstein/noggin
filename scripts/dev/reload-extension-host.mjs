#!/usr/bin/env node
// Reload the running VS Code Extension Development Host so the latest
// `extension/out/` bundles take effect — without you having to switch
// to that window. Mirrors what Ctrl+R in the dev host does.
//
// How: VS Code's workbench listens for keyboard shortcuts via DOM events.
// We attach to the workbench page over CDP and dispatch the
// Developer: Reload Window command by simulating its default keybinding
// (Ctrl+R). That kills the extension host and respawns it; the
// webview re-runs `resolveWebviewView`, the rpc server stands up
// again, and the noggin view re-renders with the new bundle.
//
// Usage:
//   node scripts/dev/reload-extension-host.mjs

const PORT = process.env.CDP_PORT || 9224;
const HOST = '127.0.0.1';

let ver;
try {
  ver = await (await fetch(`http://${HOST}:${PORT}/json/version`)).json();
} catch (err) {
  console.error(`Couldn't reach CDP on port ${PORT}. Is the noggin dev host running?`);
  console.error(`(Error: ${err.message})`);
  process.exit(1);
}

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const e = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) e.reject(new Error(m.error.message));
    else e.resolve(m.result);
  }
});

await new Promise((r) => ws.addEventListener('open', r));

const call = (method, params = {}, sessionId = null) => {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(msg));
  });
};

// Find the workbench page (the main VS Code window).
const tgs = await call('Target.getTargets');
const page = tgs.targetInfos.find(
  (t) => t.type === 'page' && t.url?.includes('workbench.html'),
);
if (!page) {
  console.error('No workbench page found via CDP.');
  ws.close();
  process.exit(1);
}

const att = await call('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const sid = att.sessionId;
await call('Runtime.enable', {}, sid);
await call('Page.enable', {}, sid);

// Trigger the reload command directly through the workbench's command
// service. The `workbench.action.reloadWindow` command is bound by
// default; we fire it through executeCommand via the global services
// VS Code exposes on the page.
//
// VS Code doesn't expose its services globally, so the most reliable
// way is to dispatch the Ctrl+R keybinding. Send keyDown + keyUp on
// the body — VS Code's keybinding service handles it.

console.log('Issuing Ctrl+R (Developer: Reload Window) to the dev host…');
await call('Input.dispatchKeyEvent', {
  type: 'rawKeyDown',
  modifiers: 2, // Ctrl
  key: 'r',
  code: 'KeyR',
  windowsVirtualKeyCode: 82,
  nativeVirtualKeyCode: 82,
  text: '',
  unmodifiedText: '',
}, sid);
await call('Input.dispatchKeyEvent', {
  type: 'keyUp',
  modifiers: 2,
  key: 'r',
  code: 'KeyR',
  windowsVirtualKeyCode: 82,
  nativeVirtualKeyCode: 82,
}, sid);

// Give VS Code a moment to start the reload before we close the
// socket; closing too eagerly can race the command dispatch.
await new Promise((r) => setTimeout(r, 400));
console.log('Reload dispatched. The webview should refresh in a few seconds.');
console.log('Run scripts/dev/inspect-extension-webview.mjs after ~3 seconds to confirm.');
ws.close();
