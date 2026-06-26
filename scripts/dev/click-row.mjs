// Click a row in the noggin tree at a specific position to verify
// selected-state contrast. Issues a Page.dispatchMouseEvent into the
// noggin webview iframe.
const ver = await (await fetch('http://127.0.0.1:9224/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const e = pending.get(m.id); pending.delete(m.id);
    if (m.error) e.reject(new Error(m.error.message)); else e.resolve(m.result);
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
const tgs = await call('Target.getTargets');
const ifr = tgs.targetInfos.find((t) => t.type === 'iframe' && /noggin/.test(t.url));
const att = await call('Target.attachToTarget', { targetId: ifr.targetId, flatten: true });
const sid = att.sessionId;
await call('Runtime.enable', {}, sid);
// Click the 5th row by path /1/5 directly via JS.
await call('Runtime.evaluate', {
  expression: `(() => {
    const rows = document.querySelectorAll('[role="treeitem"]');
    for (const r of rows) {
      const label = r.querySelector('.title')?.textContent;
      if (label === 'task-3') { r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return label; }
    }
    return null;
  })()`,
}, sid);
ws.close();
console.log('clicked');
