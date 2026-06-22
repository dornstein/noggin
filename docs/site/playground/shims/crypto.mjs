// Browser shim for node:crypto. noggin-api.mjs uses only
// `crypto.randomBytes(n).toString('hex')` for item key generation;
// we wrap the Web Crypto API to match that surface.

export function randomBytes(n) {
  const arr = new Uint8Array(n);
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('Web Crypto getRandomValues is required for noggin playground');
  }
  globalThis.crypto.getRandomValues(arr);
  return {
    toString(encoding) {
      if (encoding === 'hex') {
        let out = '';
        for (let i = 0; i < arr.length; i++) {
          out += arr[i].toString(16).padStart(2, '0');
        }
        return out;
      }
      throw new Error(`crypto shim: unsupported encoding ${encoding}`);
    },
  };
}

export default { randomBytes };
