// @vitest-environment jsdom
//
// HostServicesReactImpl component test (tier 2 · isolated component).
//
// The renderer half of the host-services RPC arc: it listens on
// `window.hostServicesRpc`, renders the requested prompt, and posts the
// answer back. We drive a request through the bridge and assert it
// renders and replies correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';

import { HostServicesReactImpl } from '../src/renderer/src/HostServicesReactImpl';

type Req = { id: string; kind: 'inputBox' | 'quickPick' | 'confirm'; payload: unknown };

let handler: ((req: Req) => void) | null = null;
const sendReply = vi.fn();

beforeEach(() => {
  handler = null;
  sendReply.mockReset();
  (window as unknown as { hostServicesRpc: unknown }).hostServicesRpc = {
    onRequest: (h: (req: Req) => void) => { handler = h; return () => { handler = null; }; },
    sendReply,
  };
});
afterEach(() => cleanup());

function emit(req: Req) {
  act(() => { handler?.(req); });
}

describe('HostServicesReactImpl', () => {
  it('renders nothing until a request arrives', () => {
    const { container } = render(<HostServicesReactImpl />);
    expect(container.textContent).toBe('');
    expect(handler).toBeTypeOf('function'); // registered on the bridge
  });

  it('fulfils an inputBox request and replies with the typed value', () => {
    const { container } = render(<HostServicesReactImpl />);
    emit({ id: 'r1', kind: 'inputBox', payload: { title: 'Name?' } });

    const input = container.querySelector('input.modal-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: 'Alice' } });
    fireEvent.submit(input!.closest('form')!);

    expect(sendReply).toHaveBeenCalledWith({ id: 'r1', kind: 'ok', response: { value: 'Alice' } });
  });

  it('fulfils a confirm request via the affirmative button', () => {
    const { getByText } = render(<HostServicesReactImpl />);
    emit({ id: 'c1', kind: 'confirm', payload: { message: 'Delete?', confirmLabel: 'Yes' } });

    fireEvent.click(getByText('Yes'));
    expect(sendReply).toHaveBeenCalledWith({ id: 'c1', kind: 'ok', response: { confirmed: true } });
  });

  it('cancelling a confirm replies with confirmed: false', () => {
    const { getByText } = render(<HostServicesReactImpl />);
    emit({ id: 'c2', kind: 'confirm', payload: { message: 'Delete?' } });

    fireEvent.click(getByText('Cancel'));
    expect(sendReply).toHaveBeenCalledWith({ id: 'c2', kind: 'ok', response: { confirmed: false } });
  });
});
