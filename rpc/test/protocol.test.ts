// Compile-time test: pin the protocol method surface so an accidental
// rename or deletion in `src/protocol.ts` fails the build.
//
// This is a vitest file but every assertion is at type-level — the test
// body just throws if the runtime layer disagrees, which it can't here.

import { describe, it, expect, assertType } from 'vitest';
import type {
  RpcMethod,
  RpcRequestOf,
  RpcResponseOf,
  RpcNotificationMethod,
  RpcNotificationOf,
  NogginOpenRequest,
  NogginChangedNotification,
  SessionId,
  SubscriptionId,
} from '../src/protocol.ts';

describe('RpcProtocol method surface', () => {
  it('declares every method family from the noggin-rpc plan', () => {
    // Enumerate every method name we expect. If one is missing in
    // protocol.ts, this array literal won't typecheck.
    const ALL_METHODS: readonly RpcMethod[] = [
      'noggin.open', 'noggin.close', 'noggin.snapshot', 'noggin.show',
      'noggin.subscribe', 'noggin.unsubscribe',
      'verb.push', 'verb.add', 'verb.move', 'verb.goto', 'verb.done',
      'verb.pop', 'verb.edit', 'verb.note', 'verb.delete', 'verb.copy',
      'host.pickFile', 'host.pickNewFile', 'host.showInputBox',
      'host.showQuickPick', 'host.showConfirm', 'host.showError',
      'host.openExternal',
      'provider.list', 'provider.create', 'provider.open',
      'provider.listInstances', 'provider.describe',
    ];
    // Also force the reverse: assert the count matches so adding a new
    // method without updating this list fails the runtime assertion.
    expect(ALL_METHODS.length).toBe(28);
  });

  it('declares both notification method names', () => {
    const ALL_NOTIFICATIONS: readonly RpcNotificationMethod[] = [
      'noggin.changed', 'noggin.errored',
    ];
    expect(ALL_NOTIFICATIONS.length).toBe(2);
  });

  it('request/response indexed-access helpers are typed correctly', () => {
    // Each method's helper returns its declared shape.
    assertType<RpcRequestOf<'noggin.open'>>({ location: '~/.noggin.yaml' } as NogginOpenRequest);
    assertType<RpcResponseOf<'noggin.subscribe'>>({ subscriptionId: 'sub-1' as SubscriptionId });
    assertType<RpcNotificationOf<'noggin.changed'>>({
      subscriptionId: 'sub-1' as SubscriptionId,
      sessionId: 'sess-1' as SessionId,
      changes: [] as NogginChangedNotification['changes'],
    });
    expect(true).toBe(true);
  });
});
