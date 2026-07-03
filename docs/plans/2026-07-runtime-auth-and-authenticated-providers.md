---
title: Runtime auth broker + authenticated providers
status: proposed
date: 2026-07-02
---

# Runtime auth broker + authenticated providers — design doc

## Why now

Every noggin provider so far talks to something that doesn't require
runtime user credentials: the local filesystem (`file://`), memory
(`memory://`), or a public URL (`http(s)://`, read-only). The moment
we imagine a provider backed by a service the user has an account
with — OneDrive, GitHub Issues, Notion, Jira, Google Drive, Azure
DevOps, Home Assistant, an on-prem GitLab, an S3 bucket — three
things stop being handwavable:

1. **Signing the user in** without turning every provider into its
   own OAuth stack.
2. **Storing tokens safely** across launches without shipping a
   native keychain dep.
3. **Refreshing tokens transparently** so provider verbs never
   fight expired credentials mid-operation.

Doing this ad hoc — one provider does device flow, another does
loopback PKCE, a third rolls its own token cache — gives us N
inconsistent auth surfaces the user has to learn, N different
places tokens leak from, and N different pieces of code that
handle mid-session re-auth prompts differently. The desktop app is
also the wrong shape for browser-style OAuth (no persistent HTTPS
callback URL, aggressive corporate proxies, TLS interception,
protocol-handler quirks), and we need to make good choices *once*.

This plan proposes a **single auth broker + credential store** in
the main process, a small IPC surface for the renderer to trigger
sign-ins, and a plug-in "sign-in strategy" registry that individual
authenticated providers slot into.

## Scope

**In scope**

- Where credentials live on disk and how they're encrypted.
- Which sign-in flows we support and how a provider picks one.
- How a provider asks the broker for a token in the hot path.
- How multi-account setups (personal + work Google, two Notion
  workspaces) are addressed.
- What the renderer sees.

**Out of scope**

- Any specific authenticated provider's implementation. That's a
  follow-up per service.
- Release-time / CI auth (GITHUB_TOKEN in the workflow, npm
  Trusted Publishing OIDC, VSCE PAT). Those are unrelated to
  runtime user auth even though the word "auth" collides.
- Full offline write-queue design. Read cache is essentially free
  for file-shaped providers (the local YAML), but "queue writes
  while offline and drain when the token is back" is its own
  problem and defers.

## Non-goals

- **Enterprise SSO front-doors.** We don't want to be an OAuth
  proxy for third parties, an Okta client, or a MFA-challenge
  handler in our own UI. We hand off to the OS browser / OS
  broker for everything sign-in-shaped.
- **Auth SDK for arbitrary services.** The broker exposes primitive
  flows (device code, PKCE-loopback, PAT paste, OS-broker) — it
  isn't a wrapper around every third-party's SDK.
- **Shared-workspace multi-user credential sharing.** One user's
  credentials, one machine. Cross-machine sync is out.

## The landscape (why the design has the shape it does)

Authenticated backends fall into families that need different flows:

| Family | Examples | Practical flow(s) |
|---|---|---|
| Cloud files | OneDrive/SharePoint, Google Drive, Dropbox, S3, GCS, Azure Blob | OAuth (PKCE + loopback OR device code) for user-context; SigV4 / SAS for keyed access |
| Issue trackers | GitHub, GitLab, Azure DevOps Boards, Jira, Linear, Asana | Device code where supported, PAT paste as fallback, OAuth otherwise |
| Wikis / notes | Notion, OneNote, Confluence, Coda | Personal integration tokens (fastest) or OAuth |
| Chat as source | Slack saved items, Teams tasks, Discord | OAuth with app registration |
| Self-hosted | Gitea, Forgejo, self-hosted GitLab / Jira, Home Assistant | Bearer tokens (paste) — most self-hosted APIs disable OAuth |
| Local daemons | Ollama, LM Studio, LocalAI | Bearer token on `http://localhost:<port>` |
| Enterprise / on-prem | SharePoint on-prem, corporate REST | Kerberos, NTLM, mTLS |

Reading down that list, six auth *mechanisms* cover everything:

1. **OAuth 2.0 authorization code + PKCE with a loopback redirect
   URI** (`http://127.0.0.1:<random>`). MSAL, google-auth-library,
   and plain `fetch` all support it. Fragile against locked-down
   networks that block ephemeral loopback ports.
2. **Device authorization grant (RFC 8628).** GitHub, Google,
   Microsoft, HuggingFace, Anthropic — all speak it. Best UX for
   desktop and headless: user visits a URL, types a code. Should
   be the default when supported.
3. **OS-native brokers.** WAM on Windows (Entra), `ASWebAuthenticationSession`
   on macOS. Slick SSO when they work; mediocre-to-flaky elsewhere.
   Layer on top of PKCE for services that expose them.
