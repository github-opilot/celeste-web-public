import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { verifyRuntime } from '../scripts/verify-runtime.mjs';

function frameworkFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'celeste-runtime-verify-'));
  writeFileSync(join(dir, 'dotnet.js'), '');
  writeFileSync(join(dir, 'dotnet.native.fixture.wasm0'), '');
  writeFileSync(join(dir, 'dotnet.runtime.fixture.js'), 'this.appendULeb(65535);');
  writeFileSync(
    join(dir, 'dotnet.native.fixture.js'),
    `var transferredCanvasNames=[".canvas"];
function emasm() { return runMainThreadEmAsm(code, sigPtr, argbuf, 1); }
function celesteAnnounceMainLoopStopped() {}
JSEvents.gamepadEvent = _malloc(1432);
stringToUTF8(e.id, eventStruct + 1304, 64);
var SDL_EmscriptenGamepadEvent = 0;

function SDL_GetEmscriptenGamepad(device_index) {
 if (typeof navigator != "undefined" && navigator.getGamepads) {
  return navigator.getGamepads()[device_index] || { id: "" };
 }
 if (!SDL_EmscriptenGamepadEvent) SDL_EmscriptenGamepadEvent = _malloc(1432);
 if (!SDL_EmscriptenGamepadEvent) return { id: "" };
 _emscripten_sample_gamepad_data();
 if (_emscripten_get_gamepad_status(device_index, SDL_EmscriptenGamepadEvent) != 0) {
  return { id: "" };
 }
 return { id: UTF8ToString(SDL_EmscriptenGamepadEvent + 1304, 64) };
}

function SDL_GetEmscriptenJoystickVendor(device_index) {
 let gamepad = navigator["getGamepads"]()[device_index];
 return gamepad.id;
}
function SDL_GetEmscriptenJoystickProduct(device_index) {
 let gamepad = navigator["getGamepads"]()[device_index];
 return gamepad.id;
}
function SDL_IsEmscriptenJoystickXInput(device_index) {
 let gamepad = navigator["getGamepads"]()[device_index];
 return gamepad.id;
}
function registerGamepadEventCallback() {
  fillGamepadEventData(gamepadEvent, e["gamepad"]);
  if (targetThread) __emscripten_run_callback_on_thread(targetThread, callbackfunc, eventTypeId, gamepadEvent, userData);
}
function _emscripten_set_gamepadconnected_callback_on_thread(userData, useCapture, callbackfunc, targetThread) {
 if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(25, 0, 1, userData, useCapture, callbackfunc, targetThread);
 if (_emscripten_sample_gamepad_data()) return -1;
 return registerGamepadEventCallback(2, userData, useCapture, callbackfunc, 26, "gamepadconnected", targetThread);
}
function _emscripten_set_gamepaddisconnected_callback_on_thread(userData, useCapture, callbackfunc, targetThread) {
 if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(26, 0, 1, userData, useCapture, callbackfunc, targetThread);
 if (_emscripten_sample_gamepad_data()) return -1;
 return registerGamepadEventCallback(2, userData, useCapture, callbackfunc, 27, "gamepaddisconnected", targetThread);
}
function _emscripten_sample_gamepad_data() {
 if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(18, 0, 1);
 try {
  if (navigator.getGamepads) return (JSEvents.lastGamepadState = navigator.getGamepads()) ? 0 : -1;
 } catch (e) {
  navigator.getGamepads = null;
 }
 return -1;
}
function _emscripten_get_gamepad_status(index, gamepadState) {
 if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(13, 0, 1, index, gamepadState);
 gamepadState >>>= 0;
 if (index < 0 || index >= JSEvents.lastGamepadState.length) return -5;
 if (!JSEvents.lastGamepadState[index]) return -7;
 fillGamepadEventData(gamepadState, JSEvents.lastGamepadState[index]);
 return 0;
}
`,
  );
  return dir;
}

