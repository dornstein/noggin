// Component tests for <NogginDetails> — specifically the pane-level
// keyboard-shortcut behaviour added so the details pane can respond
// to the same gestures as the tree when focus is inside the pane.
//
// Rules pinned here:
//   - Tree gestures (Enter, Ctrl+Enter, Alt+arrows, Ctrl+Home/End)
//     route through `actions.runGesture(item.path, ...)`.
//   - Space (toggleDone) and Delete go through their dedicated
//     action methods so the impl can pass the current state.
//   - F2 toggles the inline title rename locally; no action call.
//   - Tab and Shift+Tab are NOT intercepted (pane focus traversal).
//   - Keys that originate from an INPUT, TEXTAREA, BUTTON, or
//     contenteditable element are passed through (the descendant
//     owns its keys).

import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

import { NogginDetails } from '../NogginDetails';
import type { NogginDetailsItem } from '../types';
import { mockActions } from './helpers/mockActions';

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
  it('Enter on the pane (not on a button) fires addSiblingAfter via actions.runGesture', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ path: '/1/2' })} actions={actions} />);
    const title = screen.getByRole('heading', { level: 2 });
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addSiblingAfter');
  });

  it('Ctrl+Enter fires addChild via actions.runGesture', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ path: '/1/2' })} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(actions.runGesture).toHaveBeenCalledWith('/1/2', 'addChild');
  });

  it('Alt+ArrowUp / Alt+ArrowDown fire moveUp / moveDown via actions.runGesture', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ path: '/1/2' })} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    fireEvent.keyDown(getPane(), { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    expect(actions.runGesture).toHaveBeenNthCalledWith(1, '/1/2', 'moveUp');
    expect(actions.runGesture).toHaveBeenNthCalledWith(2, '/1/2', 'moveDown');
  });

  it('Ctrl+Home / Ctrl+End fire addFirstSibling / addLastSibling via actions.runGesture', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ path: '/1/2' })} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: 'Home', code: 'Home', ctrlKey: true });
    fireEvent.keyDown(getPane(), { key: 'End', code: 'End', ctrlKey: true });
    expect(actions.runGesture).toHaveBeenNthCalledWith(1, '/1/2', 'addFirstSibling');
    expect(actions.runGesture).toHaveBeenNthCalledWith(2, '/1/2', 'addLastSibling');
  });

  it('Space fires actions.toggleDone with the current done state', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ path: '/1/2', done: false })} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: ' ', code: 'Space' });
    expect(actions.toggleDone).toHaveBeenCalledWith('/1/2', false);
  });

  it('Delete fires actions.delete', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ path: '/1/2' })} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: 'Delete', code: 'Delete' });
    expect(actions.delete).toHaveBeenCalledWith('/1/2', false);
  });

  it('Tab and Shift+Tab are NOT intercepted (pane focus traversal stays native)', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem()} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: 'Tab', code: 'Tab' });
    fireEvent.keyDown(getPane(), { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(actions.runGesture).not.toHaveBeenCalled();
  });

  it('F2 opens the inline title rename and does NOT fire any action verb', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem()} actions={actions} />);
    fireEvent.keyDown(getPane(), { key: 'F2', code: 'F2' });
    expect(actions.runGesture).not.toHaveBeenCalled();
    expect(actions.rename).not.toHaveBeenCalled();
    // The rename input should now be mounted.
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('keys originating from a BUTTON are NOT intercepted', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ isActive: false })} actions={actions} />);
    // "Make active" button is rendered because isActive === false.
    const btn = screen.getByRole('button', { name: /make active/i });
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ', code: 'Space' });
    expect(actions.runGesture).not.toHaveBeenCalled();
    expect(actions.toggleDone).not.toHaveBeenCalled();
  });

  it('keys originating from the rename INPUT are NOT intercepted by the pane', () => {
    const actions = mockActions();
    render(<NogginDetails item={makeItem({ title: 'hello' })} actions={actions} />);
    // Open the rename input via F2 first.
    fireEvent.keyDown(getPane(), { key: 'F2', code: 'F2' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    // Now firing a tree gesture on the input must not call any action.
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(actions.runGesture).not.toHaveBeenCalled();
  });
});
