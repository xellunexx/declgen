import os from 'node:os';
import path from 'node:path';
// §6: the default data root lives outside the repository so runtime state
// (sessions, uploads, case files, runs) can never be committed accidentally.
// Committed fixtures used by tests live under tests/fixtures/.
let root =
  process.env.DECLGEN_DATA_ROOT || path.join(os.homedir(), '.declgen-data');
export function setDataRoot(v: string) {
  root = path.resolve(v);
}
export function dataRoot() {
  return root;
}
export function catalogDir() {
  return path.join(root, 'catalog');
}
export function clientsDir() {
  return path.join(root, 'clients');
}
export function runsDir() {
  return path.join(root, 'runs');
}
