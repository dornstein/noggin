// Browser shim for node:fs. Empty — the playground never executes
// any file provider code paths, but the imports survive bundling.
export default {};
export const existsSync = () => false;
export const readFileSync = () => { throw new Error('node:fs not available in browser'); };
export const writeFileSync = () => { throw new Error('node:fs not available in browser'); };
export const mkdirSync = () => { throw new Error('node:fs not available in browser'); };
export const renameSync = () => { throw new Error('node:fs not available in browser'); };
export const rmSync = () => { throw new Error('node:fs not available in browser'); };
