// Playground state — the shared list controller + provider registry
// + lazy noggin cache that ties the CLI tab, the Tree tab, and the
// NogginList rail together.
//
// The model:
//   - One `NogginListStore` owns the entries the user sees in the
//     left rail and the URI of the currently-selected one.
//   - One `NogginRegistry` (this file's own term — distinct from the
//     engine's provider scheme registry) lazily constructs and caches
//     the live `LocalStorageNoggin` for each entry. The CLI and Tree
//     tabs ask the registry for the noggin matching the current URI.
//   - Both tabs subscribe to `store.onDidChange` so a selection change
//     updates them in lock-step.
//
// Persistence:
//   - Entries: `noggin:playground:list:v1`
//   - Prefs:   `noggin:playground:list-prefs:v1`
//   - MRU:     `noggin:playground:mru:v1`
//
// First-run: the list starts with a single seed entry pointing at
// `localstorage://playground` so a first-time visitor lands on a
// working noggin instead of an empty rail.

import {
  createMRUManager,
  createNogginListStore,
  createNogginProviderRegistry,
  defaultNogginListPrefs,
  defaultNogginProviders,
} from '@noggin/ui';
import {
  LocalStorageNoggin,
  DEFAULT_STORAGE_SLOT,
  localStorageKeyFor,
} from '../../../engine/providers/localstorage.mjs';

const ENTRIES_KEY = 'noggin:playground:list:v1';
const PREFS_KEY = 'noggin:playground:list-prefs:v1';
const MRU_KEY = 'noggin:playground:mru:v1';
// The seed slot a first-time visitor lands on.
const SEED_SLOT = DEFAULT_STORAGE_SLOT; // 'playground'

/**
 * Load the initial entries list. First-time visitors get a single
 * seed entry pointing at the default `playground` slot.
 */
function loadEntries() {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        return data.filter((e) => e && typeof e.uri === 'string');
      }
    }
  } catch { /* fall through to seed */ }
  return [{
    uri: `localstorage://${SEED_SLOT}`,
    label: SEED_SLOT,
  }];
}

function saveEntries(entries) {
  try { localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries.slice(0, 50))); }
  catch { /* quota / private-mode — silently absorb */ }
}

function loadMRU() {
  try {
    const raw = localStorage.getItem(MRU_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    /** @type {Record<string,string>} */
    const out = {};
    for (const [uri, ts] of Object.entries(data)) {
      if (typeof uri === 'string' && uri && typeof ts === 'string') out[uri] = ts;
    }
    return out;
  } catch { return {}; }
}

function saveMRU(entries) {
  try { localStorage.setItem(MRU_KEY, JSON.stringify(entries)); }
  catch { /* ignore */ }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { ...defaultNogginListPrefs, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...defaultNogginListPrefs }; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
  catch { /* ignore */ }
}

/**
 * Build the playground catalog. Only `localstorage://` gets a
 * picker — the only kind of noggin you can usefully create from
 * inside a browser playground. We add an extra picker (`new`) that
 * prompts for a slug and inserts a new entry; the registry handles
 * the actual `LocalStorageNoggin` construction lazily on first use.
 */
function buildProviderTypes(store) {
  return defaultNogginProviders.map((p) => {
    if (p.scheme !== 'localstorage') return p;
    return {
      ...p,
      pickers: [
        {
          id: 'localstorage:new',
          label: 'New scratch noggin…',
          icon: 'add',
          hint: 'Saved in this browser\'s localStorage',
          async onSelect() {
            // Use an in-page modal — window.prompt() is disabled in
            // some embedded browser contexts (VS Code's webview,
            // certain sandboxed iframes).
            const slug = await promptForSlug(suggestNewSlug(store));
            if (!slug) return;
            const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
            if (!normalized) return;
            const uri = `localstorage://${normalized}`;
            store.add(uri, { label: normalized });
            store.setSelectedIds([uri]);
          },
        },
      ],
    };
  });
}

/**
 * Display a small modal asking the user for a slug. Returns the
 * entered string, or null if the user cancelled. Uses the native
 * `<dialog>` element so we don't need a portal / overlay layer.
 */
function promptForSlug(defaultValue) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pg-slug-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pg-slug-form">
        <label class="pg-slug-label">
          Name for the new noggin
          <span class="pg-slug-hint">lower-case, no spaces — used as the localStorage slot</span>
        </label>
        <input type="text" class="pg-slug-input" autocomplete="off" spellcheck="false" />
        <div class="pg-slug-actions">
          <button type="button" class="pg-btn" data-action="cancel">Cancel</button>
          <button type="submit" class="pg-btn primary" data-action="ok">Create</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const input = /** @type {HTMLInputElement} */ (dialog.querySelector('.pg-slug-input'));
    const cancelBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-action="cancel"]'));
    const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
    input.value = defaultValue ?? '';

    let done = false;
    const settle = (value) => {
      if (done) return;
      done = true;
      try { dialog.close(); } catch { /* ignore */ }
      dialog.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => settle(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      settle(input.value);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      settle(null);
    });
    // Backdrop click (anywhere outside the form) = cancel.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) settle(null);
    });

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      // Very old browsers without <dialog> support: fall back to
      // making the element visible. Realistically every browser we
      // ship to has it (Chrome 37+, Safari 15.4+, Firefox 98+).
      dialog.setAttribute('open', '');
    }
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

