// Browser shim for node:path. Only `dirname`/`basename` are touched by
// noggin-api.mjs and only inside file-backed methods we never invoke.
const stub = (msg) => () => { throw new Error(`node:path.${msg} not available in browser`); };
export const dirname = stub('dirname');
export const basename = stub('basename');
export const join = stub('join');
export const resolve = stub('resolve');
export const isAbsolute = stub('isAbsolute');
export const sep = '/';
export default { dirname, basename, join, resolve, isAbsolute, sep };