4. **Personal access tokens (paste-your-own).** Universal
   fallback. Works for services whose desktop OAuth story is bad
   (Notion "internal integrations"), as an escape hatch when
   corporate IT blocks OAuth, and for self-hosted APIs.
5. **Passkeys / WebAuthn.** Increasingly a first-class option for
   Google/Apple/Microsoft accounts. Requires a browser handoff.
6. **Non-OAuth transports.** AWS SigV4, Azure SAS/Entra, NTLM,
   Kerberos, mTLS. Each has its own credential model — SigV4
   wants access keys, mTLS wants a cert + key pair.

Any real broker treats "sign-in strategy" as a plug-in, not a
single flow. That's the core of the design below.

## Design

### High-level shape

```
┌─────────────────── main process ────────────────────┐
│                                                     │
│   ┌── AuthBroker ─────────────────────────────┐     │
│   │  strategies: { device, pkce-loopback,    │     │
│   │                pat, os-broker, … }        │     │
│   │  cache: in-memory access tokens           │     │
│   └───┬───────────────────────────────────────┘     │
│       │                                             │
│       ▼                                             │
│   ┌── CredentialStore ────────────────────────┐     │
│   │  safeStorage-encrypted JSON file at       │     │
│   │  app.getPath('userData')/credentials.json │     │
│   │  key = (service, accountId)                │     │
│   └────────────────────────────────────────────┘     │
│                                                     │
│   Providers ──── broker.getToken({ service,        │
│                                     accountId,      │
│                                     scopes })       │
└──────────────┬──────────────────────────────────────┘
               │  window.auth   (IPC bridge)
               ▼
   Renderer ── signIn(service, hint?) / signOut / status
```

- **Credential store** owns bytes-at-rest.
- **Broker** owns the token lifecycle: strategies, refresh, cache,
  re-auth prompts.
- **Providers** never see the raw credential — they call
  `broker.getToken(...)` and get a live access token.

### Credential storage

Use Electron's built-in [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
API. It transparently uses:

- **Windows** → DPAPI (per-user, per-machine).
- **macOS** → Keychain via `SecItem`.
- **Linux** → libsecret / GNOME Keyring / KWallet.

No native dep (better than `keytar` — deprecated build chain — and
than `@napi-rs/keyring` — extra napi surface). One encrypted blob
at `app.getPath('userData')/credentials.json`. Schema:

```jsonc
{
  "version": 1,
  "credentials": [
    {
      "service": "graph",
      "accountId": "user@example.com",
      "displayName": "Work",
      "cipherB64": "…safeStorage-encrypted JSON…",
      "createdAt": "…", "lastUsedAt": "…"
    }
  ]
}
```

The encrypted payload is service-specific. For an OAuth
integration it holds `{ refreshToken, tokenType, scope, expiresAt,
… }`. For a PAT it holds `{ token }`. Broker owns the shape.

Consequences to accept up front:
- `safeStorage`'s key is per-user-per-OS-login. **Switching
  machines or clearing your OS user profile forces re-auth.** Fine
  for a personal desktop app; document it.
- On Linux, if the user has no `Secret Service` provider running,
  `safeStorage` falls back to plaintext with a warning. Detect
  the fallback and prompt.

### Sign-in strategies

Each strategy is a plug-in with a narrow contract:

```ts
interface SignInStrategy {
  readonly kind: 'device' | 'pkce-loopback' | 'pat' | 'os-broker' | 'sigv4' | …;

  /** Whether this strategy can produce a credential for the given
   *  service on this platform right now (e.g. WAM only on
   *  Windows + a supported Entra account). */
  isAvailable(service: ServiceConfig): boolean;

  /** Run the interactive flow. Renders whatever UI is needed
   *  through `ui` (device-code dialog, PAT paste box, browser
   *  handoff). Returns a Credential the broker can persist. */
  signIn(service: ServiceConfig, ui: SignInUI): Promise<Credential>;

  /** Given a stored credential, produce a fresh access token
   *  (refresh where applicable; return the raw token otherwise). */
  getAccessToken(credential: Credential, opts: { scopes?: string[] }): Promise<AccessToken>;
}
```

A `ServiceConfig` bundles per-service constants:
- `serviceId: 'graph' | 'github' | 'notion' | 'linear' | …`
- authorization / token / device URLs
- default and available scopes
- client id (for OAuth flows), if applicable
- which strategies to try in order

Startup wires the built-in strategies: `device`, `pkce-loopback`,
`pat`, and (Windows-only, later) `os-broker`. Providers register
their `ServiceConfig`s with the broker at load time.

