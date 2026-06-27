# @noggin/ui

Shared React component library for noggin UIs. Consumed by the
[VS Code extension](../extension/), the [desktop app](../desktop/),
and (eventually) the [docs site playground](../docs/site/playground/).

## Why this exists

The same tree-of-items + details-pane + quick-add + note-editor surface
was being built independently in each host. They drifted (different
drag-drop behaviour, different markdown rendering, different keyboard
shortcuts). One canonical implementation here means a bug fix in one
place reaches every host on the next sync.

## Architecture

Components take **handler props**, never call host APIs directly.
Every verb is a prop:

```tsx
<NogginTree
  nodes={view.items}
  activeKey={view.activeKey}
  onGoto={(path) => host.goto(path)}
  onToggleDone={(path, done) => done ? host.edit({path, done: false}) : host.done({path})}
  onMove={(fromPath, kind, anchorPath) => host.move({path: fromPath, placement: {kind, anchor: anchorPath}})}
  // …
/>
```

Hosts wire the handler props to their transport — Electron IPC, VS Code
webview postMessage, browser-local in-process calls. The components
themselves are pure React.

## What's here

| Component | Purpose |
|---|---|
| `<NogginTree>` | The canonical tree. react-arborist for virtualization + drag-drop, with three-zone (before / after / into) disambiguation. |
| `<NogginDetails>` | Selected-item details: state pill, path chip, notes list (markdown rendered), inline note editor with live preview. |
| `<NogginContextMenu>` | Reusable popup context menu. |
| `<NogginNoteEditor>` | CodeMirror-based markdown editor with syntax highlighting + live preview pane. Used inside Details and standalone. |
| `<Icon>` | Codicon helper. |
| `tokens.css` | VS Code Dark+ palette + spacing + typography variables. Host can override or pass its own. |

## Consumption

The library is a private workspace package (not published to npm yet —
we'll move to public when a third party asks). Consumers add it via
relative path in their `package.json`:

```json
"dependencies": {
  "@noggin/ui": "file:../ui"
}
```

Then `import { NogginTree } from '@noggin/ui'` and `import '@noggin/ui/styles.css'`
in the bundle.

## Versioning

Same unified version as the rest of the repo (`engine/package.json`).
`scripts/bump-version.mjs` bumps `ui/package.json` alongside everyone
else; no separate cadence.
