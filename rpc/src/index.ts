// Public surface of @noggin/rpc.
//
// Framework: envelopes, errors, transport, client, server, heartbeats.
// Protocol:  the typed noggin-rpc method table + notification shapes.
//
// Transport implementations live behind subpath exports so consumers
// that only need one don't pay for the others:
//
//   import { createMemoryTransportPair } from '@noggin/rpc/transports/memory';
//   import { createElectronIpcMainTransport } from '@noggin/rpc/transports/electron-ipc';
//   import { createPostMessageTransport } from '@noggin/rpc/transports/postmessage';

// Framework
export type {
  RpcRequest,
  RpcResponse,
  RpcError,
  RpcErrorPayload,
  RpcNotification,
  RpcPing,
  RpcPong,
  RpcMessage,
} from './envelope.ts';
export {
  isRequest,
  isResponse,
  isError,
  isNotification,
  isPing,
  isPong,
} from './envelope.ts';

export { NogginRpcError, toErrorPayload, type RpcFrameworkErrorCode } from './errors.ts';
export type { RpcDisposable, Transport } from './transport.ts';
export { RpcClient, type RpcClientOptions, type HeartbeatOptions } from './client.ts';
export { RpcServer, type RpcServerOptions, type RpcHandler } from './server.ts';

// Phase 2: server adapter + HostServices
export {
  createNogginRpcServer,
  type CreateNogginRpcServerOptions,
  type NogginRpcServer,
  type ProviderFlows,
} from './server-adapter.ts';
export type { HostServices } from './host-services.ts';

// Protocol surface
export type {
  RpcProtocol,
  RpcNotifications,
  RpcMethod,
  RpcRequestOf,
  RpcResponseOf,
  RpcNotificationMethod,
  RpcNotificationOf,
  SessionId,
  SubscriptionId,
  // noggin.*
  NogginOpenRequest,
  NogginOpenResponse,
  NogginCloseRequest,
  NogginCloseResponse,
  NogginSnapshotRequest,
  NogginSnapshotResponse,
  NogginShowRequest,
  NogginShowResponse,
  NogginSubscribeRequest,
  NogginSubscribeResponse,
  NogginUnsubscribeRequest,
  NogginUnsubscribeResponse,
  NogginChangedNotification,
  NogginErroredNotification,
  // verb.*
  VerbRequest,
  VerbPushRequest,
  VerbAddRequest,
  VerbMoveRequest,
  VerbGotoRequest,
  VerbDoneRequest,
  VerbPopRequest,
  VerbEditRequest,
  VerbNoteRequest,
  VerbDeleteRequest,
  VerbCopyRequest,
  VerbViewResponse,
  // host.*
  FileFilter,
  QuickPickItem,
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
  HostShowInputBoxRequest,
  HostShowInputBoxResponse,
  HostShowQuickPickRequest,
  HostShowQuickPickResponse,
  HostShowConfirmRequest,
  HostShowConfirmResponse,
  HostShowErrorRequest,
  HostShowErrorResponse,
  HostOpenExternalRequest,
  HostOpenExternalResponse,
  // provider.*
  ProviderDescriptor,
  ProviderInstance,
  ProviderListRequest,
  ProviderListResponse,
  ProviderCreateRequest,
  ProviderCreateResponse,
  ProviderOpenRequest,
  ProviderOpenResponse,
  ProviderListInstancesRequest,
  ProviderListInstancesResponse,
  ProviderDescribeRequest,
  ProviderDescribeResponse,
  // engine type re-exports
  Item,
  ItemKey,
  ItemPath,
  ChangeEvent,
  CurrentTreeView,
  DeleteResult,
  CopyResult,
  CopyOptions,
  NogginDocument,
  NogginErrorCode,
} from './protocol.ts';
