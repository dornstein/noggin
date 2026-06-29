// Test helper: build a fully-mocked NogginActions object so
// component tests can assert on individual action calls without
// having to construct a real noggin or wire vi.fn() bindings for
// every method by hand.

import { vi, type Mock } from 'vitest';
import type { NogginActions } from '../../actions';
import type { Noggin } from '@noggin/engine';

type MockedActions = {
  [K in Exclude<keyof NogginActions, 'noggin'>]: Mock;
} & { noggin: Noggin };

/**
 * Stub noggin satisfying just enough of the `Noggin` interface for
 * the read paths that `buildTreeMenuEntries` exercises when a row's
 * Radix ContextMenu mounts (`findByKey`, `pathOf`, `items`, `active`).
 * Returns empty / null for everything; menu builds fall through to
 * the "item not found" branch and return [].
 */
function stubNoggin(): Noggin {
  return {
    items: [],
    active: null,
    findByKey: () => null,
    pathOf: () => null,
    tryResolvePath: () => null,
    childrenOf: () => [],
  } as unknown as Noggin;
}

export function mockActions(
  overrides: Partial<NogginActions> = {},
): NogginActions & MockedActions {
  const base = {
    noggin: stubNoggin(),
    rename:           vi.fn().mockResolvedValue({ key: 'k', title: '' }),
    toggleDone:       vi.fn().mockResolvedValue({ key: 'k', nowDone: false }),
    delete:           vi.fn().mockResolvedValue({ deletedKey: 'k', fallbackFocusKey: null }),
    appendNote:       vi.fn().mockResolvedValue({ key: 'k' }),
    activate:         vi.fn().mockResolvedValue({ key: 'k' }),
    addSiblingAfter:  vi.fn().mockResolvedValue({ newKey: null }),
    addSiblingBefore: vi.fn().mockResolvedValue({ newKey: null }),
    addChild:         vi.fn().mockResolvedValue({ newKey: null }),
    addFirstSibling:  vi.fn().mockResolvedValue({ newKey: null }),
    addLastSibling:   vi.fn().mockResolvedValue({ newKey: null }),
    moveUp:           vi.fn().mockResolvedValue({ movedKey: null }),
    moveDown:         vi.fn().mockResolvedValue({ movedKey: null }),
    moveToFirst:      vi.fn().mockResolvedValue({ movedKey: null }),
    moveToLast:       vi.fn().mockResolvedValue({ movedKey: null }),
    demote:           vi.fn().mockResolvedValue({ movedKey: null }),
    promote:          vi.fn().mockResolvedValue({ movedKey: null }),
    move:             vi.fn().mockResolvedValue({ movedKey: null }),
  } as unknown as NogginActions & MockedActions;
  return Object.assign(base, overrides) as NogginActions & MockedActions;
}
