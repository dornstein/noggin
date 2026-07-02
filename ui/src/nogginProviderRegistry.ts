// Provider-type registry — the renderer-side catalog of noggin
// provider descriptors (label, badge, icon, pickers, read-only).
//
// Stands alone because three pieces of UI consume it:
//   - NogginList renders the badge + drives the `+` menu.
//   - The Help → Installed Providers dialog enumerates registered
//     types.
//   - A future "configure providers" page (and extension-contributed
//     provider types) plug in via `register()`.
//
// The reader interface is intentionally narrow so consumers that
// don't mutate stay decoupled from the wider mutable surface.

/**
 * @public
 * One picker entry in a provider's `+` menu. `onSelect` is invoked
 * when the user clicks it; what it does (opens a file dialog,
 * prompts for a URL, etc.) is fully up to the host.
 *
 * The component never inspects `id`/`icon`/`hint` beyond passing
 * them through to the menu chrome.
 */
export interface NogginProviderPicker {
  readonly id: string;
  readonly label: string;
  /** Codicon name. */
  readonly icon: string;
  /** Optional hint shown under the label in the menu. */
  readonly hint?: string;
  /** Which side of the open/new dialog this picker belongs to.
   *  Consumers that split the two experiences (e.g. `NogginOpenDialog`
   *  in the desktop host) use this to filter. Undefined means the
   *  picker shows in every mode — safe fallback for hosts that don't
   *  distinguish. */
  readonly mode?: 'open' | 'new';
  /** Fire the picker. May be sync or async; the menu closes
   *  optimistically when the user clicks. */
  onSelect(): void | Promise<void>;
}

/**
 * @public
 * Descriptor for one noggin provider type. The list component
 * matches an entry's URI scheme against `scheme` (with an alias
 * map maintained internally for common pairs like `http`/`https`)
 * to find the descriptor that drives badge + icon rendering.
 */
export interface NogginProviderType {
  /** URI scheme the provider handles. `'file'`, `'https'`, etc.
   *  This is also the string rendered in the row badge (uppercased). */
  readonly scheme: string;
  readonly label: string;
  readonly badgeTone: 'neutral' | 'accent' | 'muted' | 'warning';
  /** Codicon name. */
  readonly icon: string;
  /** Pickers offered in the `+` menu. Empty (or absent) = this
   *  provider doesn't appear in the menu. */
  readonly pickers?: readonly NogginProviderPicker[];
  /** When true, the provider is read-only at the source. The badge
   *  renders with a "read-only" affordance and hosts can pre-emptively
   *  hide mutation UI. */
  readonly readOnly?: boolean;
  /** Optional list of additional schemes that should resolve to the
   *  same descriptor (e.g. `'http'` resolves to the `'https'`
   *  descriptor). Used by `get()` / `forUri()`. */
  readonly aliases?: readonly string[];
}

/**
 * @public
 * Read-only view of the registry. NogginList, the Providers Info
 * dialog, and anything else that only consumes types takes this
 * narrower interface so they don't gain accidental mutation power.
 */
export interface NogginProviderTypeReader {
  /** Catalog snapshot in registration order. */
  readonly types: readonly NogginProviderType[];
  /** Resolve a provider by URI scheme. Returns null for unknown. */
  get(scheme: string): NogginProviderType | null;
  /** Resolve the provider for a full URI (extracts the scheme,
   *  defaults to `'file'` for bare paths). Returns null when no
   *  descriptor matches. */
  forUri(uri: string): NogginProviderType | null;
  /** Fired after any registration / disposal. */
  onDidChange(cb: () => void): { dispose: () => void };
}

/**
 * @public
 * Mutable side of the registry. Hosts that allow runtime
 * registration (extension contributions, dynamic provider loading)
 * use this; everything else should take the read-only reader.
 */
export interface NogginProviderTypeRegistry extends NogginProviderTypeReader {
  /**
   * Register a new provider descriptor. Duplicate `scheme` throws.
   * The returned `dispose()` removes the registration and fires
   * `onDidChange`.
   */
  register(type: NogginProviderType): { dispose: () => void };
}

/**
 * @public
 * Factory. Seed with the host's static catalog; further
 * registrations are optional.
 */
export function createNogginProviderRegistry(
  seed?: readonly NogginProviderType[],
): NogginProviderTypeRegistry {
  const types: NogginProviderType[] = [];
  const listeners = new Set<() => void>();

  const fire = (): void => {
    for (const cb of [...listeners]) cb();
  };

  const schemeFor = (uri: string): string => {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(uri);
    return m ? m[1].toLowerCase() : 'file';
  };

  const get = (scheme: string): NogginProviderType | null => {
    const s = scheme.toLowerCase();
    for (const t of types) {
      if (t.scheme.toLowerCase() === s) return t;
      if (t.aliases?.some((a) => a.toLowerCase() === s)) return t;
    }
    return null;
  };

  const register = (type: NogginProviderType): { dispose: () => void } => {
    const s = type.scheme.toLowerCase();
    if (types.some((t) => t.scheme.toLowerCase() === s)) {
      throw new Error(`nogginProviderRegistry: scheme "${type.scheme}" already registered`);
    }
    types.push(type);
    fire();
    return {
      dispose: () => {
        const idx = types.findIndex((t) => t.scheme.toLowerCase() === s);
        if (idx >= 0) {
          types.splice(idx, 1);
          fire();
        }
      },
    };
  };

  if (seed) {
    for (const t of seed) register(t);
  }

  return {
    get types(): readonly NogginProviderType[] { return types; },
    get,
    forUri(uri: string): NogginProviderType | null {
      return get(schemeFor(uri));
    },
    onDidChange(cb: () => void): { dispose: () => void } {
      listeners.add(cb);
      return { dispose: () => { listeners.delete(cb); } };
    },
    register,
  };
}

/**
 * @public
 * Default catalog descriptors for the three providers bundled with
 * `@noggin/engine` (`file`, `https`/`http`, `memory`). Hosts call
 * `createNogginProviderRegistry(defaultNogginProviders)` to seed
 * the standard set.
 *
 * This is metadata only — labels, badges, icons. No engine code
 * is imported, so this constant is safe to land in browser-only
 * bundle graphs.
 *
 * Pickers default to empty here: hosts plug their own pickers in
 * after construction (because pickers need host-supplied bridges
 * to native file dialogs, prompts, etc.). The `MEMORY` descriptor
 * has no pickers in any host and stays that way.
 */
export const defaultNogginProviders: readonly NogginProviderType[] = [
  {
    scheme: 'file',
    label: 'YAML file',
    badgeTone: 'neutral',
    icon: 'file',
  },
  {
    scheme: 'https',
    aliases: ['http'],
    label: 'Public URL (read-only)',
    badgeTone: 'accent',
    icon: 'globe',
    readOnly: true,
  },
  {
    scheme: 'localstorage',
    label: 'Browser (localStorage)',
    badgeTone: 'accent',
    icon: 'database',
  },
  {
    scheme: 'memory',
    label: 'In-memory (scratch)',
    badgeTone: 'muted',
    icon: 'symbol-event',
  },
];
