// One-shot: read the noggin webview's console log including the
// contrast-checker output. Same attach machinery as the inspector but
// captures all `Runtime.consoleAPICalled` events from the inner
// React context.

const ver = await (await fetch('http://127.0.0.1:9224/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const ctxs = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const e = pending.get(m.id); pending.delete(m.id);
    if (m.error) e.reject(new Error(m.error.message)); else e.resolve(m.result);
  } else if (m.method) {
    events.push(m);
    if (m.method === 'Runtime.executionContextCreated') {
      const sid = m.sessionId || 'default';
      if (!ctxs.has(sid)) ctxs.set(sid, []);
      ctxs.get(sid).push(m.params.context);
    }
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
if (!ifr) { console.log('no noggin iframe'); process.exit(0); }
const att = await call('Target.attachToTarget', { targetId: ifr.targetId, flatten: true });
const sid = att.sessionId;
await call('Runtime.enable', {}, sid);
await call('Log.enable', {}, sid);
await new Promise((r) => setTimeout(r, 1500));

const cons = events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.sessionId === sid);
console.log('Console messages from noggin webview (' + cons.length + '):');
for (const e of cons) {
  const args = (e.params.args || []).map((a) => a.value ?? a.description ?? '?').join(' ');
  console.log(`  [${e.params.type}] ${args}`);
}
ws.close();
