// Component tests for <NogginTree>. Drives the real component in
// jsdom + Testing Library against a mocked actions surface so each
// gesture call site round-trips through the same paths shipped to
// hosts.
//
// Coverage focuses on the bugs we've fixed during the focus/selection
// refactor:
//   - Tab/Shift+Tab on a focused row stays inside the tree
//   - Click on a row updates `.selected` and selectedPath
//   - Add gestures (Enter, Shift+Enter, Ctrl+Enter, Ctrl+Home,
//     Ctrl+End) call actions.runGesture with the right gesture name
//   - Move gestures (Tab, Shift+Tab, Alt+Up/Down/Home/End) likewise
//   - Inline rename: typing + Enter → actions.rename; Escape →
//     onRenameCancel
//   - Auto-commit-then-dispatch: typing + add/move gesture (without
//     Enter) → actions.rename fires THEN actions.runGesture fires
//   - PinIcon: appears on hover for non-active rows, click calls
//     actions.activate; always visible on the active row

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act, within } from '@testing-library/react';

import { NogginTree } from '../NogginTree';
import type { NogginNode } from '../types';
import type { NogginTreeActions } from '../actions';
import { mockActions } from './helpers/mockActions';

// ── Fixtures ─────────────────────────────────────────────────────

function node(
  key: string,
  path: string,
  title: string,
  children: NogginNode[] = [],
  done = false,
): NogginNode {
  return { key, path, title, done, noteCount: 0, children };
}

function basicTree(): NogginNode[] {
  return [
    node('k1', '/1', 'A', [
      node('k1c1', '/1/1', 'A.1'),
      node('k1c2', '/1/2', 'A.2'),
    ]),
    node('k2', '/2', 'B'),
  ];
}

interface HarnessProps {
  initialNodes?: NogginNode[];
  initialSelected?: string | null;
  initialRenaming?: string | null;
  activeKey?: string | null;
  actions?: NogginTreeActions;
  onSelect?: (path: string) => void;
  onRenameCancel?: () => void;
  onRequestRename?: (path: string) => void;
}

/**
 * Stateful harness around <NogginTree>. The component is controlled
 * (selectedPath + renamingPath are props), so we hold them here so
 * tests can both observe state changes and let the component see
 * them on re-render.
 */
function Harness(props: HarnessProps) {
  const [nodes] = useState(props.initialNodes ?? basicTree());
  const [selectedPath, setSelectedPath] = useState<string | null>(props.initialSelected ?? null);
  const [renamingPath, setRenamingPath] = useState<string | null>(props.initialRenaming ?? null);
  return (
    <div style={{ width: 400, height: 400 }}>
      <NogginTree
        nodes={nodes}
        fileId="test"
        activeKey={props.activeKey ?? null}
        selectedPath={selectedPath}
        renamingPath={renamingPath}
        width={400}
        height={400}
        actions={props.actions ?? mockActions()}
        onSelect={(p) => { setSelectedPath(p); props.onSelect?.(p); }}
        onRequestRename={(p) => { setRenamingPath(p); props.onRequestRename?.(p); }}
        onRenameCancel={() => { setRenamingPath(null); props.onRenameCancel?.(); }}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function getRow(path: string): HTMLElement {
  // Each row contains a `.position` span with the path text. The row
  // wrapper is the closest `.noggin-row` ancestor.
  const positions = Array.from(document.querySelectorAll('.noggin-row .position'));
  const match = positions.find((el) => el.textContent === path);
  if (!match) throw new Error(`row ${path} not found`);
  return match.closest('.noggin-row') as HTMLElement;
}

/**
 * Get the tree's root focusable element — arborist mounts the
 * `[role="tree"]` div tabindex=0. This is the DOM-focus host for
 * keyboard gestures.
 */
function getTreeRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="tree"]');
  if (!el) throw new Error('tree root not mounted');
  return el;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('<NogginTree> — selection + click', () => {
  it('renders every row from the nodes prop', () => {
    render(<Harness />);
    expect(getRow('/1')).toBeInTheDocument();
    expect(getRow('/1/1')).toBeInTheDocument();
    expect(getRow('/1/2')).toBeInTheDocument();
    expect(getRow('/2')).toBeInTheDocument();
  });

  it('clicking a row calls onSelect and applies .selected', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(getRow('/1/2'));
    expect(onSelect).toHaveBeenCalledWith('/1/2');
    expect(getRow('/1/2')).toHaveClass('selected');
    expect(getRow('/1')).not.toHaveClass('selected');
  });

  it('active row has .pin-icon.active visible (opacity 1 via class)', () => {
    render(<Harness activeKey="k1c2" />);
    const row = getRow('/1/2');
    const pin = row.querySelector('.pin-icon');
    expect(pin).toHaveClass('active');
  });
});

