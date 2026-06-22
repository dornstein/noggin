// Generate the verb demo page by reusing the existing scenario
// runner from scripts/build-demo-html.mjs. The site wraps the demo
// in the standard chrome (sidebar + footer) so users keep navigation
// when they land here.

import path from 'node:path';
import url from 'node:url';

import { renderBody, runAllScenarios } from '../../../scripts/build-demo-html.mjs';

export function buildDemoPage() {
  const rows = runAllScenarios();
  const { body, styles } = renderBody(rows);
  // Inline the scenario styles directly into the page body so we
  // don't have to plumb a per-page <style> slot through the template.
  // (The styles use the same CSS variables the site theme defines.)
  return `<style>${styles}</style>\n${body}\n<p class="muted" style="margin-top:32px">Generated ${new Date().toISOString()} · ${rows.length} scenarios.</p>`;
}