**Strategy selection** is a fallthrough down the service's
declared preference list: try `os-broker` first if available; else
`device`; else `pkce-loopback`; and `pat` is always available as
"you type it yourself".

### `SignInUI` — the renderer's role

The broker doesn't render UI itself. It calls the renderer through
IPC to display whichever affordance the current strategy needs.
Analogous to the existing `HostServices` split for
`showInputBox` / `showQuickPick` / `showConfirm`.

- `showDeviceCode({ userCode, verificationUri, expiresAt })` — a
  modal with the code + a button to open the verification URL in
  the OS browser. Live-updating countdown, cancellable.
- `showPatPaste({ service, help })` — a text field with a "Where
  do I get this?" link to service-specific docs.
- `showAccountPicker({ accounts, allowNew })` — for services that
  support multiple accounts, disambiguate before signing in.

Each returns a promise the broker awaits. The renderer never sees
the token itself — only the OS-facing artefacts (device code,
URL) or the user's input to send to main.

### Multi-account

Users have multiple accounts per service (personal + work Google,
personal + team Notion, `github.com` + `github.enterprise.corp`).
The credential store keys on `(service, accountId)` for exactly
this reason. Two questions surface:

1. **Which account does a given provider instance use?**
2. **How does the user distinguish them?**

Answer to (1): the location URI names the account explicitly.
`graph://user@example.com/drive/x/items/y` is unambiguous. Bare
`graph://drive/x/items/y` triggers the account picker.

Answer to (2): each credential has a `displayName` — user-editable,
defaulting to the service's own identity string (email, username).
The account picker is a Radix dropdown, matching the existing
provider picker language.

### Refresh + expiry

- Broker keeps an in-memory access-token cache keyed by
  `(service, accountId, scopeSet)` with the token's `expiresAt`.
- `getToken` returns cached if fresh; otherwise runs the
  strategy's `getAccessToken` (refresh flow) and repopulates.
- If refresh fails with an "auth required" error class
  (`interaction_required`, `invalid_grant`, HTTP 401 in the
  refresh response), broker surfaces `NeedsInteractiveReauth` up
  to the caller. The provider passes it through as a `NogginError`
  the UI catches → prompt user to re-sign-in.
- **Conditional-access mid-session challenges.** Entra frequently
  invalidates tokens when a policy fires (new location, MFA
  window elapsed). Broker treats the challenge like any other
  refresh failure — surfaces `NeedsInteractiveReauth`.

### Rate limits + change notification

Per-token rate limits (GitHub 5000/hr, Notion 3/s, Graph per-app
per-tenant) belong in the substrate — a thin queue in front of
each token that respects `Retry-After`, applies exponential
backoff, and coalesces bursts. Providers get a `fetch`-like helper
from the broker that already handles this.

External-change detection stays per-provider — each service has
a different capability (webhooks vs. delta APIs vs. plain
polling). The broker gives providers a **delta scheduler** so
polling is coordinated across providers pointing at the same
service and adaptive to actual change rate. Webhook-capable
providers ignore it and drive `onDidChange` directly.

### IPC surface

```ts
// preload exposes:
window.auth = {
  status(service): Promise<AuthStatus[]>;  // accounts + expiry
  signIn(service, hint?): Promise<AuthStatus>;
  signOut(service, accountId): Promise<void>;
  onStatusChanged(cb): Dispose;
};
```

Renderer uses these from the settings UI (a new "Accounts" panel)
and from the `NogginOpenDialog` when a provider needs auth before
it can list content. Individual provider verbs never call these
directly — they go through `broker.getToken` in main.

### Provider integration

A provider that wants auth adds one line to its provider descriptor
in the renderer registry (so the "sign in" affordance surfaces
alongside the picker):

```ts
{
  scheme: 'graph',
  label: 'OneDrive / SharePoint',
  authService: 'graph',   // ← new
  pickers: [ … ],
  …
}
```

And in main, when opening:

```ts
const token = await broker.getToken({
  service: 'graph',
  accountId: parseAccountFromUri(location),
  scopes: ['Files.ReadWrite'],
});
const noggin = await new GraphNoggin(location, { token }).init();
```

If `broker.getToken` throws `NeedsInteractiveReauth`, the caller
surfaces it through the standard error channel; the UI catches
the error class and offers a "Sign in again" button that hits
`window.auth.signIn(service)`.

### Corporate proxies + custom CAs

Two knobs:
- Respect `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` env vars in
  `fetch` calls the broker makes (via the OS-default proxy where
  possible).
- Respect `NODE_EXTRA_CA_CERTS`. Document it in the setup guide.
  Some enterprise TLS-interception setups need users to add
  their corp root CA — we don't want to hide that behind an
  unrelated error.

## What the user sees