/**
 * Confirm modal — drop-in replacement for `window.confirm`, used by
 * the playground because the native API is disabled in some
 * embedded browser contexts (VS Code's webview). Returns true if
 * the user confirmed, false on cancel / dismiss.
 *
 * @public
 */
export function playgroundConfirm(message, {
  title = 'Confirm',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
} = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'pg-slug-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pg-slug-form">
        <div class="pg-slug-label">${escHtml(title)}</div>
        <div class="pg-confirm-message"></div>
        <div class="pg-slug-actions">
          <button type="button" class="pg-btn" data-action="cancel"></button>
          <button type="submit" class="pg-btn ${destructive ? 'danger' : 'primary'}" data-action="ok"></button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    /** @type {HTMLElement} */
    const messageEl = dialog.querySelector('.pg-confirm-message');
    messageEl.textContent = message;
    /** @type {HTMLButtonElement} */
    const cancelBtn = dialog.querySelector('[data-action="cancel"]');
    cancelBtn.textContent = cancelLabel;
    /** @type {HTMLButtonElement} */
    const okBtn = dialog.querySelector('[data-action="ok"]');
    okBtn.textContent = confirmLabel;

    let done = false;
    const settle = (value) => {
      if (done) return;
      done = true;
      try { dialog.close(); } catch { /* ignore */ }
      dialog.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => settle(false));
    /** @type {HTMLFormElement} */
    const form = dialog.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); settle(true); });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); settle(false); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) settle(false); });

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    requestAnimationFrame(() => okBtn.focus());
  });
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function suggestNewSlug(store) {
  for (let i = 1; i < 100; i++) {
    const slug = `scratch-${i}`;
    if (!store.entries.some((e) => e.uri === `localstorage://${slug}`)) return slug;
  }
  return 'scratch';
}

/**
 * Lazy noggin cache. Hands out a `LocalStorageNoggin` per URI and
 * keeps one instance per URI alive for the page's lifetime. The
 * `LocalStorageNoggin` is cheap (it's just a frozen-doc view over a
 * localStorage key) so we don't bother evicting.
 *
 * Also wires each freshly-constructed noggin into `store.observe()`
 * so its item counts + active item land in the list row.
 */
function createNogginRegistry(store) {
  const cache = new Map(); // uri -> noggin
  const observed = new Map(); // uri -> dispose

  return {
    /** Return (and lazily construct) the noggin for `uri`. */
    get(uri) {
      if (cache.has(uri)) return cache.get(uri);
      const slot = parseLocalStorageSlot(uri);
      const noggin = new LocalStorageNoggin(slot, globalThis.localStorage, {});
      cache.set(uri, noggin);
      // Bridge into the store so the list row's gauge + active hints
      // stay current. Disposes never run — we keep both alive for the
      // page's life.
      const sub = store.observe(uri, noggin);
      observed.set(uri, sub.dispose);
      return noggin;
    },
    /** Remove an entry: dispose its observation + noggin. */
    forget(uri) {
      const dispose = observed.get(uri);
      if (dispose) { try { dispose(); } catch { /* ignore */ } }
      observed.delete(uri);
      const noggin = cache.get(uri);
      if (noggin) { try { void noggin.dispose(); } catch { /* ignore */ } }
      cache.delete(uri);
    },
    /** Drop the underlying storage too (e.g. on "remove"). */
    purge(uri) {
      this.forget(uri);
      try { localStorage.removeItem(localStorageKeyFor(uri)); } catch { /* ignore */ }
    },
  };
}

