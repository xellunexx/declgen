import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('Vite development server is strict on 5173', () => {
  const config = read('vite.config.ts');
  assert.match(config, /port:\s*5173/);
  assert.match(config, /strictPort:\s*true/);
});

test('package versions are pinned and infrastructure is checked', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, version] of Object.entries({
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  })) {
    assert.equal(typeof version, 'string', name);
    assert.doesNotMatch(
      String(version),
      /^(?:latest|next|\^|~|\*|>|<)/,
      `${name} is not exact: ${version}`,
    );
  }
  const nodeConfig = read('tsconfig.node.json');
  assert.match(nodeConfig, /vite\.config\.ts/);
  assert.match(nodeConfig, /electron\/\*\*\/\*\.cjs/);
  assert.match(nodeConfig, /"checkJs":\s*true/);
});

test('Electron renderer is sandboxed and file access uses main-process grants', () => {
  const main = read('electron/main.ts');
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /assertTrustedSender/);
  assert.match(main, /requireGrantedFile/);
  assert.match(main, /requireGrantedFolder/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setWindowOpenHandler/);
});

test('CSP blocks arbitrary script/object/frame execution', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /frame-src 'none'/);
});
