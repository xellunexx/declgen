import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

export const read = (file: string) =>
  fs.readFileSync(path.join(root, file), 'utf8');

// Source-contract matching that cannot be broken by formatting: quotes, whitespace
// and trailing commas are normalized before comparing, so `prettier --write` over the
// tree leaves these assertions intact.
export const flat = (s: string) =>
  s
    .replace(/["'`]/g, "'")
    .replace(/\s+/g, '')
    .replace(/,([)\]}])/g, '$1');

export const has = (src: string, needle: string) =>
  flat(src).includes(flat(needle));
