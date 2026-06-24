// Keyboard → TreeGesture mapping + the auto-commit-from-rename rule.
//
// These are tiny pure functions and were previously mirrored in a
// node-test file under desktop/test/. Now imported directly from the
// real ui/ source so drift is impossible.

import { describe, it, expect } from 'vitest';
import { gestureForKey, shouldInterceptFromRename } from '../NogginTree';

interface KeyOpts { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }
function k(key: string, opts: KeyOpts = {}): KeyboardEvent {
  // Cast — we only set the fields gestureForKey consults.
  return {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    altKey: !!opts.alt,
    shiftKey: !!opts.shift,
  } as unknown as KeyboardEvent;
}

describe('gestureForKey keymap', () => {
  it('Enter adds sibling after; Shift+Enter adds sibling before', () => {
    expect(gestureForKey(k('Enter'))).toBe('addSiblingAfter');
    expect(gestureForKey(k('Enter', { shift: true }))).toBe('addSiblingBefore');
  });

  it('Ctrl+Enter adds child (and metaKey is treated as Ctrl)', () => {
    expect(gestureForKey(k('Enter', { ctrl: true }))).toBe('addChild');
    expect(gestureForKey(k('Enter', { meta: true }))).toBe('addChild');
  });

  it('Ctrl+Home / Ctrl+End add at first / last sibling position', () => {
    expect(gestureForKey(k('Home', { ctrl: true }))).toBe('addFirstSibling');
    expect(gestureForKey(k('End',  { ctrl: true }))).toBe('addLastSibling');
  });

  it('Tab / Shift+Tab demote / promote', () => {
    expect(gestureForKey(k('Tab'))).toBe('demote');
    expect(gestureForKey(k('Tab', { shift: true }))).toBe('promote');
  });

  it('Alt+Up / Down swap with previous / next sibling', () => {
    expect(gestureForKey(k('ArrowUp',   { alt: true }))).toBe('moveUp');
    expect(gestureForKey(k('ArrowDown', { alt: true }))).toBe('moveDown');
  });

  it('Alt+Home / End move to first / last among siblings', () => {
    expect(gestureForKey(k('Home', { alt: true }))).toBe('moveToFirst');
    expect(gestureForKey(k('End',  { alt: true }))).toBe('moveToLast');
  });

  it('F2 rename, Space toggleDone, Delete delete', () => {
    expect(gestureForKey(k('F2'))).toBe('rename');
    expect(gestureForKey(k(' '))).toBe('toggleDone');
    expect(gestureForKey(k('Delete'))).toBe('delete');
  });

  it('returns null for unhandled combos', () => {
    expect(gestureForKey(k('A'))).toBeNull();
    expect(gestureForKey(k('Enter', { ctrl: true, shift: true }))).toBeNull();
    expect(gestureForKey(k('ArrowUp'))).toBeNull(); // bare arrows = navigate, not a gesture
    expect(gestureForKey(k('ArrowDown', { ctrl: true }))).toBeNull();
  });
});

describe('shouldInterceptFromRename', () => {
  it('intercepts every add gesture (auto-commit then create)', () => {
    expect(shouldInterceptFromRename(gestureForKey(k('Enter')))).toBe(true);                       // addSiblingAfter
    expect(shouldInterceptFromRename(gestureForKey(k('Enter', { shift: true })))).toBe(true);      // addSiblingBefore
    expect(shouldInterceptFromRename(gestureForKey(k('Enter', { ctrl: true })))).toBe(true);       // addChild
    expect(shouldInterceptFromRename(gestureForKey(k('Home',  { ctrl: true })))).toBe(true);       // addFirstSibling
    expect(shouldInterceptFromRename(gestureForKey(k('End',   { ctrl: true })))).toBe(true);       // addLastSibling
  });

  it('intercepts every move gesture (auto-commit then move)', () => {
    expect(shouldInterceptFromRename(gestureForKey(k('ArrowUp',   { alt: true })))).toBe(true);    // moveUp
    expect(shouldInterceptFromRename(gestureForKey(k('ArrowDown', { alt: true })))).toBe(true);    // moveDown
    expect(shouldInterceptFromRename(gestureForKey(k('Home',      { alt: true })))).toBe(true);    // moveToFirst
    expect(shouldInterceptFromRename(gestureForKey(k('End',       { alt: true })))).toBe(true);    // moveToLast
  });

  it('intercepts Tab / Shift+Tab (demote / promote) \u2014 outliner convention', () => {
    expect(shouldInterceptFromRename(gestureForKey(k('Tab')))).toBe(true);                         // demote
    expect(shouldInterceptFromRename(gestureForKey(k('Tab', { shift: true })))).toBe(true);        // promote
  });

  it('does NOT intercept rename / toggleDone / delete', () => {
    // F2 rename \u2014 already in rename mode, would be a no-op
    expect(shouldInterceptFromRename(gestureForKey(k('F2')))).toBe(false);
    // Space \u2014 must reach the input as a normal character so users can type
    expect(shouldInterceptFromRename(gestureForKey(k(' ')))).toBe(false);
    // Delete \u2014 normal text-editing key in an input
    expect(shouldInterceptFromRename(gestureForKey(k('Delete')))).toBe(false);
  });

  it('does not intercept anything for keys that aren\u2019t gestures', () => {
    expect(shouldInterceptFromRename(gestureForKey(k('A')))).toBe(false);
    expect(shouldInterceptFromRename(gestureForKey(k('ArrowDown')))).toBe(false);
    expect(shouldInterceptFromRename(null)).toBe(false);
  });
});
