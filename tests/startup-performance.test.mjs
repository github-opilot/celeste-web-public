import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sdk = readFileSync(new URL('../src/celeste.sdk.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/demo/index.html', import.meta.url), 'utf8');

test('startup phases are timed and forwarded to the launch progress UI', () => {
  for (const phase of [
    'game-staging',
    'everest-archive',
    'wasm-runtime',
    'dotnet-startup',
    'everest-extraction',
    'monomod-patch',
    'game-init',
    'first-frames',
  ]) {
    assert.ok(sdk.includes(`'${phase}'`), `${phase} is measured by the SDK`);
    assert.ok(html.includes(`'${phase}'`), `${phase} has a readable UI label`);
  }
  assert.match(html, /first playable display/);
  assert.match(html, /console\.table\(/);
});

test('valid Everest and MonoMod outputs are reused on later launches', () => {
  assert.match(sdk, /hasNonEmptyFile\(root, at\(PATCHED_ASSEMBLY\)\)/);
  assert.match(sdk, /EVEREST_MARKER/);
  assert.match(sdk, /reusing cached patched assembly/);
  assert.match(sdk, /if \(patched && !opts\.repatch && \(!opts\.installEverest \|\| everestPresent\)\)/);
});

test('the runtime cannot initialize twice from repeated start calls', () => {
  assert.match(sdk, /let booting = false/);
  assert.match(sdk, /if \(booted \|\| booting \|\| destroyed\) return/);
  assert.match(sdk, /if \(pageInstance\)/);
  assert.match(html, /if \(engineLoadStarted\) throw new Error/);
});

test('public startup checks local OPFS before requiring a player ZIP', () => {
  const check = html.indexOf('const staged = await stagedInstall()');
  const importer = html.indexOf("demo = (await import('./demo/demo.js')).default");
  assert.notEqual(check, -1);
  assert.notEqual(importer, -1);
  assert.ok(check < importer);
  assert.match(html, /if \(staged\.ok\) \{[\s\S]*?stagedReady = true/);
  assert.match(html, /Import a ZIP of your own copy of Celeste/);
  assert.doesNotMatch(html, /installFromPrivateSource|PRIVATE_INSTALL_CONFIG|CELESTE_PRIVATE_ARCHIVE/);
});
