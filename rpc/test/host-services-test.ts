// Test fixture: a scriptable HostServices implementation that records
// every call and returns pre-baked answers. Lets the rpc test suite
// exercise the server-adapter's host.* routing end-to-end without
// any Electron / VS Code / browser environment.
//
// Usage:
//   const host = createTestHostServices({
//     showInputBox: { value: 'typed answer' },
//     pickFile: { paths: ['/picked.yaml'] },
//   });
//   // host.showInputBox(...) resolves to { value: 'typed answer' }
//   // host.calls === [{ method: 'showInputBox', request: { … } }]
//
// Any host method whose scripted response is omitted uses a sensible
// "user cancelled" default so the test doesn't have to spell out
// every shape.

import type {
  HostOpenExternalRequest,
  HostOpenExternalResponse,
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
  HostServices,
  HostShowConfirmRequest,
  HostShowConfirmResponse,
  HostShowErrorRequest,
  HostShowErrorResponse,
  HostShowInputBoxRequest,
  HostShowInputBoxResponse,
  HostShowQuickPickRequest,
  HostShowQuickPickResponse,
} from '../src/host-services.ts';

/** One recorded host call. */
export interface RecordedHostCall {
  method: keyof HostServices;
  request: unknown;
}

/** Scripted responses for each method (all optional). */
export interface TestHostScript {
  pickFile?: HostPickFileResponse;
  pickNewFile?: HostPickNewFileResponse;
  showInputBox?: HostShowInputBoxResponse;
  showQuickPick?: HostShowQuickPickResponse;
  showConfirm?: HostShowConfirmResponse;
  showError?: HostShowErrorResponse;
  openExternal?: HostOpenExternalResponse;
}

/** A `HostServices` implementation plus an inspectable `calls` log. */
export interface TestHostServices extends HostServices {
  readonly calls: ReadonlyArray<RecordedHostCall>;
  /** Reset the recording log. The script is unchanged. */
  reset(): void;
}

/**
 * Build a test `HostServices` from a script. Missing fields fall back
 * to "user cancelled" defaults so a test only has to spell out what
 * the verb under test actually exercises.
 */
export function createTestHostServices(script: TestHostScript = {}): TestHostServices {
  const calls: RecordedHostCall[] = [];
  const record = <K extends keyof HostServices>(method: K, request: unknown): void => {
    calls.push({ method, request });
  };

  const impl: HostServices = {
    async pickFile(req: HostPickFileRequest) {
      record('pickFile', req);
      return script.pickFile ?? { paths: [] };
    },
    async pickNewFile(req: HostPickNewFileRequest) {
      record('pickNewFile', req);
      return script.pickNewFile ?? { path: null };
    },
    async showInputBox(req: HostShowInputBoxRequest) {
      record('showInputBox', req);
      return script.showInputBox ?? { value: null };
    },
    async showQuickPick(req: HostShowQuickPickRequest) {
      record('showQuickPick', req);
      return script.showQuickPick ?? { selected: null };
    },
    async showConfirm(req: HostShowConfirmRequest) {
      record('showConfirm', req);
      return script.showConfirm ?? { confirmed: false };
    },
    async showError(req: HostShowErrorRequest) {
      record('showError', req);
      return script.showError ?? { acknowledged: true };
    },
    async openExternal(req: HostOpenExternalRequest) {
      record('openExternal', req);
      return script.openExternal ?? { opened: false };
    },
  };

  return {
    ...impl,
    get calls() { return calls; },
    reset() { calls.length = 0; },
  };
}