describe('<NogginTree> — keyboard add gestures', () => {
  // Each test focuses the tree, asserts actions.runGesture fires with
  // the right (path, gesture) tuple, and that the keystroke did NOT
  // escape the tree (which is the Tab-leak bug we keep regressing).

  let actions: ReturnType<typeof mockActions>;

  beforeEach(() => {
    actions = mockActions();
  });

  function setupFocused() {
    render(<Harness initialSelected="/1/2" actions={actions} />);
    // selectedPath flows through to arborist via the effect; arborist
    // focuses the [role=tree] element via selectionFollowsFocus.
    act(() => { getTreeRoot().focus(); });
  }

  it('Enter on focused row fires addSiblingAfter', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'Enter', code: 'Enter' });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addSiblingAfter');
  });

  it('Shift+Enter fires addSiblingBefore', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addSiblingBefore');
  });

  it('Ctrl+Enter fires addChild', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addChild');
  });

  it('Ctrl+Home fires addFirstSibling', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'Home', code: 'Home', ctrlKey: true });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addFirstSibling');
  });

  it('Ctrl+End fires addLastSibling', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'End', code: 'End', ctrlKey: true });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addLastSibling');
  });
});

describe('<NogginTree> — keyboard move gestures', () => {
  let actions: ReturnType<typeof mockActions>;

  beforeEach(() => {
    actions = mockActions();
  });

  function setupFocused() {
    render(<Harness initialSelected="/1/2" actions={actions} />);
    act(() => { getTreeRoot().focus(); });
  }

  it('Tab on focused row fires demote and DOES NOT move browser focus out of tree', () => {
    setupFocused();
    const before = document.activeElement;
    fireEvent.keyDown(getTreeRoot(), { key: 'Tab', code: 'Tab' });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'demote');
    // Tab must NOT leak — focus stays on the tree element.
    expect(document.activeElement).toBe(before);
  });

  it('Shift+Tab fires promote and does not leak focus', () => {
    setupFocused();
    const before = document.activeElement;
    fireEvent.keyDown(getTreeRoot(), { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'promote');
    expect(document.activeElement).toBe(before);
  });

  it('Alt+ArrowUp / ArrowDown fire moveUp / moveDown', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    fireEvent.keyDown(getTreeRoot(), { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    expect(actions.runGesture).toHaveBeenNthCalledWith(1, '/1/2', 'moveUp');
    expect(actions.runGesture).toHaveBeenNthCalledWith(2, '/1/2', 'moveDown');
  });

  it('Alt+Home / End fire moveToFirst / moveToLast', () => {
    setupFocused();
    fireEvent.keyDown(getTreeRoot(), { key: 'Home', code: 'Home', altKey: true });
    fireEvent.keyDown(getTreeRoot(), { key: 'End', code: 'End', altKey: true });
    expect(actions.runGesture).toHaveBeenNthCalledWith(1, '/1/2', 'moveToFirst');
    expect(actions.runGesture).toHaveBeenNthCalledWith(2, '/1/2', 'moveToLast');
  });
});

describe('<NogginTree> — inline rename', () => {
  it('renders a rename input when renamingPath matches a row', async () => {
    render(<Harness initialRenaming="/1/2" />);
    const row = getRow('/1/2');
    const input = within(row).getByRole('textbox') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    // Focus is scheduled via queueMicrotask; flush it.
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(input);
  });

  it('Enter in rename input commits via actions.rename', () => {
    const actions = mockActions();
    render(<Harness initialRenaming="/1/2" actions={actions} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'edited' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'edited');
  });

  it('Escape in rename input calls onRenameCancel', () => {
    const onRenameCancel = vi.fn();
    render(<Harness initialRenaming="/1/2" onRenameCancel={onRenameCancel} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(onRenameCancel).toHaveBeenCalled();
  });

  it('empty trimmed value on Enter calls onRenameCancel (no rename action)', () => {
    const actions = mockActions();
    const onRenameCancel = vi.fn();
    render(<Harness initialRenaming="/1/2" actions={actions} onRenameCancel={onRenameCancel} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalled();
  });
});

describe('<NogginTree> — auto-commit on add/move during rename', () => {
  // The bug: with the rename input focused, hitting Ctrl+Home (etc.)
  // before Enter would silently lose the typed text and never
  // dispatch the gesture. Fix: input.onKeyDown intercepts add/move
  // gestures, commits via actions.rename, then dispatches via
  // actions.runGesture.

  it('Ctrl+Home with typed title: commits, then fires addFirstSibling', () => {
    const actions = mockActions();
    render(<Harness initialRenaming="/1/2" actions={actions} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'typed-title' } });
    fireEvent.keyDown(input, { key: 'Home', code: 'Home', ctrlKey: true });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'typed-title');
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addFirstSibling');
    // Ordering: rename call must come before the gesture so the engine
    // queue serializes the title edit before the add.
    expect(actions.rename.mock.invocationCallOrder[0]).toBeLessThan(actions.runGesture.mock.invocationCallOrder[0]);
  });

  it('Ctrl+Enter with typed title commits then fires addChild', () => {
    const actions = mockActions();
    render(<Harness initialRenaming="/1/2" actions={actions} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'typed-title' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'typed-title');
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addChild');
  });

  it('Alt+ArrowDown with typed title commits then fires moveDown', () => {
    const actions = mockActions();
    render(<Harness initialRenaming="/1/2" actions={actions} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'before-move' } });
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'before-move');
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'moveDown');
  });

  it('add/move gesture with EMPTY input cancels and does NOT fire actions', () => {
    const actions = mockActions();
    const onRenameCancel = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        actions={actions}
        onRenameCancel={onRenameCancel}
      />
    );
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    // Input defaultValues to the existing title; clear it to simulate
    // "user hit the gesture with nothing typed".
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Home', code: 'Home', ctrlKey: true });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(actions.runGesture).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalled();
  });

  it('Tab in rename input commits then fires demote (outliner convention)', () => {
    const actions = mockActions();
    render(<Harness initialRenaming="/1/2" actions={actions} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'demote-me' } });
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'demote-me');
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'demote');
  });

  it('Shift+Tab in rename input commits then fires promote', () => {
    const actions = mockActions();
    render(<Harness initialRenaming="/1/2" actions={actions} />);
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'promote-me' } });
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'promote-me');
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'promote');
  });

  it('Tab with UNCHANGED title cancels rename then fires demote (no stale renamingPath)', () => {
    // Regression: previously, an existing item being edited with the
    // title left unchanged would skip both rename AND cancel, leaving
    // the host's renamingPath pointing at the now-moved row. The
    // re-numbering after demote would then drop a DIFFERENT row into
    // rename mode.
    const actions = mockActions();
    const onRenameCancel = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        actions={actions}
        onRenameCancel={onRenameCancel}
      />
    );
    // defaultValue is the existing title 'A.2'; don't change it.
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalled();
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'demote');
    // Order matters — cancel BEFORE dispatch so the structural
    // change can't land on a stale `renamingPath`.
    expect(onRenameCancel.mock.invocationCallOrder[0]).toBeLessThan(actions.runGesture.mock.invocationCallOrder[0]);
  });
});

