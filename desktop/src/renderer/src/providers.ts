// Desktop-side provider catalog — the seed for the
// `@noggin/ui` provider-type registry.
//
// The catalog itself (label, badge, icon, scheme) lives in the
// registry; this module's job is to provide the *pickers* that
// drive the `+` menu, because pickers need access to renderer
// affordances (native file dialogs, text prompts, openNoggin) that
// only the host has.
//
// Usage:
//
//   const providers = useMemo(
//     () => createNogginProviderRegistry(
//       buildDesktopProviderTypes({ pickFile, pickNewFile, prompter, openNoggin, ... }),
//     ),
//     [prompter, openNoggin, ...],
//   );

import { defaultNogginProviders, type NogginProviderType } from '@noggin/ui';

/**
 * Host-supplied bridges every desktop picker needs. Built once in
 * App.tsx; passed into `buildDesktopProviderTypes(ctx)` to produce
 * a fully-wired catalog the registry can be seeded with.
 */
export interface DesktopProviderContext {
  /** Run a provider's "open" flow for `scheme` (host-driven native
   *  dialog). Returns a canonical location, or null on cancel. */
  providerOpen: (scheme: string) => Promise<string | null>;
  /** Run a provider's "create" flow for `scheme` (host-driven save
   *  dialog + seed). Returns a canonical location, or null on cancel. */
  providerCreate: (scheme: string) => Promise<string | null>;
  /** Prompt the user for free-form text via a renderer-local modal. */
  promptText: (opts: {
    title?: string;
    prompt?: string;
    placeholder?: string;
    confirmLabel?: string;
  }) => Promise<string | null>;
  /** Open the noggin at `location`. Hosts wrap engine errors via
   *  their own toast / error handling — `openNoggin` should NOT
   *  throw for routine errors. */
  openNoggin: (location: string) => Promise<void>;
  /** Show an error to the user. Used for picker-side failures
   *  (cancelled dialog, validation, etc.). */
  showError: (message: string) => void;
}

/**
 * Build the seeded list of provider descriptors used by the
 * desktop renderer. Pickers are bound here; the descriptor labels
 * / badges / icons come from `defaultNogginProviders`.
 *
 * Returns the same descriptors as `defaultNogginProviders`, but
 * with `pickers` filled in for `file` and `https`. The `memory`
 * entry retains its empty `pickers` array (memory noggins are not
 * user-creatable from the `+` menu).
 *
 * Each picker's `onSelect` resolves to a location URL, then hands
 * it to `ctx.openNoggin`. Picker-side errors (cancelled dialog,
 * invalid URL) are surfaced via `ctx.showError`; engine-side
 * errors (file missing, bad YAML) are the host's job inside
 * `openNoggin`.
 */
export function buildDesktopProviderTypes(ctx: DesktopProviderContext): readonly NogginProviderType[] {
  const wrapOpen = async (location: string | null): Promise<void> => {
    if (!location) return;
    try {
      await ctx.openNoggin(location);
    } catch (err) {
      ctx.showError(err instanceof Error ? err.message : String(err));
    }
  };

  return defaultNogginProviders.map((p): NogginProviderType => {
    if (p.scheme === 'file') {
      return {
        ...p,
        pickers: [
          {
            id: 'file:open',
            label: 'Open existing YAML…',
            icon: 'folder-opened',
            mode: 'open',
            async onSelect() {
              await wrapOpen(await ctx.providerOpen('file://'));
            },
          },
          {
            id: 'file:new',
            label: 'New blank YAML…',
            icon: 'new-file',
            mode: 'new',
            async onSelect() {
              await wrapOpen(await ctx.providerCreate('file://'));
            },
          },
        ],
      };
    }
    if (p.scheme === 'https') {
      return {
        ...p,
        pickers: [
          {
            id: 'https:open-url',
            label: 'Open from URL…',
            icon: 'link',
            hint: 'Paste a URL that serves YAML',
            mode: 'open',
            async onSelect() {
              const v = await ctx.promptText({
                title: 'Open noggin from URL',
                prompt: 'Paste a URL to a noggin YAML file.',
                placeholder: 'https://example.com/path/to/noggin.yaml',
                confirmLabel: 'Open',
              });
              if (!v) return;
              const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
              await wrapOpen(withScheme);
            },
          },
        ],
      };
    }
    return p;
  });
}

/**
 * Convenience helper: find a picker by its id across the catalog.
 * Used by the legacy "File → New" / "File → Open" menu items in
 * `App.tsx` so the catalog stays the single source of truth.
 */
export function findPickerById(
  types: readonly NogginProviderType[],
  id: string,
): { provider: NogginProviderType; picker: NogginProviderType['pickers'] extends readonly (infer P)[] | undefined ? P : never } | null {
  for (const t of types) {
    for (const p of t.pickers ?? []) {
      if (p.id === id) return { provider: t, picker: p as never };
    }
  }
  return null;
}
