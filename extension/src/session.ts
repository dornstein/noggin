// Tracks which noggin is currently open in this VS Code window.
//
// Provider-agnostic: `location` is an opaque string — either a URI
// (`file://…`, `vscode-todo://…`, `https://…`, `localstorage://…`,
// `memory://…`) or a bare filesystem path. The session doesn't
// interpret the scheme; downstream code (NogginHandle → openByLocation)
// routes the string to the right provider via the engine registry.
//
// Persisted in `context.workspaceState` so reopening the same VS
// Code window restores the same selection.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vscode from 'vscode';

/**
 * Persisted state key. Named after the file-only era; kept as-is so
 * upgrades don't lose the currently-open selection. The value can be
 * any location string, not just a file path.
 */
const STATE_KEY = 'noggin.openFile';
const EMPTY_SEED = 'schemaVersion: 1\nactive: null\nitems: []\n';

/** Matches a `<scheme>://` prefix — same regex the engine uses to
 *  detect URI-shaped locations. Bare paths (no scheme) fall through
 *  and are treated as filesystem paths. */
const URI_SCHEME_REGEX = /^([a-z][a-z0-9+.-]*):\/\//i;

export class NogginSession implements vscode.Disposable {
  private currentLocation: string | null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.currentLocation = context.workspaceState.get<string | null>(STATE_KEY, null);
    this.context.environmentVariableCollection.description =
      'Sets NOGGIN so the noggin CLI in this terminal targets the noggin you have open in VS Code.';
    this.publishEnv();
    this.publishContext();
  }

  dispose(): void { this.emitter.dispose(); }

  /**
   * The currently-selected location as-provided. Any URI or bare
   * filesystem path. `null` when nothing is open.
   */
  get location(): string | null { return this.currentLocation; }

  /**
   * The currently-selected location as a filesystem path — only
   * defined when the selection is file-shaped (bare path or a
   * `file://` URI). Returns null for any other scheme. Use this
   * from code that only makes sense for filesystem noggins (native
   * file dialogs, `.noggin.yaml` conventions). Everything else
   * should read `location` and let the engine route.
   */
  get file(): string | null {
    return this.currentLocation ? asFsPathOrNull(this.currentLocation) : null;
  }

  /** URI scheme of the current selection, lower-cased. `'file'` for
   *  bare paths (matches the engine's default). `null` when nothing
   *  is open. */
  get scheme(): string | null {
    if (!this.currentLocation) return null;
    const m = URI_SCHEME_REGEX.exec(this.currentLocation);
    return m ? m[1].toLowerCase() : 'file';
  }

  static workspaceNogginPath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return path.join(folders[0].uri.fsPath, '.noggin.yaml');
  }

  /**
   * Set the current selection to `location`. Accepts any URI or a
   * bare filesystem path; bare paths are `path.normalize`d for
   * cosmetic consistency, URIs are stored verbatim.
   */
  async open(location: string): Promise<void> {
    const stored = isUri(location) ? location : path.normalize(location);
    this.currentLocation = stored;
    await this.context.workspaceState.update(STATE_KEY, stored);
    this.publishEnv();
    this.publishContext();
    this.emitter.fire();
  }

  /**
   * Create a new file-backed noggin at `fsPath` (seeding an empty
   * YAML document if the file doesn't exist) and select it. Only
   * meaningful for file locations — other providers manage their
   * own creation flow via the ui-side provider registry.
   */
  async create(fsPath: string): Promise<void> {
    const normalized = path.normalize(fsPath);
    if (!fs.existsSync(normalized)) {
      const dir = path.dirname(normalized);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(normalized, EMPTY_SEED, 'utf8');
    }
    await this.open(normalized);
  }

  async close(): Promise<void> {
    this.currentLocation = null;
    await this.context.workspaceState.update(STATE_KEY, undefined);
    this.publishEnv();
    this.publishContext();
    this.emitter.fire();
  }

  private publishEnv(): void {
    const coll = this.context.environmentVariableCollection;
    if (this.currentLocation) {
      // Publish the location verbatim, whatever the scheme. The CLI
      // (and MCP server) route through the same engine provider
      // registry as the extension host; if a scheme is unsupported
      // the CLI will surface a clean `no-provider` error rather
      // than silently working on a stale/wrong noggin.
      coll.replace('NOGGIN', this.currentLocation);
    } else {
      coll.delete('NOGGIN');
    }
  }

  private publishContext(): void {
    // `noggin.fileOpen` reads as "some noggin is open in this
    // window". The name is a historical relic from when only files
    // were supported; menus / when-clauses reference it so we keep
    // the key stable rather than churn the manifest.
    vscode.commands.executeCommand('setContext', 'noggin.fileOpen', !!this.currentLocation);
    vscode.commands.executeCommand('setContext', 'noggin.scheme', this.scheme);
    vscode.commands.executeCommand(
      'setContext',
      'noggin.workspaceOpen',
      !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length),
    );
  }
}

/** Match `<scheme>://` at the start of a location. */
export function isUri(location: string): boolean {
  return URI_SCHEME_REGEX.test(location);
}

/**
 * If `location` is file-shaped (bare fs path or a `file://` URI),
 * return its filesystem path. Returns null for any other scheme.
 * Exported so file-only callers (native dialogs, terminal env,
 * `.noggin.yaml` conventions) can guard cleanly.
 */
export function asFsPathOrNull(location: string): string | null {
  if (!isUri(location)) return location;
  if (location.toLowerCase().startsWith('file://')) {
    try { return fileURLToPath(location); }
    catch { return null; }
  }
  return null;
}

/**
 * Wrap `location` as a canonical URI. Bare paths become `file://`
 * URIs; existing URIs pass through unchanged. Used by any surface
 * that hands a location off to a URI-only consumer (the webview,
 * primarily).
 */
export function toUri(location: string): string {
  if (isUri(location)) return location;
  return pathToFileURL(location).href;
}
