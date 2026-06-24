// Component tests for <NogginDetails> — specifically the pane-level
// keyboard-shortcut behaviour added so the details pane can respond
// to the same gestures as the tree when focus is inside the pane.
//
// Rules pinned here:
//   - Tree gestures (Enter, Ctrl+Enter, Alt+arrows, Ctrl+Home/End,
//     Space, Delete) fire onGesture(item.path, ...).
//   - F2 toggles the inline title rename locally; no onGesture.
//   - Tab and Shift+Tab are NOT intercepted (pane focus traversal).
//   - Keys that originate from an INPUT, TEXTAREA, BUTTON, or
//     contenteditable element are passed through (the descendant
//     owns its keys).

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

import { NogginDetails } from '../NogginDetails';
import type { NogginDetailsItem } from '../types';

function makeItem(overrides: Partial<NogginDetailsItem> = {}): NogginDetailsItem {
  return {
    key: 'k1',
    path: '/1',
    title: 'thing',
    done: false,
    notes: [],
    isActive: false,
    hasPrevSibling: false,
    hasNextSibling: false,
    ...overrides,
  };
}

function getPane(): HTMLElement {
  // The outer .noggin-details div is the keydown listener host.
  const el = document.querySelector<HTMLElement>('.noggin-details');
  if (!el) throw new Error('details pane not mounted');
  return el;
}

describe('<NogginDetails> pane keyboard shortcuts', () => {
  it('Enter on the pane (not on a button) fires addSiblingAfter for the shown item', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ path: '/1/2' })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    // Fire on the title <h2> (non-interactive descendant) so the
    // event bubbles to the pane's keydown handler.
    const title = screen.getByRole('heading', { level: 2 });
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' });
    expect(onGesture).toHaveBeenCalledWith('/1/2', 'addSiblingAfter');
  });

  it('Ctrl+Enter fires addChild', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ path: '/1/2' })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    fireEvent.keyDown(getPane(), { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onGesture).toHaveBeenCalledWith('/1/2', 'addChild');
  });

  it('Alt+ArrowUp / Alt+ArrowDown fire moveUp / moveDown', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ path: '/1/2' })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    fireEvent.keyDown(getPane(), { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    fireEvent.keyDown(getPane(), { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    expect(onGesture).toHaveBeenNthCalledWith(1, '/1/2', 'moveUp');
    expect(onGesture).toHaveBeenNthCalledWith(2, '/1/2', 'moveDown');
  });

  it('Ctrl+Home / Ctrl+End fire addFirstSibling / addLastSibling', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ path: '/1/2' })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    fireEvent.keyDown(getPane(), { key: 'Home', code: 'Home', ctrlKey: true });
    fireEvent.keyDown(getPane(), { key: 'End', code: 'End', ctrlKey: true });
    expect(onGesture).toHaveBeenNthCalledWith(1, '/1/2', 'addFirstSibling');
    expect(onGesture).toHaveBeenNthCalledWith(2, '/1/2', 'addLastSibling');
  });

  it('Space and Delete fire toggleDone / delete', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ path: '/1/2' })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    fireEvent.keyDown(getPane(), { key: ' ', code: 'Space' });
    fireEvent.keyDown(getPane(), { key: 'Delete', code: 'Delete' });
    expect(onGesture).toHaveBeenNthCalledWith(1, '/1/2', 'toggleDone');
    expect(onGesture).toHaveBeenNthCalledWith(2, '/1/2', 'delete');
  });

  it('Tab and Shift+Tab are NOT intercepted (pane focus traversal stays native)', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem()}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    fireEvent.keyDown(getPane(), { key: 'Tab', code: 'Tab' });
    fireEvent.keyDown(getPane(), { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('F2 opens the inline title rename and does NOT fire onGesture', () => {
    const onGesture = vi.fn();
    const onRetitle = vi.fn();
    render(
      <NogginDetails
        item={makeItem()}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onRetitle={onRetitle}
        onGesture={onGesture}
      />
    );
    // F2 fired on the pane (title is a sibling, but firing on the
    // pane container is the realistic case after a button blur).
    fireEvent.keyDown(getPane(), { key: 'F2', code: 'F2' });
    expect(onGesture).not.toHaveBeenCalled();
    // The rename input should now be mounted.
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('keys originating from a BUTTON are NOT intercepted', () => {
    const onGesture = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ isActive: false })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onGesture={onGesture}
      />
    );
    // "Make active" button is rendered because isActive === false.
    const btn = screen.getByRole('button', { name: /make active/i });
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ', code: 'Space' });
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('keys originating from the rename INPUT are NOT intercepted by the pane', () => {
    const onGesture = vi.fn();
    const onRetitle = vi.fn();
    render(
      <NogginDetails
        item={makeItem({ title: 'hello' })}
        onToggleDone={() => {}}
        onGoto={() => {}}
        onAppendNote={() => {}}
        onRetitle={onRetitle}
        onGesture={onGesture}
      />
    );
    // Open the rename input via F2 first.
    fireEvent.keyDown(getPane(), { key: 'F2', code: 'F2' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    // Now firing a tree gesture on the input must not call onGesture.
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onGesture).not.toHaveBeenCalled();
  });
});
