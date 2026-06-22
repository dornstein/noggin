// A 13-item, three-level fixture used by "Load sample data" on the
// playground page. Mirrors the look of a real working-memory tree
// in mid-flight: a couple of feature branches, things partially
// done, a few notes on the active subtree.

const TS = '2026-06-22T15:00:00.000Z';

let counter = 0;
function key() {
  counter += 1;
  return `i-20260622-150000-${String(counter).padStart(6, '0')}`;
}

// Build the doc by walking a nested spec. `done` and `notes` are
// optional on every node. `active` flags the one item that should be
// active when the sample lands.
function build(spec) {
  counter = 0;
  const items = [];
  let activeKey = null;
  function walk(parentKey, kids) {
    for (const kid of kids) {
      const k = key();
      const notes = (kid.notes || []).map((text) => ({ timestamp: TS, text }));
      if (kid.done && kid.notes === undefined) {
        notes.push({ timestamp: TS, text: 'closed' });
      }
      items.push({
        key: k,
        parentKey,
        title: kid.title,
        done: Boolean(kid.done),
        createdAt: TS,
        notes,
      });
      if (kid.active) activeKey = k;
      if (kid.children) walk(k, kid.children);
    }
  }
  walk(null, spec);
  return { schemaVersion: 1, active: activeKey, items };
}

export const SAMPLE_DOC = build([
  {
    title: 'Ship the new search feature',
    children: [
      {
        title: 'Spec the query syntax',
        done: true,
      },
      {
        title: 'Implement the backend',
        children: [
          { title: 'Set up the index', done: true },
          {
            title: 'Wire up the query parser',
            active: true,
            notes: [
              'Tried fuzzy matching — too slow at 50k docs.',
              'Falling back to prefix + trigram hybrid.',
            ],
          },
          { title: 'Add result ranking' },
        ],
      },
      {
        title: 'Polish the UI',
        children: [
          { title: 'Keyboard shortcuts' },
          { title: 'Empty-state copy' },
        ],
      },
    ],
  },
  {
    title: 'Quarterly planning',
    children: [
      { title: 'Draft team OKRs', done: true },
      { title: 'Review with leadership', notes: ['scheduled for Thursday'] },
    ],
  },
  {
    title: 'Fix the flaky test on Windows',
    notes: ['Repros locally about 1/10 runs. Probably a path-separator issue.'],
  },
]);
