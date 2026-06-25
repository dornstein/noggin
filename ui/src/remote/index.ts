// Public surface of @noggin/ui's remote-noggin layer.
//
// What lives here:
//   - `NogginVerbs`       the dispatch shape every UI consumer uses
//   - `bindEngineVerbs`   adapt an in-process engine Noggin to the shape
//   - `RemoteNoggin`      the RPC-backed implementation with optimistic apply
//   - `openRemoteNoggin`  factory: noggin.open + noggin.subscribe + ready
//
// All of `@noggin/ui` is consumed via the barrel; this submodule is
// re-exported there.

export { bindEngineVerbs, type NogginVerbs } from './verbs.ts';
export {
  RemoteNoggin,
  type NogginClient,
  type NogginReadable,
  type RemoteDisposable,
  type RemoteNogginOptions,
} from './RemoteNoggin.ts';
export { openRemoteNoggin, type OpenRemoteNogginOptions } from './openRemoteNoggin.ts';