describe('<NogginTree> — arrow keys during rename', () => {
  // The user reported: typing then ArrowUp would clear the input. The
  // rule we want: ArrowUp / ArrowDown commits (or cancels if
  // empty/unchanged) and then moves keyboard navigation to the
  // prev/next row. Home, End, ArrowLeft, ArrowRight are left to the
  // input as normal text-navigation keys.

  it('ArrowUp with typed title: commits then advances selection up', async () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        initialSelected="/1/2"
        actions={actions}
        onSelect={onSelect}
      />
    );
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'half-typed' } });
    fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(actions.rename).toHaveBeenCalledWith('/1/2', 'half-typed');
    // tree.focus is dispatched on the next microtask.
    await act(async () => { await Promise.resolve(); });
    // Selection should have advanced to the previous visible row.
    expect(onSelect).toHaveBeenCalledWith('/1/1');
  });

  it('ArrowDown with typed title: commits then advances selection down', async () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    render(
      <Harness
        initialRenaming="/1/1"
        initialSelected="/1/1"
        actions={actions}
        onSelect={onSelect}
      />
    );
    const input = within(getRow('/1/1')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'half-typed' } });
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(actions.rename).toHaveBeenCalledWith('/1/1', 'half-typed');
    await act(async () => { await Promise.resolve(); });
    expect(onSelect).toHaveBeenCalledWith('/1/2');
  });

  it('ArrowUp with empty input: cancels (no rename) and still advances', async () => {
    const actions = mockActions();
    const onRenameCancel = vi.fn();
    const onSelect = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        initialSelected="/1/2"
        actions={actions}
        onRenameCancel={onRenameCancel}
        onSelect={onSelect}
      />
    );
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(onSelect).toHaveBeenCalledWith('/1/1');
  });

  it('ArrowUp with unchanged input (matches existing title): cancels and advances', async () => {
    const actions = mockActions();
    const onRenameCancel = vi.fn();
    const onSelect = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        initialSelected="/1/2"
        actions={actions}
        onRenameCancel={onRenameCancel}
        onSelect={onSelect}
      />
    );
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    // The defaultValue is 'A.2'; leaving it unchanged should be cancel.
    fireEvent.keyDown(input, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(onRenameCancel).toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(onSelect).toHaveBeenCalledWith('/1/1');
  });

  it('Home and End in rename input are NOT intercepted (text-edit keys)', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        initialSelected="/1/2"
        actions={actions}
        onSelect={onSelect}
      />
    );
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Home', code: 'Home' });
    fireEvent.keyDown(input, { key: 'End', code: 'End' });
    fireEvent.keyDown(input, { key: 'ArrowLeft', code: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'ArrowRight', code: 'ArrowRight' });
    // Shift+Home/End (text selection)
    fireEvent.keyDown(input, { key: 'Home', code: 'Home', shiftKey: true });
    fireEvent.keyDown(input, { key: 'End',  code: 'End',  shiftKey: true });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(actions.runGesture).not.toHaveBeenCalled();
    // Selection (and therefore DOM focus) must NOT move to another row.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Space and Delete and printable characters in rename input do NOT fire tree gestures', () => {
    const actions = mockActions();
    const onSelect = vi.fn();
    render(
      <Harness
        initialRenaming="/1/2"
        initialSelected="/1/2"
        actions={actions}
        onSelect={onSelect}
      />
    );
    const input = within(getRow('/1/2')).getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: ' ', code: 'Space' });
    fireEvent.keyDown(input, { key: 'Delete', code: 'Delete' });
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    fireEvent.keyDown(input, { key: 'A', code: 'KeyA', shiftKey: true });
    expect(actions.runGesture).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('<NogginTree> — pin / activate', () => {
  it('clicking the pin on a non-active row calls actions.activate', () => {
    const actions = mockActions();
    render(<Harness actions={actions} />);
    const pin = getRow('/1/2').querySelector('.pin-icon') as HTMLElement;
    fireEvent.click(pin);
    expect(actions.activate).toHaveBeenCalledWith('/1/2');
  });

  it('clicking the pin on the already-active row is a no-op (no activate call)', () => {
    const actions = mockActions();
    render(<Harness activeKey="k1c2" actions={actions} />);
    const pin = getRow('/1/2').querySelector('.pin-icon') as HTMLElement;
    fireEvent.click(pin);
    expect(actions.activate).not.toHaveBeenCalled();
  });
});
