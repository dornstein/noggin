// Browser shim for node:os. Only referenced inside the file provider,
// which the playground never loads.
export const homedir = () => '~';
export const tmpdir = () => '/tmp';
export default { homedir, tmpdir };