test('verify-runtime applies and verifies the complete gamepad bridge and diagnostics', (t) => {
  const dir = frameworkFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const first = verifyRuntime(dir);
  assert.equal(first.ok, true, first.problems.join('\n'));
  assert.ok(first.fixes.some((fix) => fix.includes('worker-side gamepad reader')));
  assert.ok(first.fixes.some((fix) => fix.includes('worker boundary')));

  const patched = readFileSync(join(dir, 'dotnet.native.fixture.js'), 'utf8');
  assert.equal((patched.match(/let gamepad = SDL_GetEmscriptenGamepad\(device_index\);/g) ?? []).length, 3);
  assert.equal((patched.match(/let gamepad = navigator\["getGamepads"\]\(\)\[device_index\];/g) ?? []).length, 0);
  assert.match(patched, /SDL_LogGamepadEvent\(eventTypeString, e\["gamepad"\], targetThread\)/);
  assert.match(patched, /SDL_LogIgnoredGamepad\(e\["gamepad"\], e\["gamepad"\]\.index, eventTypeString\)/);
  assert.match(patched, /SDL_FilterGamepadState\(navigator\.getGamepads\(\)\)\[device_index\]/);
  assert.match(patched, /window\.addEventListener\("gamepadconnected"/);
  assert.match(patched, /SDL_LogGamepadRegistration\("gamepadconnected", result, targetThread\)/);
  assert.match(patched, /SDL_GamepadLog\("info", "runtime gamepad bridge initialized; waiting for SDL polling"\)/);
  assert.match(patched, /SDL_LogGamepadPoll\(JSEvents\.lastGamepadState, true\)/);
  assert.match(patched, /SDL_LogGamepadStatusCopy\(index, JSEvents\.lastGamepadState\[index\]\)/);

  const second = verifyRuntime(dir);
  assert.equal(second.ok, true, second.problems.join('\n'));
  assert.deepEqual(second.fixes, [], 'a second verification should be idempotent');
});

test('small phantom devices are ignored while Xbox and unmapped PlayStation pads keep their slots', (t) => {
  const dir = frameworkFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = verifyRuntime(dir);
  assert.equal(result.ok, true, result.problems.join('\n'));

  const patched = readFileSync(join(dir, 'dotnet.native.fixture.js'), 'utf8');
  const start = patched.indexOf('var SDL_GamepadDiagnosticIgnored');
  const end = patched.indexOf('function SDL_GamepadInput(gamepad)', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const ignored = [];
  const context = {
    console: { info: (message, details) => ignored.push({ message, details }) },
  };
  vm.runInNewContext(
    `${patched.slice(start, end)}\nglobalThis.filterGamepads = SDL_FilterGamepadState;\nglobalThis.shouldIgnoreGamepadEvent = SDL_ShouldIgnoreGamepadEvent;`,
    context,
  );

  const jabra = {
    index: 0,
    id: 'Jabra Link 370 (Vendor: 0b0e Product: 245e)',
    mapping: '',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })),
  };
  const xbox = {
    index: 1,
    id: 'Xbox 360 Controller',
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 15 }, () => ({ pressed: false, value: 0 })),
  };
  const playstation = {
    index: 2,
    id: 'Wireless Controller',
    mapping: '',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };

  const filtered = context.filterGamepads([jabra, xbox, playstation]);
  assert.equal(filtered.length, 3, 'the browser index range stays the same');
  assert.equal(filtered[0], null, 'a small unmapped headset device is skipped even with buttons and axes');
  assert.equal(filtered[1].id, xbox.id, 'Xbox remains at its original browser slot');
  assert.equal(filtered[2].id, playstation.id, 'PlayStation remains at its original browser slot');
  assert.equal(context.shouldIgnoreGamepadEvent('gamepadconnected', xbox), false);
  assert.equal(context.shouldIgnoreGamepadEvent('gamepaddisconnected', xbox), false);
  assert.equal(context.shouldIgnoreGamepadEvent('gamepaddisconnected', jabra), true);
  assert.equal(
    ignored.filter(({ message }) => message.includes('ignoring browser device')).length,
    1,
    'the skipped device is reported once',
  );
});

test('verify-runtime rejects a partially applied gamepad patch', (t) => {
  const dir = frameworkFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const first = verifyRuntime(dir);
  assert.equal(first.ok, true, first.problems.join('\n'));
  const nativePath = join(dir, 'dotnet.native.fixture.js');
  const partial = readFileSync(nativePath, 'utf8').replace(
    'let gamepad = SDL_GetEmscriptenGamepad(device_index);',
    'let gamepad = navigator["getGamepads"]()[device_index];',
  );
  writeFileSync(nativePath, partial);

  const result = verifyRuntime(dir);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /gamepad patch is incomplete/);
});
