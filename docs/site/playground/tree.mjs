// Tree-view tab for the playground. Two panes side by side:
//   - left: indented tree, VS Code-style chevrons + dotted paths
//   - right: details for the currently selected item (path, title,
//            status, notes, action buttons)
//
// Selection (the row highlighted in the left pane) and "active" (the
// engine-level concept of the current item) are decoupled, mirroring
// the VS Code extension's behavior. Click a row to select; double-
// click (or hit "Make active" in the details pane) to actually
// `goto`. Per-row hover actions still fire immediately.

import { verbs } from '../../../engine/noggin-api.mjs';

// Inline SVG icons keep us out of icon-font / asset-bundling territory.
const SVG = {
  chevron: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5l5 4.5-5 4.5V3.5z"/></svg>',
  circle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="5.25"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8" cy="8" r="5.25"/><path d="M5.5 8.2l1.8 1.7L10.6 6.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.06 2.94a1.5 1.5 0 0 1 2.12 2.12L5.5 12.74l-3 .75.75-3 7.81-7.55z"/></svg>',
  note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M10 3v3h3"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 2h4l.5 1H13v1H3V3h2.5L6 2zm-2 3h8l-.75 8.5a1 1 0 0 1-1 .9h-4.5a1 1 0 0 1-1-.9L4 5z"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.6 1.5l4.9 4.9-1.9 1-1.6-.4-3 3 .5 2.7-1 1-2.6-2.6L1 14l3.4-3.9L1.7 7.4l1-1 2.7.5 3-3-.4-1.6 1.6-1.8z"/></svg>',
};

