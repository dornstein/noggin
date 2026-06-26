// Take a PNG screenshot of the noggin webview iframe.
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
const page = tgs.targetInfos.find((t) => t.type === 'page' && t.url?.includes('workbench'));
const att = await call('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const sid = att.sessionId;
await call('Page.enable', {}, sid);
const r = await call('Page.captureScreenshot', { format: 'png' }, sid);
const fs = await import('node:fs');
const path = process.argv[2] || 'C:\\repos\\noggin\\.tmp\\screenshot.png';
fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
console.log('Wrote', path);
ws.close();
