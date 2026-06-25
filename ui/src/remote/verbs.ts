// NogginVerbs — the verb-dispatch surface the UI uses.
//
// Both shapes implement it:
//   - `bindEngineVerbs(noggin)`  for in-process callers (current desktop/
//                                extension paths; existing UI tests)
//   - `RemoteNoggin`             for RPC-backed callers (Phase 3 onwards)
//
// `executeGesture` and any other UI code that drives mutations consume
// this interface so callers can swap an in-process noggin for a remote
// one without touching component code.

import type {
  AddOptions,
  CurrentTreeView,
  DeleteOptions,
  DeleteResult,
  DoneOptions,
  EditOptions,
  GotoOptions,
  MoveOptions,
  Noggin as EngineNoggin,
  NoteOptions,
  PopOptions,
  PushOptions,
} from '../../skills/noggin/noggin-api.mjs';
import { verbs as engineVerbs } from '../../skills/noggin/noggin-api.mjs';

/**
 * @public
 * The verb-dispatch surface every UI consumer expects. Methods mirror
 * `verbs.*` from the engine but bind the noggin so the caller only
 * has to pass `opts`. Returns are `Promise`-typed — works for both
 * in-process and remote dispatch.
 */
export interface NogginVerbs {
  push(opts: PushOptions): Promise<CurrentTreeView>;
  add(opts: AddOptions): Promise<CurrentTreeView>;
  move(opts: MoveOptions): Promise<CurrentTreeView>;
  goto(opts: GotoOptions): Promise<CurrentTreeView>;
  done(opts?: DoneOptions): Promise<CurrentTreeView>;
  pop(opts?: PopOptions): Promise<CurrentTreeView>;
  edit(opts: EditOptions): Promise<CurrentTreeView>;
  note(opts: NoteOptions): Promise<CurrentTreeView>;
  delete(opts: DeleteOptions): Promise<DeleteResult>;
}

/**
 * @public
 * Bind an in-process engine `Noggin` to the `NogginVerbs` shape. The
 * returned object's methods call the engine verbs directly with no
 * extra hops. Use this when the UI is hosted in the same process as
 * the engine (today's desktop renderer, the extension host before the
 * Phase 4 / Phase 5 migrations).
 */
export function bindEngineVerbs(noggin: EngineNoggin): NogginVerbs {
  return {
    push: (opts) => engineVerbs.push(noggin, opts),
    add: (opts) => engineVerbs.add(noggin, opts),
    move: (opts) => engineVerbs.move(noggin, opts),
    goto: (opts) => engineVerbs.goto(noggin, opts),
    done: (opts) => engineVerbs.done(noggin, opts),
    pop: (opts) => engineVerbs.pop(noggin, opts),
    edit: (opts) => engineVerbs.edit(noggin, opts),
    note: (opts) => engineVerbs.note(noggin, opts),
    delete: (opts) => engineVerbs.delete(noggin, opts),
  };
}