export function mountTree({ listRoot, detailsRoot, summaryEl, noggin }) {
  if (!listRoot || !detailsRoot) throw new Error('mountTree: panes required');
  if (!noggin) throw new Error('mountTree: noggin required');

  const collapsed = new Set();
  let selectedKey = null;

  function render() {
    const doc = noggin.snapshot();

    // Reset selection if the previously selected item is gone.
    if (selectedKey && !doc.items.find((it) => it.key === selectedKey)) {
      selectedKey = null;
    }
    // Default selection: the active item, or the first root.
    if (!selectedKey) {
      if (doc.active) selectedKey = doc.active;
      else if (doc.items.length) selectedKey = doc.items.find((it) => !it.parentKey)?.key || null;
    }

    renderList(doc);
    renderDetails(doc);
    renderSummary(doc);
  }

  function renderSummary(doc) {
    if (!summaryEl) return;
    if (!doc.items.length) { summaryEl.textContent = 'empty'; return; }
    const total = doc.items.length;
    const done = doc.items.filter((it) => it.done).length;
    summaryEl.textContent = `${total} item${total === 1 ? '' : 's'} · ${done} done`;
  }

  function renderList(doc) {
    listRoot.innerHTML = '';
    if (!doc.items.length) {
      const empty = document.createElement('div');
      empty.className = 'tv-empty';
      empty.innerHTML = 'No items yet.<br>Use <strong>+ New root item</strong> below, or load the sample data above.';
      listRoot.appendChild(empty);
      return;
    }
    const roots = doc.items.filter((it) => !it.parentKey);
    const ul = document.createElement('ul');
    ul.className = 'tv-tree';
    for (const r of roots) ul.appendChild(renderNode(doc, r, 0, ''));
    listRoot.appendChild(ul);
  }

  function renderNode(doc, item, depth, parentPath) {
    const siblings = doc.items.filter((it) => it.parentKey === item.parentKey);
    const idx = siblings.findIndex((s) => s.key === item.key);
    const ownSegment = String(idx + 1);
    const fullPath = parentPath ? `${parentPath}/${ownSegment}` : `/${ownSegment}`;
    const dotted = fullPath.slice(1).replace(/\//g, '.');

    const li = document.createElement('li');
    li.className = 'tv-node';
    if (item.key === doc.active) li.classList.add('tv-active');
    if (item.key === selectedKey) li.classList.add('tv-selected');
    if (item.done) li.classList.add('tv-done');

    const children = doc.items.filter((it) => it.parentKey === item.key);
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(item.key);

    const row = document.createElement('div');
    row.className = 'tv-row';
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    // Caret
    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'tv-caret' + (hasChildren ? (isCollapsed ? ' collapsed' : '') : ' leaf');
    caret.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
    caret.innerHTML = SVG.chevron;
    if (hasChildren) {
      caret.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (isCollapsed) collapsed.delete(item.key); else collapsed.add(item.key);
        render();
      });
    }
    row.appendChild(caret);

    // Dotted path (`1.2.3`)
    const pathEl = document.createElement('span');
    pathEl.className = 'tv-path';
    pathEl.textContent = dotted;
    row.appendChild(pathEl);

    // Status indicator
    const status = document.createElement('span');
    status.className = 'tv-status' + (item.done ? ' done' : '');
    status.innerHTML = item.done ? SVG.check : SVG.circle;
    status.title = item.done ? 'Done' : 'Open';
    row.appendChild(status);

    // Title + active pin + notes flag
    const titleWrap = document.createElement('span');
    titleWrap.className = 'tv-title-wrap';
    const title = document.createElement('span');
    title.className = 'tv-title';
    title.textContent = item.title;
    title.title = item.title;
    titleWrap.appendChild(title);
    if (item.key === doc.active) {
      const pin = document.createElement('span');
      pin.className = 'tv-active-pin';
      pin.innerHTML = SVG.pin;
      pin.title = 'Active';
      titleWrap.appendChild(pin);
    }
    if (item.notes && item.notes.length) {
      const flag = document.createElement('span');
      flag.className = 'tv-note-flag';
      flag.innerHTML = SVG.note;
      flag.title = `${item.notes.length} note${item.notes.length === 1 ? '' : 's'}`;
      titleWrap.appendChild(flag);
    }
    row.appendChild(titleWrap);

    // Hover actions
    const actions = document.createElement('span');
    actions.className = 'tv-actions';
    actions.append(
      iconBtn(SVG.plus, 'Add child', async () => {
        const t = prompt('Title for the new child:');
        if (!t || !t.trim()) return;
        await verbs.add(noggin, {
          title: t.trim(),
          placement: { kind: 'into', anchor: fullPath },
        });
        // Open the parent so the new child is visible.
        collapsed.delete(item.key);
      }),
      iconBtn(item.done ? SVG.circle : SVG.check, item.done ? 'Reopen' : 'Mark done', async () => {
        await verbs.edit(noggin, { path: fullPath, done: !item.done, closeAll: !item.done });
      }),
      iconBtn(SVG.pencil, 'Rename', async () => {
        const t = prompt('New title:', item.title);
        if (t == null || t.trim() === '' || t === item.title) return;
        await verbs.edit(noggin, { path: fullPath, title: t.trim() });
      }),
      iconBtn(SVG.note, 'Add note', async () => {
        const t = prompt(`Add a note to "${item.title}":`);
        if (!t || !t.trim()) return;
        await verbs.note(noggin, { path: fullPath, text: t.trim() });
      }),
      iconBtn(SVG.trash, 'Delete', async () => {
        const kids = doc.items.filter((it) => it.parentKey === item.key).length;
        const msg = kids
          ? `Delete "${item.title}" and its ${kids} descendant(s)?`
          : `Delete "${item.title}"?`;
        if (!confirm(msg)) return;
        await verbs.delete(noggin, { path: fullPath, recursive: kids > 0 });
      }),
    );
    row.appendChild(actions);

    // Row click → select; double-click → goto.
    row.addEventListener('click', () => {
      selectedKey = item.key;
      render();
    });
    row.addEventListener('dblclick', async () => {
      selectedKey = item.key;
      await verbs.goto(noggin, { path: fullPath });
    });

    li.appendChild(row);

    if (hasChildren && !isCollapsed) {
      const ul = document.createElement('ul');
      ul.className = 'tv-tree';
      for (const c of children) ul.appendChild(renderNode(doc, c, depth + 1, fullPath));
      li.appendChild(ul);
    }

    return li;
  }

  function renderDetails(doc) {
    detailsRoot.innerHTML = '';
    const item = selectedKey ? doc.items.find((it) => it.key === selectedKey) : null;

    if (!item) {
      const empty = document.createElement('div');
      empty.className = 'tv-details-empty';
      empty.textContent = doc.items.length
        ? 'Select an item in the tree to see its details.'
        : 'Nothing to show yet — add some items first.';
      detailsRoot.appendChild(empty);
      return;
    }

    const path = absolutePathOf(doc.items, item);
    const dotted = path.slice(1).replace(/\//g, '.');

    const wrap = document.createElement('div');
    wrap.className = 'tv-details';

    // Path
    const pathRow = document.createElement('div');
    pathRow.className = 'tv-details-pathrow';
    pathRow.textContent = dotted;
    wrap.appendChild(pathRow);

    // Title row + badges
    const titleRow = document.createElement('div');
    titleRow.className = 'tv-details-titlerow';
    const h2 = document.createElement('h2');
    h2.className = 'tv-details-title' + (item.done ? ' done' : '');
    h2.textContent = item.title;
    titleRow.appendChild(h2);
    wrap.appendChild(titleRow);

    const badges = document.createElement('div');
    badges.className = 'tv-details-badges';
    if (item.key === doc.active) {
      const b = document.createElement('span');
      b.className = 'tv-details-badge';
      b.innerHTML = `${SVG.pin} active`;
      badges.appendChild(b);
    }
    if (item.done) {
      const b = document.createElement('span');
      b.className = 'tv-details-badge done';
      b.innerHTML = `${SVG.check} done`;
      badges.appendChild(b);
    }
    if (badges.children.length) wrap.appendChild(badges);

    // Meta: created at, child count
    const childCount = doc.items.filter((it) => it.parentKey === item.key).length;
    const meta = document.createElement('div');
    meta.className = 'tv-details-meta';
    const created = formatTimestamp(item.createdAt);
    meta.textContent = `Created ${created} · ${childCount} child${childCount === 1 ? '' : 'ren'}`;
    wrap.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'tv-details-actions';
    if (item.key !== doc.active) {
      actions.appendChild(detailBtn('Make active', async () => { await verbs.goto(noggin, { path: path }); }, 'primary'));
    }
    actions.appendChild(detailBtn(item.done ? 'Reopen' : 'Mark done', async () => {
      await verbs.edit(noggin, { path, done: !item.done, closeAll: !item.done });
    }));
    actions.appendChild(detailBtn('Add child', async () => {
      const t = prompt('Title for the new child:');
      if (!t || !t.trim()) return;
      await verbs.add(noggin, { title: t.trim(), placement: { kind: 'into', anchor: path } });
      collapsed.delete(item.key);
    }));
    actions.appendChild(detailBtn('Add note', async () => {
      const t = prompt(`Add a note to "${item.title}":`);
      if (!t || !t.trim()) return;
      await verbs.note(noggin, { path, text: t.trim() });
    }));
    actions.appendChild(detailBtn('Rename', async () => {
      const t = prompt('New title:', item.title);
      if (t == null || t.trim() === '' || t === item.title) return;
      await verbs.edit(noggin, { path, title: t.trim() });
    }));
    actions.appendChild(detailBtn('Delete', async () => {
      const kids = doc.items.filter((it) => it.parentKey === item.key).length;
      const msg = kids
        ? `Delete "${item.title}" and its ${kids} descendant(s)?`
        : `Delete "${item.title}"?`;
      if (!confirm(msg)) return;
      await verbs.delete(noggin, { path, recursive: kids > 0 });
    }));
    wrap.appendChild(actions);

    // Notes (newest last for read order; mirror CLI behaviour)
    const notesHeader = document.createElement('h4');
    notesHeader.textContent = `Notes (${item.notes?.length || 0})`;
    wrap.appendChild(notesHeader);
    if (!item.notes || item.notes.length === 0) {
      const none = document.createElement('div');
      none.className = 'tv-details-no-notes';
      none.textContent = 'No notes yet.';
      wrap.appendChild(none);
    } else {
      const notesEl = document.createElement('div');
      notesEl.className = 'tv-details-notes';
      for (const note of item.notes) {
        const n = document.createElement('div');
        n.className = 'tv-details-note';
        const ts = document.createElement('div');
        ts.className = 'ts';
        ts.textContent = formatTimestamp(note.timestamp);
        const tx = document.createElement('div');
        tx.className = 'text';
        tx.textContent = note.text || '';
        n.append(ts, tx);
        notesEl.appendChild(n);
      }
      wrap.appendChild(notesEl);
    }

    detailsRoot.appendChild(wrap);
  }

  function iconBtn(svg, label, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tv-icon-btn';
    b.innerHTML = svg;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try { await handler(); }
      catch (e) { alert(`noggin: ${e && e.message ? e.message : e}`); }
    });
    return b;
  }

  function detailBtn(label, handler, variant) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg-btn' + (variant === 'primary' ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', async () => {
      try { await handler(); }
      catch (e) { alert(`noggin: ${e && e.message ? e.message : e}`); }
    });
    return b;
  }

  noggin.onDidChange(render);
  render();

  return {
    /** Programmatically select an item by key (used after `goto` from CLI). */
    selectKey(k) { selectedKey = k; render(); },
    render,
  };
}

// Build the canonical /1/2/3 path for an item by walking up parentKey
// and counting position within siblings (preserving items[] order).
function absolutePathOf(items, item) {
  const segs = [];
  let cur = item;
  while (cur) {
    const siblings = items.filter((it) => it.parentKey === cur.parentKey);
    const idx = siblings.findIndex((s) => s.key === cur.key);
    segs.unshift(String(idx + 1));
    cur = cur.parentKey ? items.find((it) => it.key === cur.parentKey) : null;
  }
  return '/' + segs.join('/');
}

// "2026-06-22T15:00:00.000Z" → "2026-06-22 15:00 UTC".
// Keep it terse and timezone-explicit; the playground runs in a
// browser where the user's locale might mislead about absolute time.
function formatTimestamp(ts) {
  if (!ts) return '(unknown)';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(ts);
  if (!m) return ts;
  return `${m[1]} ${m[2]} UTC`;
}
