// nogginProviderRegistry — unit tests for the read-only/mutable
// registry semantics.

import { describe, it, expect } from 'vitest';
import {
  createNogginProviderRegistry,
  defaultNogginProviders,
  type NogginProviderType,
} from '../nogginProviderRegistry';

const FILE: NogginProviderType = {
  scheme: 'file',
  label: 'YAML file',
  badgeTone: 'neutral',
  icon: 'file',
};

const HTTPS: NogginProviderType = {
  scheme: 'https',
  aliases: ['http'],
  label: 'Public URL',
  badgeTone: 'accent',
  icon: 'globe',
  readOnly: true,
};

const MEMORY: NogginProviderType = {
  scheme: 'memory',
  label: 'In-memory',
  badgeTone: 'muted',
  icon: 'symbol-event',
};

describe('createNogginProviderRegistry', () => {
  it('seeds in order', () => {
    const r = createNogginProviderRegistry([FILE, HTTPS, MEMORY]);
    expect(r.types.map((t) => t.scheme)).toEqual(['file', 'https', 'memory']);
  });

  it('get() returns by exact scheme', () => {
    const r = createNogginProviderRegistry([FILE, HTTPS]);
    expect(r.get('file')).toBe(FILE);
    expect(r.get('FILE')).toBe(FILE); // case-insensitive
    expect(r.get('https')).toBe(HTTPS);
    expect(r.get('unknown')).toBeNull();
  });

  it('get() resolves aliases', () => {
    const r = createNogginProviderRegistry([HTTPS]);
    expect(r.get('http')).toBe(HTTPS);
    expect(r.get('HTTP')).toBe(HTTPS);
  });

  it('forUri() extracts scheme', () => {
    const r = createNogginProviderRegistry([FILE, HTTPS, MEMORY]);
    expect(r.forUri('file:///tmp/a.yaml')).toBe(FILE);
    expect(r.forUri('https://example.com/a.yaml')).toBe(HTTPS);
    expect(r.forUri('http://example.com/a.yaml')).toBe(HTTPS); // alias
    expect(r.forUri('memory://abc')).toBe(MEMORY);
    expect(r.forUri('/tmp/a.yaml')).toBe(FILE); // bare path → file
  });

  it('forUri() returns null for unknown scheme', () => {
    const r = createNogginProviderRegistry([FILE]);
    expect(r.forUri('https://example.com/a.yaml')).toBeNull();
  });

  it('register() adds and disposes', () => {
    const r = createNogginProviderRegistry([FILE]);
    const sub = r.register(HTTPS);
    expect(r.types.map((t) => t.scheme)).toEqual(['file', 'https']);
    sub.dispose();
    expect(r.types.map((t) => t.scheme)).toEqual(['file']);
  });

  it('register() rejects duplicate schemes', () => {
    const r = createNogginProviderRegistry([FILE]);
    expect(() => r.register(FILE)).toThrow(/already registered/);
    expect(() => r.register({ ...FILE, label: 'Other' })).toThrow(/already registered/);
  });

  it('onDidChange fires on register + dispose', () => {
    const r = createNogginProviderRegistry();
    let count = 0;
    const sub = r.onDidChange(() => { count += 1; });
    const reg = r.register(FILE);
    expect(count).toBe(1);
    reg.dispose();
    expect(count).toBe(2);
    sub.dispose();
    r.register(HTTPS);
    expect(count).toBe(2); // unsubscribed
  });

  it('defaultNogginProviders covers file/https/memory/localstorage + http alias', () => {
    const r = createNogginProviderRegistry(defaultNogginProviders);
    expect(r.get('file')?.scheme).toBe('file');
    expect(r.get('https')?.scheme).toBe('https');
    expect(r.get('http')?.scheme).toBe('https'); // alias
    expect(r.get('memory')?.scheme).toBe('memory');
    expect(r.get('localstorage')?.scheme).toBe('localstorage');
    expect(r.types).toHaveLength(4);
  });
});
