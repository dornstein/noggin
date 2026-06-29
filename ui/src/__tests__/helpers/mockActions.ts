// Test helper: build a fully-mocked NogginTreeActions object so
// component tests can assert on individual action calls without
// having to construct a real noggin or wire vi.fn() bindings for
// every method by hand.

import { vi, type Mock } from 'vitest';
import type { NogginTreeActions } from '../../actions';

type MockedActions = {
  [K in keyof NogginTreeActions]: Mock;
};

export function mockActions(overrides: Partial<NogginTreeActions> = {}): NogginTreeActions & MockedActions {
  const base = {
    rename: vi.fn().mockResolvedValue(undefined),
    toggleDone: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    appendNote: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    runGesture: vi.fn().mockResolvedValue({}),
    getMenuEntries: vi.fn().mockReturnValue([]),
  } as unknown as NogginTreeActions & MockedActions;
  return Object.assign(base, overrides) as NogginTreeActions & MockedActions;
}
