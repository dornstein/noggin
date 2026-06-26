// Manually invoke @noggin/ui/contrast-check inside the live noggin
// webview and print the result. The webview's NODE_ENV !== 'production'
// auto-runs the check at boot, but the messages fly before our CDP
// listener attaches. This re-runs it on demand.

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
const att = await call('Target.attachToTarget', { targetId: ifr.targetId, flatten: true });
const sid = att.sessionId;
await call('Runtime.enable', {}, sid);
await new Promise((r) => setTimeout(r, 400));

// Find the inner React context.
const my = ctxs.get(sid) || [];
let inner = null;
for (const c of my) {
  const r = await call('Runtime.evaluate', { contextId: c.id, returnByValue: true, expression: `typeof acquireVsCodeApi === 'function'` }, sid);
  if (r.result.value) { inner = c.id; break; }
}
if (!inner) { console.log('no inner ctx'); process.exit(0); }

// Inline a compact contrast checker (mirror of the lib) — easier than
// trying to dynamic-import the bundled module from the webview at this
// point in its lifecycle.
const PAIRS = [
  ['--noggin-canvas-bg', '--noggin-canvas-fg', 'canvas / body'],
  ['--noggin-canvas-bg', '--noggin-canvas-fg-strong', 'canvas / strong'],
  ['--noggin-canvas-bg', '--noggin-canvas-fg-muted', 'canvas / muted'],
  ['--noggin-row-hover-bg', '--noggin-row-hover-fg', 'row hover'],
  ['--noggin-row-selected-bg', '--noggin-row-selected-fg', 'row selected'],
  ['--noggin-row-active-bg', '--noggin-row-active-fg', 'row active'],
  ['--noggin-row-active-bg', '--noggin-row-active-fg-muted', 'row active / muted'],
  ['--noggin-elevated-bg', '--noggin-elevated-fg', 'elevated container'],
  ['--noggin-elevated-bg', '--noggin-elevated-fg-muted', 'elevated / muted'],
  ['--noggin-sunken-bg', '--noggin-sunken-fg', 'sunken container'],
  ['--noggin-sunken-bg', '--noggin-sunken-fg-muted', 'sunken / muted'],
  ['--noggin-input-bg', '--noggin-input-fg', 'input'],
  ['--noggin-input-bg', '--noggin-input-placeholder-fg', 'input placeholder'],
  ['--noggin-accent-bg', '--noggin-accent-fg', 'accent button'],
  ['--noggin-danger-bg', '--noggin-danger-fg', 'danger button'],
  ['--noggin-error-bg', '--noggin-error-fg', 'error banner'],
  ['--noggin-warning-bg', '--noggin-warning-fg', 'warning banner'],
];

const r = await call('Runtime.evaluate', {
  contextId: inner,
  returnByValue: true,
  expression: `(() => {
    const pairs = ${JSON.stringify(PAIRS)};
    const style = getComputedStyle(document.documentElement);
    const canvasRaw = style.getPropertyValue('--noggin-canvas-bg').trim();
    function parse(input) {
      const m = (input || '').match(/rgba?\\(([^)]+)\\)/i);
      if (m) {
        const parts = m[1].split(/[\\s,/]+/).filter(Boolean);
        const [r, g, b] = parts.slice(0, 3).map(Number);
        const a = parts[3] !== undefined ? Number(parts[3]) : 1;
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return { r, g, b, a };
      }
      const hex = (input || '').trim().match(/^#([0-9a-f]{3,8})\$/i);
      if (hex) {
        const h = hex[1];
        if (h.length === 6) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 };
        if (h.length === 3) return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 };
      }
      return null;
    }
    function composite(c, against) {
      if (c.a >= 1 || !against) return c;
      return { r: c.r*c.a + against.r*(1-c.a), g: c.g*c.a + against.g*(1-c.a), b: c.b*c.a + against.b*(1-c.a), a: 1 };
    }
    function lum(c) {
      const ch = (v) => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
      return 0.2126*ch(c.r) + 0.7152*ch(c.g) + 0.0722*ch(c.b);
    }
    function ratio(a, b) { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi+0.05)/(lo+0.05); }
    const canvasRgb = parse(canvasRaw);
    const out = [];
    for (const [bgT, fgT, label] of pairs) {
      const bg = style.getPropertyValue(bgT).trim();
      const fg = style.getPropertyValue(fgT).trim();
      let bgRgb = parse(bg);
      const fgRgb = parse(fg);
      if (!bgRgb || !fgRgb) { out.push({ label, bg, fg, skip: true }); continue; }
      if (bgRgb.a < 1 && canvasRgb && bgT !== '--noggin-canvas-bg') bgRgb = composite(bgRgb, canvasRgb);
      const fgC = composite(fgRgb, bgRgb);
      const r = ratio(bgRgb, fgC);
      out.push({ label, bg, fg, ratio: Math.round(r*100)/100, pass: r >= 4.5 });
    }
    return out;
  })()`,
}, sid);

console.log('Contrast check (' + r.result.value.length + ' pairs):');
for (const row of r.result.value) {
  const status = row.skip ? '(skipped)' : (row.pass ? 'PASS' : 'FAIL');
  console.log(`  [${status}] ${row.label.padEnd(28)} ratio ${row.ratio ?? '?'} ` +
    `bg=${row.bg} fg=${row.fg}`);
}
ws.close();
