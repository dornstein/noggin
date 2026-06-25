#!/usr/bin/env node
// Inspect the running noggin VS Code extension dev host.
//
// Connects to Chromium DevTools Protocol on port 9224 (set by
// .vscode/launch.json's "Run Noggin Extension" config), walks the
// target tree to find the noggin webview iframe, and reports:
//
//   - the React root's outer HTML
//   - the visible body text
//   - any uncaught exceptions
//   - the most recent console messages
//
// Usage:
//
//   1. In the main VS Code window, press F5 (or pick "Run Noggin
//      Extension" / "Run Noggin Extension (watch)" from the Debug
//      sidebar). The extension host launches with CDP enabled on
//      port 9224 because launch.json passes --remote-debugging-port=9224.
//   2. Click the Noggin icon in the activity bar so the webview mounts.
//   3. From a terminal at the repo root:
//        node scripts/dev/inspect-extension-webview.mjs
//
// The script is one-shot and read-only — it doesn't change any
// extension state.

const PORT = process.env.CDP_PORT || 9224;
const HOST = '127.0.0.1';

let ver;
try {
  ver = await (await fetch(`http://${HOST}:${PORT}/json/version`)).json();
} catch (err) {
  console.error(`Couldn't reach CDP on port ${PORT}. Is the noggin extension running?`);
  console.error(`Launch it via F5 from the workspace and try again.`);
  console.error(`(Error: ${err.message})`);
  process.exit(1);
}
console.log('Browser:', ver['User-Agent']);

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const events = [];
const contexts = new Map(); // sessionId -> [contexts]

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const e = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) e.reject(new Error(m.error.message));
    else e.resolve(m.result);
  } else if (m.method) {
    events.push(m);
    if (m.method === 'Runtime.executionContextCreated') {
      const sid = m.sessionId || 'default';
      if (!contexts.has(sid)) contexts.set(sid, []);
      contexts.get(sid).push(m.params.context);
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
const nogginIframe = tgs.targetInfos.find(
  (t) => t.type === 'iframe' && t.url?.includes('extensionId=davidorn.noggin-vscode'),
);

if (!nogginIframe) {
  console.log('\nNo noggin webview iframe found. Open the Noggin activity bar item first.');
  console.log('\nVisible targets:');
  for (const t of tgs.targetInfos) {
    console.log(' -', t.type, '|', (t.url || '').slice(0, 120));
  }
  ws.close();
  process.exit(0);
}

console.log('\nAttached to noggin webview iframe:');
console.log(' ', nogginIframe.url?.split('&')[0]);

const att = await call('Target.attachToTarget', { targetId: nogginIframe.targetId, flatten: true });
const sid = att.sessionId;
await call('Runtime.enable', {}, sid);
await call('Page.enable', {}, sid);
await call('Log.enable', {}, sid);
await new Promise((r) => setTimeout(r, 500));

// VS Code webviews layer two same-origin iframes: an outer index.html
// wrapper and an inner one that loads the actual app bundle. The
// inner one is the context that has `acquireVsCodeApi`.
const myCtx = contexts.get(sid) || [];
let innerCtxId = null;
for (const c of myCtx) {
  const r = await call('Runtime.evaluate', {
    contextId: c.id,
    returnByValue: true,
    expression: `typeof acquireVsCodeApi === 'function'`,
  }, sid);
  if (r.result.value) { innerCtxId = c.id; break; }
}

if (!innerCtxId) {
  console.log('\nNo execution context with `acquireVsCodeApi` found.');
  console.log('Contexts:', myCtx.map((c) => ({ id: c.id, frame: c.auxData?.frameId?.slice(0, 8) })));
  ws.close();
  process.exit(0);
}

const state = await call('Runtime.evaluate', {
  contextId: innerCtxId,
  returnByValue: true,
  expression: `(() => {
    const root = document.getElementById('root');
    return {
      url: location.href.split('&')[0],
      docReady: document.readyState,
      rootHTML: root?.outerHTML?.slice(0, 1500) ?? '(no #root)',
      bodyText: (document.body?.innerText || '').slice(0, 800),
      windowGlobals: Object.keys(window).filter((k) => /noggin|rpc|modal|shell|acquire/i.test(k)),
      title: document.title,
    };
  })()`,
}, sid);

console.log('\n── Webview state ──');
console.log(JSON.stringify(state.result.value, null, 2));

const exs = events.filter((e) => e.method === 'Runtime.exceptionThrown' && e.sessionId === sid);
const cons = events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.sessionId === sid);
const logs = events.filter((e) => e.method === 'Log.entryAdded' && e.sessionId === sid);

if (exs.length > 0) {
  console.log(`\n── Exceptions (${exs.length}) ──`);
  for (const e of exs) {
    const d = e.params.exceptionDetails;
    console.log(`  [${d.url?.split('/').pop() || '?'}:${d.lineNumber}:${d.columnNumber}] ${d.text}`);
    if (d.exception?.description) console.log('   ' + d.exception.description.slice(0, 400));
  }
}

if (cons.length > 0) {
  console.log(`\n── Console (${cons.length}) ──`);
  for (const e of cons.slice(-10)) {
    const args = (e.params.args || []).map((a) => a.value ?? a.description ?? '?').join(' ');
    console.log(`  [${e.params.type}] ${args.slice(0, 400)}`);
  }
}

if (logs.length > 0) {
  console.log(`\n── Log entries (${logs.length}) ──`);
  for (const e of logs.slice(-5)) {
    console.log(`  [${e.params.entry.level}] ${e.params.entry.source}: ${e.params.entry.text?.slice(0, 300)}`);
  }
}

ws.close();