**First-run for an authenticated provider.**
1. User opens the hamburger → **Open noggin…** → picks a
   Graph-based option in the NogginOpenDialog.
2. Dialog notices no Graph account is signed in yet → shows a
   sign-in card in the right pane with two buttons: "Sign in with
   Microsoft" (device flow) and "Paste an access token"
   (PAT / fallback).
3. Device flow: modal with code + browser handoff → success →
   dialog switches to the actual picker for that provider.

**Second run.**
1. Same flow, but the sign-in card is skipped because the broker
   has a valid refresh token cached.

**Session mid-flight, token expired + refresh worked.**
- Silent. Provider gets a fresh token, nothing hits the UI.

**Session mid-flight, refresh failed / policy fired.**
- The verb that triggered the call fails with a
  `NogginError { code: 'auth-required' }`. The existing error
  banner grows a "Sign in again" button that reopens the sign-in
  flow. Once done, the failed verb can be re-issued.

**Accounts panel.**
- New settings page: list of `(service, accountId, displayName,
  lastUsedAt)`. Per-row: rename, sign out. Bottom: "Sign in to
  another service…" opens the sign-in picker.

## Migration and rollout

- **Phase 1 (this plan).** Land the auth broker + credential
  store + IPC + `device` and `pat` strategies. No new provider —
  just a testable substrate.
- **Phase 2.** First real provider (candidate: GitHub Issues via
  device code — closest match to noggin's tree model, unlocks a
  real user story, exercises `device` end-to-end).
- **Phase 3.** Second provider that exercises `pkce-loopback` —
  Google Drive or Microsoft Graph, whichever we care about.
- **Phase 4+.** Additional providers, `os-broker` (WAM) on
  Windows, delta/webhook wiring where the API supports it.

Each phase is a separately shippable release. The substrate is
useful once (Phase 1) and pays dividends thereafter.

## Risks + tradeoffs

- **safeStorage on Linux without a keyring is a soft failure.**
  Detect it and refuse to persist rather than falling back to
  plaintext silently.
- **You own the OAuth app registration.** Entra, Google,
  GitHub — each has ongoing config, redirect URIs, per-tenant
  admin consent for enterprise scopes. Not free.
- **OAuth in a desktop app has more moving parts than in web.**
  Especially around single-instance-lock + protocol-handler edge
  cases. Loopback flow avoids most of that but doesn't survive
  ports being blocked.
- **Passkeys are a moving target on desktop.** Node/Electron
  support is early. Deferring is the right call — but the
  strategy interface leaves room.
- **Multi-account confuses the URI dedupe layer.** Provider
  shared-handle registry keys on canonical URL; if two accounts
  point at the same underlying resource, do we share the handle?
  For file-shaped providers, no — separate accounts can produce
  divergent views. Account belongs *in* the canonical key.

## Open questions

- **Where do `ServiceConfig`s live?** Options: hardcoded in
  `@noggin/engine`, in the provider package itself, or in a
  side-loadable JSON that the user can override for self-hosted
  Gitea/GitLab/Notion instances. Probably: default per-service
  in-tree, overridable via a settings JSON for self-hosted.
- **Do we need a "test connection" verb?** Providers currently
  check on open. But for the settings UI it'd be useful to
  validate credentials without doing a full noggin open.
- **How does the CLI participate?** The CLI has no UI to render
  device-code dialogs. Options: (a) print the code to stdout
  and open the URL; (b) require `noggin-cli login <service>` to
  seed credentials before use; (c) delegate to `gh auth`-style
  per-service helpers. Not urgent — no CLI-driven authenticated
  provider exists yet.
- **Do we surface auth events to the VS Code extension host?**
  The extension has its own SecretStorage API, distinct from
  Electron's. Two options: (a) reuse VS Code's `SecretStorage`
  where the host is VS Code, wrapping it behind the same
  `CredentialStore` interface; (b) run our own broker in the
  extension host, ignoring VS Code's. (a) is more work but
  respects the host — leaning that way.

## Prior art we should honour

- **Azure Developer CLI (`azd`)** — device flow + WAM on
  Windows + browser flow on macOS/Linux. Good UX reference.
- **`gh` CLI** — device flow + PAT paste; the simplicity is
  worth copying.
- **VS Code Authentication API** — the model of "providers
  contribute sign-in providers, features ask for sessions by
  scope" maps almost 1:1 onto what's proposed here.
- **MSAL Node** — takes care of PKCE + refresh + cache
  plugability; concrete implementation of the substrate for
  Entra-based services.

The design above is deliberately close to VS Code's model so
that when the extension host runs, we can plug VS Code's
`SecretStorage` in for the `CredentialStore` and reuse the same
provider code with a different backend.