function parseLocalStorageSlot(uri) {
  const m = /^localstorage:(?:\/\/)?(.+)$/i.exec(uri);
  return m ? m[1] : uri;
}

/**
 * Top-level factory used by main.mjs. Returns everything the CLI tab
 * and the Tree tab need to render and stay in sync.
 *
 * The single source of truth is `store.selectedIds[0]`. Callers use
 * `currentUri()` to read it, `setCurrentUri(uri)` to write it, and
 * `onChange(cb)` to react to either-side changes.
 */
export function createPlaygroundState() {
  // MRU is constructed first so the store can route activity into
  // it via `onUriActivity`.
  const mru = createMRUManager({
    initial: loadMRU(),
    onStateChange: ({ entries }) => saveMRU(entries),
  });

  const store = createNogginListStore({
    initialEntries: loadEntries(),
    onStateChange: ({ entries }) => saveEntries(entries),
    onUriActivity: (uri) => mru.touch(uri),
  });

  // Initial selection: prefer the MRU's most-recent entry that is
  // still in the list; otherwise the first one. Hosts that want a
  // different starting point can call setCurrentUri immediately
  // after construction.
  if (store.selectedIds.length === 0 && store.entries.length > 0) {
    const uriSet = new Set(store.entries.map((e) => e.uri));
    const firstKnownMRU = mru.entries().find((u) => uriSet.has(u));
    store.setSelectedIds([firstKnownMRU ?? store.entries[0].uri]);
  }

  let prefs = loadPrefs();
  const prefsListeners = new Set();
  const setPrefs = (next) => {
    prefs = next;
    savePrefs(prefs);
    for (const cb of [...prefsListeners]) { try { cb(prefs); } catch { /* ignore */ } }
  };

  const providers = createNogginProviderRegistry(buildProviderTypes(store));
  const registry = createNogginRegistry(store);

  // Wrap `store.remove` so removing a row also purges its
  // localStorage slot (the user expectation is "this noggin is
  // gone", not "the row is gone but the data is still consuming
  // quota"). Same wrap for the row drag-to-delete path that the
  // component might add later.
  const baseRemove = store.remove.bind(store);
  store.remove = (uri) => {
    registry.purge(uri);
    baseRemove(uri);
    // After removal, pick a new selection so both tabs land somewhere.
    if (store.selectedIds.length === 0 && store.entries.length > 0) {
      store.setSelectedIds([store.entries[0].uri]);
    }
  };

  return {
    store,
    providers,
    mru,
    get prefs() { return prefs; },
    setPrefs,
    onPrefsChange(cb) {
      prefsListeners.add(cb);
      return { dispose: () => prefsListeners.delete(cb) };
    },
    /** Get the current URI (or null if nothing selected). */
    currentUri() {
      return store.selectedIds[0] ?? null;
    },
    /** Get (lazy-construct) the live noggin for the current URI. */
    currentNoggin() {
      const uri = this.currentUri();
      return uri ? registry.get(uri) : null;
    },
    /** Get the noggin for a specific URI. */
    nogginFor(uri) {
      return registry.get(uri);
    },
    /** Set the current URI (drives both tabs). */
    setCurrentUri(uri) {
      // Note: no explicit mru.touch() here. Activity is unified on
      // actual noggin state changes via store.onUriActivity, so
      // simply picking a noggin does not shift its MRU stamp.
      store.add(uri, { label: store.entries.find((e) => e.uri === uri)?.label });
      store.setSelectedIds([uri]);
      // Providers keep their in-memory doc in sync with backing
      // storage automatically. For localStorage that's the DOM
      // `storage` event (cross-tab) plus a periodic same-tab drift
      // poll; peers that mutated the slot out-of-band converge
      // within one poll interval without any nudge from here.
    },
    /** Subscribe to changes (selection or entries). */
    onChange(cb) {
      return store.onDidChange(cb);
    },
    /** Convenience for the row label used in the prompt. */
    labelFor(uri) {
      if (!uri) return null;
      const entry = store.entries.find((e) => e.uri === uri);
      return entry?.label || parseLocalStorageSlot(uri) || uri;
    },
  };
}
