// Markdown rendering used by both the notes list (read-only) and the
// note editor's preview pane. Lazy-imports `marked` so the bundle
// stays small for hosts that don't use markdown features yet.

import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/** Render markdown to HTML. Trusted source (user's own notes). */
export function renderMarkdown(src: string): string {
  if (!src) return '';
  try {
    return marked.parse(src, { async: false }) as string;
  } catch {
    return escapeHtml(src).replace(/\n/g, '<br>');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
