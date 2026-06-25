// HostServices — the OS / runtime services the server exposes to RPC
// clients on demand.
//
// Every `host.*` method in `RpcProtocol` is dispatched through this
// interface. The transport carries the *request*; the server runtime
// implements *the actual UX* (Electron dialog, VS Code QuickPick, a
// test harness's scripted response, etc.).
//
// All methods return Promises and mirror the RPC shapes 1-to-1. The
// `createNogginRpcServer` adapter is the only consumer.

import type {
  FileFilter,
  HostOpenExternalRequest,
  HostOpenExternalResponse,
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
  HostShowConfirmRequest,
  HostShowConfirmResponse,
  HostShowErrorRequest,
  HostShowErrorResponse,
  HostShowInputBoxRequest,
  HostShowInputBoxResponse,
  HostShowQuickPickRequest,
  HostShowQuickPickResponse,
} from './protocol.ts';

/**
 * @public
 * The runtime services a noggin-rpc server delegates `host.*` methods
 * to. Hosts (Electron main, VS Code extension, headless test rig)
 * implement this; the server adapter routes RPC requests through it.
 *
 * Every method may throw — failures surface as engine-style
 * `NogginRpcError` envelopes to the client, with whatever `code` the
 * implementation throws. A common host-error convention is to throw
 * with `code: 'host-error'` and a human-readable `message`.
 *
 * Methods may also reject the operation (user cancelled, dialog
 * dismissed). Cancellation is encoded in the response shape, not as
 * an error: e.g. `pickFile` returns `{ paths: [] }`, `showInputBox`
 * returns `{ value: null }`. Errors are reserved for things that
 * actually went wrong.
 */
export interface HostServices {
  pickFile(opts: HostPickFileRequest): Promise<HostPickFileResponse>;
  pickNewFile(opts: HostPickNewFileRequest): Promise<HostPickNewFileResponse>;
  showInputBox(opts: HostShowInputBoxRequest): Promise<HostShowInputBoxResponse>;
  showQuickPick(opts: HostShowQuickPickRequest): Promise<HostShowQuickPickResponse>;
  showConfirm(opts: HostShowConfirmRequest): Promise<HostShowConfirmResponse>;
  showError(opts: HostShowErrorRequest): Promise<HostShowErrorResponse>;
  openExternal(opts: HostOpenExternalRequest): Promise<HostOpenExternalResponse>;
}

/**
 * @public
 * Re-export the request types so host authors can build their
 * implementation against a single import.
 */
export type {
  FileFilter,
  HostOpenExternalRequest,
  HostOpenExternalResponse,
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
  HostShowConfirmRequest,
  HostShowConfirmResponse,
  HostShowErrorRequest,
  HostShowErrorResponse,
  HostShowInputBoxRequest,
  HostShowInputBoxResponse,
  HostShowQuickPickRequest,
  HostShowQuickPickResponse,
};
