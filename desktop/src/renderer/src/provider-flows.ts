// Renderer-side calls to the noggin-rpc provider flows.
//
// A "provider flow" is the provider's own user-facing pick / create UX,
// run entirely in the host process: the server drives the native dialog
// (and, for create, seeds a new empty noggin) and returns a canonical
// location the engine can open. Keeping the dialog + path→URL + seeding
// in the host — not the renderer — is the separation of concerns behind
// routing the sidebar `+` menu through here instead of `host.pickFile`.
//
// Thin binding of the shared `@noggin/rpc` helper to this renderer's
// singleton `RpcClient` — see `createProviderFlowsClient` for the
// request/response + cancel-shaped-null handling.

import { createProviderFlowsClient } from '@noggin/rpc';
import { getRpcClient } from './rpc-client';

const flows = createProviderFlowsClient(getRpcClient());

/** Run the provider's "open" flow for `scheme`. Returns a canonical
 *  location, or null on cancel / when the bridge is unavailable. */
export const open = flows.open;

/** Run the provider's "create" flow for `scheme` (native save dialog +
 *  seed a new empty noggin). Returns a canonical location, or null. */
export const create = flows.create;

