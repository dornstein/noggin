// Keyboard accelerator matcher tests (tier 1 · logic).

import { describe, it, expect } from 'vitest';
import { matchAccelerator, type AcceleratorEvent } from '../src/renderer/src/keymap';

const ev = (key: string, mods: Partial<AcceleratorEvent> = {}): AcceleratorEvent =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('matchAccelerator', () => {
  it('maps Ctrl+<key> to the app actions', () => {
    expect(matchAccelerator(ev('n', { ctrlKey: true }))).toBe('new');
    expect(matchAccelerator(ev('o', { ctrlKey: true }))).toBe('open');
    expect(matchAccelerator(ev('w', { ctrlKey: true }))).toBe('close');
    expect(matchAccelerator(ev('b', { ctrlKey: true }))).toBe('toggleSidebar');
    expect(matchAccelerator(ev('/', { ctrlKey: true }))).toBe('shortcuts');
  });

  it('accepts Cmd (metaKey) as well as Ctrl', () => {
    expect(matchAccelerator(ev('n', { metaKey: true }))).toBe('new');
  });

  it('is case-insensitive', () => {
    expect(matchAccelerator(ev('N', { ctrlKey: true }))).toBe('new');
  });

  it('requires a Ctrl/Cmd modifier', () => {
    expect(matchAccelerator(ev('n'))).toBeNull();
  });

  it('rejects Alt combos (mnemonics / AltGr)', () => {
    expect(matchAccelerator(ev('n', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('returns null for unmapped keys (including native Edit roles)', () => {
    expect(matchAccelerator(ev('x', { ctrlKey: true }))).toBeNull();
    expect(matchAccelerator(ev('c', { ctrlKey: true }))).toBeNull(); // Copy stays native
    expect(matchAccelerator(ev('v', { ctrlKey: true }))).toBeNull(); // Paste stays native
  });
});
