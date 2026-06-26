// @noggin/ui — runtime contrast checker for the theming token system.
//
// Dev aid: walks every paired (background, foreground) token from
// tokens.css after the stylesheet has resolved, computes the WCAG
// contrast ratio between the two, and emits a `console.warn` for
// each pair that falls below AA. The library never throws or alters
// rendering — the host decides whether to act on the warnings.
//
// Intended to be called once at host mount in dev builds:
//
//     if (import.meta.env.DEV) {
//       import('@noggin/ui/contrast-check').then((m) => m.checkTokenContrast());
//     }
//
// Production builds should NOT import this — it's pure overhead.
//
// We deliberately only check pairs declared in the canonical contract.
// Hosts that introduce custom tokens are responsible for their own
// pairing.

/** @public Pair definition. The first element is the background
 *  token; the second is the foreground that MUST be legible against
 *  it. `large` marks pairs used only on 18pt+ text (different AA
 *  threshold). */
export interface TokenPair {
  readonly bg: string;
  readonly fg: string;
  readonly label: string;
  readonly large?: boolean;
}

/** The canonical pair set. Mirrors tokens.css. */
const PAIRS: ReadonlyArray<TokenPair> = [
  { bg: '--noggin-canvas-bg',     fg: '--noggin-canvas-fg',           label: 'canvas / body' },
  { bg: '--noggin-canvas-bg',     fg: '--noggin-canvas-fg-strong',    label: 'canvas / strong' },
  { bg: '--noggin-canvas-bg',     fg: '--noggin-canvas-fg-muted',     label: 'canvas / muted' },

  { bg: '--noggin-row-hover-bg',  fg: '--noggin-row-hover-fg',        label: 'row hover' },
  { bg: '--noggin-row-selected-bg', fg: '--noggin-row-selected-fg',   label: 'row selected' },
  { bg: '--noggin-row-active-bg', fg: '--noggin-row-active-fg',       label: 'row active' },
  { bg: '--noggin-row-active-bg', fg: '--noggin-row-active-fg-muted', label: 'row active / muted' },

  { bg: '--noggin-elevated-bg',   fg: '--noggin-elevated-fg',         label: 'elevated container' },
  { bg: '--noggin-elevated-bg',   fg: '--noggin-elevated-fg-muted',   label: 'elevated / muted' },
  { bg: '--noggin-sunken-bg',     fg: '--noggin-sunken-fg',           label: 'sunken container' },
  { bg: '--noggin-sunken-bg',     fg: '--noggin-sunken-fg-muted',     label: 'sunken / muted' },
  { bg: '--noggin-input-bg',      fg: '--noggin-input-fg',            label: 'input' },
  { bg: '--noggin-input-bg',      fg: '--noggin-input-placeholder-fg', label: 'input placeholder' },

  { bg: '--noggin-accent-bg',     fg: '--noggin-accent-fg',           label: 'accent button' },
  { bg: '--noggin-danger-bg',     fg: '--noggin-danger-fg',           label: 'danger button' },
  { bg: '--noggin-error-bg',      fg: '--noggin-error-fg',            label: 'error banner' },
  { bg: '--noggin-warning-bg',    fg: '--noggin-warning-fg',          label: 'warning banner' },
];

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

/** @public Check every canonical token pair on `document.documentElement`
 *  and warn for any that fall below WCAG AA. */
export function checkTokenContrast(target: Element = document.documentElement): void {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return;
  const style = getComputedStyle(target);
  const failures: Array<{ pair: TokenPair; ratio: number; threshold: number; bg: string; fg: string }> = [];

  // The "canvas" fills the page; translucent backgrounds composite
  // over it. Resolve it once so we can flatten any rgba() values to
  // their visual color.
  const canvasRaw = style.getPropertyValue('--noggin-canvas-bg').trim();
  const canvasRgb = canvasRaw ? parseColor(canvasRaw) : null;

  for (const pair of PAIRS) {
    const bgRaw = style.getPropertyValue(pair.bg).trim();
    const fgRaw = style.getPropertyValue(pair.fg).trim();
    if (!bgRaw || !fgRaw) continue;  // token missing — host hasn't set it
    let bgRgb = parseColor(bgRaw);
    if (!bgRgb) continue;
    // Flatten translucent bg over the canvas so the foreground
    // contrast we measure matches what the user actually sees.
    if (bgRgb.a < 1 && canvasRgb && pair.bg !== '--noggin-canvas-bg') {
      bgRgb = composite(bgRgb, canvasRgb);
    }
    const fgRgb = parseColor(fgRaw, bgRgb);
    if (!fgRgb) continue;
    const ratio = contrastRatio(bgRgb, fgRgb);
    const threshold = pair.large ? AA_LARGE : AA_NORMAL;
    if (ratio < threshold) {
      failures.push({ pair, ratio, threshold, bg: bgRaw, fg: fgRaw });
    }
  }

  if (failures.length === 0) {
    // eslint-disable-next-line no-console
    console.info(`[@noggin/ui] token contrast check: all ${PAIRS.length} pairs pass WCAG AA.`);
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[@noggin/ui] token contrast check: ${failures.length} pair(s) below WCAG AA.\n` +
    failures.map((f) =>
      `  ${f.pair.label.padEnd(28)} ratio ${f.ratio.toFixed(2)} < ${f.threshold.toFixed(1)}` +
      ` (bg ${f.pair.bg} = ${f.bg}, fg ${f.pair.fg} = ${f.fg})`,
    ).join('\n'),
  );
}

// ── Color math ─────────────────────────────────────────────────────

interface Rgb { r: number; g: number; b: number; a: number; }

function parseColor(input: string, against?: Rgb): Rgb | null {
  // Browsers normalise computed colors to `rgb(r, g, b)` or
  // `rgba(r, g, b, a)` or modern `rgb(r g b / a)`. Handle both.
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try canvas as a fallback for `color-mix(...)`, `oklch(...)` etc.
  // (modern features VS Code's Chromium understands but our regex doesn't).
  const m = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const a = parts[3] !== undefined ? parseAlpha(parts[3]) : 1;
      if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return null;
      return composite({ r, g, b, a }, against);
    }
  }

  // Hex fallback (e.g. tokens.css default values evaluated as `#1f6feb`).
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return composite({ r, g, b, a }, against);
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return composite({ r, g, b, a }, against);
    }
  }

  return null;
}

function parseAlpha(part: string): number {
  const trimmed = part.trim();
  if (trimmed.endsWith('%')) return Math.max(0, Math.min(1, Number(trimmed.slice(0, -1)) / 100));
  return Math.max(0, Math.min(1, Number(trimmed)));
}

/** Flatten a translucent foreground over its actual background so the
 *  contrast calculation reflects what the user sees. Background tokens
 *  themselves are assumed opaque; if not, we treat as-is. */
function composite(c: Rgb, against?: Rgb): Rgb {
  if (c.a >= 1 || !against) return c;
  return {
    r: c.r * c.a + against.r * (1 - c.a),
    g: c.g * c.a + against.g * (1 - c.a),
    b: c.b * c.a + against.b * (1 - c.a),
    a: 1,
  };
}

function relativeLuminance(c: Rgb): number {
  const channel = (v: number) => {
    const sRGB = v / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
