#!/usr/bin/env node
// Check that the installed runtime carries the modifications the SDK relies on.
//
// The loader's build rewrites several things in the runtime glue after .NET
// emits it. They are not cosmetic — the SDK is written against every one, and
// a runtime without them fails in ways that look like SDK bugs (a black canvas,
// a jiterpreter that refuses to grow, a 100 MB request that no CDN will serve).
// So they are asserted here, at build time, where the message can say what is
// actually wrong.
//
//   usage: verify-runtime.mjs <_framework dir> [--fix]
//
// `--fix` applies the safe, idempotent glue rewrites for runtimes built from
// source outside the upstream Makefile.
//
// On top of those, this script applies its own gamepad worker bridge and
// diagnostic hooks. Upstream will never ship them, so they are applied on every
// build and then asserted in the generated glue.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyRuntime(dir, { fix = false } = {}) {
  if (!dir) throw new Error('usage: verify-runtime.mjs <_framework dir> [--fix]');

const files = readdirSync(dir);
const find = (pattern) => files.filter((name) => pattern.test(name));

const problems = [];
const fixes = [];
/** Problems `--fix` would have taken care of, so the report can say so. */
let fixable = 0;

// -------------------------------------------------------------------- files --

if (!files.includes('dotnet.js')) {
  problems.push('dotnet.js is missing — this is not a .NET WebAssembly runtime directory');
}

const nativeGlue = find(/^dotnet\.native\..*\.js$/);
const runtimeGlue = find(/^dotnet\.runtime\..*\.js$/);
if (nativeGlue.length === 0) problems.push('dotnet.native.*.js is missing');
if (runtimeGlue.length === 0) problems.push('dotnet.runtime.*.js is missing');

// The binary is published in 20 MB pieces; `splitWasmLoader` reassembles them.
// An unsplit dotnet.native.wasm means the SDK's loader will 404 on piece 0.
const pieces = find(/^dotnet\.native\..*\.wasm\d+$/);
const whole = find(/^dotnet\.native\..*\.wasm$/);
if (find(/^dotnet\.native\..*\.wasm0$/).length === 0) {
  problems.push(
    whole.length > 0
      ? `${whole[0]} was not split — the SDK fetches ${whole[0]}0, ${whole[0]}1, … ` +
        '(upstream: `split -b20M -d -a1 dotnet.native.*.wasm dotnet.native.*.wasm`)'
      : 'no dotnet.native.*.wasm pieces found',
  );
}

// ------------------------------------------------------------------ patches --

const rewrite = (name, { probe, from, to, why }) => {
  const path = join(dir, name);
  const source = readFileSync(path, 'utf8');
  if (probe.test(source)) return;

  if (from.test(source)) {
    if (fix) {
      writeFileSync(path, source.replace(from, to));
      fixes.push(`${name}: ${why}`);
      return;
    }
    fixable++;
  }
  problems.push(`${name}: ${why}`);
};

/**
 * A rewrite this repository owns rather than one the upstream build is expected
 * to have made. Nothing upstream applies it, so there is no point asserting it:
 * it goes in on every build, guarded by `probe` so a second run is a no-op, and
 * fails the build if the code it rewrites has moved.
 */
const patch = (name, { probe, from, to, why }) => {
  const path = join(dir, name);
  const source = readFileSync(path, 'utf8');
  if (probe.test(source)) return;

  if (!from.test(source)) {
    problems.push(`${name}: cannot patch ${why} — the runtime code it rewrites has moved`);
    return;
  }

  writeFileSync(path, source.replace(from, to));
  fixes.push(`${name}: ${why}`);
};

/**
 * Gamepads, on the thread the game actually runs on.
 *
 * `navigator.getGamepads` exists on the window and nowhere else, so every
 * gamepad call SDL's emscripten joystick driver makes is proxied to the main
 * thread — `emscripten_sample_gamepad_data`, `emscripten_get_num_gamepads`,
 * `emscripten_get_gamepad_status`. Three helpers in that driver are not.
 * `SDL_GetEmscriptenJoystickVendor`, `…Product` and `SDL_IsEmscriptenJoystick-
 * XInput` are EM_JS, which runs on whichever thread called it, and the thread
 * that calls them is the deputy worker FNA's loop lives on. There, `navigator`
 * has no `getGamepads`, so all three throw — inside
 * `Emscripten_JoyStickConnected`, before it reaches `SDL_PrivateJoystickAdded`.
 * The pad is never added, and the game sees no controller at all however
 * healthy the browser's own gamepad events look.
 *
 * What those helpers want has already been proxied across, though: the pad's
 * `id` is a field of the `EmscriptenGamepadEvent` that the status call fills
 * in. So off the window, read it back out of that instead. SDL then derives the
 * same vendor and product it would have derived on the main thread, and its
 * mapping database matches the controller the way it does on the desktop.
 *
 * Some browsers also expose non-controller devices as gamepads. FNA assigns
 * the first SDL gamepad to PlayerIndex.One, so a small headset entry can take
 * that slot and leave Celeste polling the wrong device. Keep browser slot
 * numbers stable, but hide devices too small to match a full-size Xbox or
 * PlayStation layout from SDL's initial poll and connection events.
 *
 * Diagnostic hooks follow the same path: they report what the page can see,
 * whether SDL's browser event reaches its game thread, and whether controller
 * snapshots are copied into WebAssembly memory for SDL's joystick poll.
 * Analog input changes are logged at debug level to keep the regular console
 * readable.
 */
const patchGamepadHelpers = (name) => {
  let source = readFileSync(join(dir, name), 'utf8');

  // Struct size and the offset of its `id`, read off the glue's own writer
  // rather than hardcoded — emscripten has moved that layout before.
  const size = /JSEvents\.gamepadEvent = _malloc\((\d+)\)/.exec(source);
  const id = /stringToUTF8\(e\.id, eventStruct \+ (\d+), (\d+)\)/.exec(source);
  if (!size || !id) {
    problems.push(
      `${name}: cannot patch the gamepad helpers — EmscriptenGamepadEvent's layout ` +
        'is no longer readable out of the glue',
    );
    return;
  }

  // One event struct per thread, kept for the life of the runtime — the same
  // way `JSEvents.gamepadEvent` above it is allocated once and never freed.
  const reader = `
var SDL_EmscriptenGamepadEvent = 0;
var SDL_GamepadDiagnosticPolls = Object.create(null);
var SDL_GamepadDiagnosticCopies = Object.create(null);
var SDL_GamepadDiagnosticHelpers = Object.create(null);
var SDL_GamepadDiagnosticIgnored = Object.create(null);
var SDL_GamepadDiagnosticAnnounced = false;

function SDL_GamepadLog(level, message, details) {
 if (typeof console == "undefined") return;
 var log = console[level] || console.info;
 if (typeof log != "function") return;
 if (details === undefined) log.call(console, "[celeste/gamepad] " + message);
 else log.call(console, "[celeste/gamepad] " + message, details);
}
SDL_GamepadLog("info", "runtime gamepad bridge initialized; waiting for SDL polling");

// Xbox and PlayStation pads expose the usual full-size layout in the browser:
// at least twelve buttons and two stick axes. Some audio adapters appear as
// tiny unmapped Gamepads (the user's Jabra reports seven buttons), so merely
// checking for a non-empty buttons array is not enough. Do not require the
// browser's "standard" mapping: SDL can map PlayStation pads by their device ID.
function SDL_GamepadLooksLikeConsoleController(gamepad) {
 return !!(gamepad && gamepad.buttons && gamepad.buttons.length >= 12 && gamepad.axes && gamepad.axes.length >= 2);
}

function SDL_GamepadIgnoredKey(gamepad, slot) {
 var index = gamepad.index == null ? slot : gamepad.index;
 return String(index) + ":" + String(gamepad.id || "");
}

function SDL_LogIgnoredGamepad(gamepad, slot, source) {
 if (!gamepad || SDL_GamepadLooksLikeConsoleController(gamepad)) return;
 var index = gamepad.index == null ? slot : gamepad.index;
 var key = SDL_GamepadIgnoredKey(gamepad, slot);
 if (SDL_GamepadDiagnosticIgnored[key]) return;
 SDL_GamepadDiagnosticIgnored[key] = true;
 SDL_GamepadLog("info", "ignoring browser device with too few controls to be an Xbox/PlayStation-style controller", {
  index: index, id: gamepad.id, mapping: gamepad.mapping,
  axes: (gamepad.axes || []).length, buttons: (gamepad.buttons || []).length,
  requiredAxes: 2, requiredButtons: 12,
  source: source
 });
}

function SDL_ShouldIgnoreGamepadEvent(eventType, gamepad) {
 var key = SDL_GamepadIgnoredKey(gamepad, gamepad.index);
 if (eventType == "gamepaddisconnected") return !!SDL_GamepadDiagnosticIgnored[key];
 return !SDL_GamepadLooksLikeConsoleController(gamepad);
}

function SDL_FilterGamepadState(gamepads) {
 if (!gamepads) return gamepads;
 var filtered = Array.prototype.slice.call(gamepads);
 Array.prototype.forEach.call(filtered, function(gamepad, slot) {
  if (gamepad && !SDL_GamepadLooksLikeConsoleController(gamepad)) {
   SDL_LogIgnoredGamepad(gamepad, slot, "poll");
   filtered[slot] = null;
  }
 });
 return filtered;
}

function SDL_GamepadInput(gamepad) {
 var axes = Array.prototype.map.call(gamepad.axes || [], function(value) {
  value = Number(value) || 0;
  return Math.abs(value) < 0.05 ? 0 : Math.round(value * 10) / 10;
 });
 var buttons = [];
 Array.prototype.forEach.call(gamepad.buttons || [], function(button, index) {
  var value = typeof button == "number" ? button : Number(button && button.value) || 0;
  var pressed = typeof button == "object" && button ? button.pressed : value >= 0.5;
  if (pressed || value > 0.05) buttons.push({ index: index, value: Math.round(value * 100) / 100 });
 });
 return { axes: axes, buttons: buttons };
}

function SDL_GamepadSignature(gamepad) {
 return JSON.stringify(SDL_GamepadInput(gamepad));
}

function SDL_LogGamepadPoll(gamepads, supported, error) {
 if (!SDL_GamepadDiagnosticAnnounced) {
  SDL_GamepadDiagnosticAnnounced = true;
  if (!supported) {
   SDL_GamepadLog("warn", "the page cannot access navigator.getGamepads(); check browser support and page security settings");
  } else {
   SDL_GamepadLog("info", "Emscripten is polling the browser Gamepad API on the page thread", {
    visible: gamepads ? Array.prototype.filter.call(gamepads, function(gamepad) { return !!gamepad && gamepad.connected !== false; }).length : 0,
    slots: gamepads ? gamepads.length : 0,
    secureContext: typeof isSecureContext == "undefined" ? undefined : isSecureContext,
    crossOriginIsolated: typeof crossOriginIsolated == "undefined" ? undefined : crossOriginIsolated,
    focused: typeof document == "undefined" ? undefined : document.hasFocus(),
    visibilityState: typeof document == "undefined" ? undefined : document.visibilityState
   });
   if (!gamepads || !Array.prototype.some.call(gamepads, function(gamepad) { return !!gamepad && gamepad.connected !== false; })) {
    SDL_GamepadLog("info", "no controller is visible yet; focus this page, then press a controller button or move a stick once");
   }
  }
 }
 if (error) SDL_GamepadLog("warn", "navigator.getGamepads() threw while SDL was polling", { error: String(error) });
 if (!gamepads) return;

 var visible = Object.create(null);
 Array.prototype.forEach.call(gamepads, function(gamepad, slot) {
  if (!gamepad || gamepad.connected === false) return;
  var index = gamepad.index == null ? slot : gamepad.index;
  var key = String(index);
  visible[key] = true;
  var input = SDL_GamepadInput(gamepad);
  var signature = JSON.stringify(input);
  var previous = SDL_GamepadDiagnosticPolls[key];
  if (!previous || previous.id !== gamepad.id) {
   SDL_GamepadLog("info", "browser controller is visible to SDL's Emscripten poll", {
    index: index, id: gamepad.id, mapping: gamepad.mapping,
    axes: (gamepad.axes || []).length, buttons: (gamepad.buttons || []).length
   });
  }
  if (previous && previous.signature !== signature) {
   SDL_GamepadLog("debug", "browser input changed; current state", {
    index: index, id: gamepad.id, axes: input.axes, pressedOrActiveButtons: input.buttons
   });
  }
  SDL_GamepadDiagnosticPolls[key] = { id: gamepad.id, signature: signature };
 });

 Object.keys(SDL_GamepadDiagnosticPolls).forEach(function(key) {
  if (!visible[key]) {
   SDL_GamepadLog("info", "browser controller is no longer visible", { index: Number(key) });
   delete SDL_GamepadDiagnosticPolls[key];
   delete SDL_GamepadDiagnosticCopies[key];
   delete SDL_GamepadDiagnosticHelpers[key];
  }
 });
}

function SDL_LogGamepadStatusCopy(index, gamepad) {
 var key = String(index);
 var signature = SDL_GamepadSignature(gamepad);
 if (SDL_GamepadDiagnosticCopies[key] === signature) return;
 SDL_GamepadDiagnosticCopies[key] = signature;
 var input = SDL_GamepadInput(gamepad);
 SDL_GamepadLog("debug", "Emscripten copied a controller snapshot into WebAssembly memory for SDL's joystick poll", {
  index: index, id: gamepad.id, mapping: gamepad.mapping,
  axes: input.axes, pressedOrActiveButtons: input.buttons
 });
}

function SDL_LogGamepadStatusFailure(index, result) {
 var key = String(index) + ":" + String(result);
 if (SDL_GamepadDiagnosticCopies[key]) return;
 SDL_GamepadDiagnosticCopies[key] = true;
 SDL_GamepadLog("debug", "Emscripten could not read a controller snapshot for SDL", {
  index: index, result: result,
  meaning: result == -7 ? "no gamepad state in the page snapshot" : "index is outside the page snapshot"
 });
}

function SDL_LogGamepadEvent(eventType, gamepad, targetThread) {
 SDL_GamepadLog("info", "SDL received a browser gamepad event", {
  event: eventType, index: gamepad.index, id: gamepad.id,
  mapping: gamepad.mapping, targetThread: targetThread || "main thread"
 });
}

function SDL_LogGamepadRegistration(eventType, result, targetThread) {
 SDL_GamepadLog(result == 0 ? "info" : "warn", "SDL gamepad event listener registration", {
  event: eventType, result: result, targetThread: targetThread || "main thread"
 });
}

if (typeof window != "undefined" && window.addEventListener) {
 window.addEventListener("gamepadconnected", function(event) {
  var gamepad = event.gamepad;
  SDL_GamepadLog("info", "the browser dispatched gamepadconnected", {
   index: gamepad.index, id: gamepad.id, mapping: gamepad.mapping,
   axes: gamepad.axes.length, buttons: gamepad.buttons.length
  });
 });
 window.addEventListener("gamepaddisconnected", function(event) {
  SDL_GamepadLog("info", "the browser dispatched gamepaddisconnected", {
   index: event.gamepad.index, id: event.gamepad.id
  });
 });
}

function SDL_LogGamepadWorkerRead(index, gamepad, source) {
 var key = String(index);
 var signature = source + ":" + gamepad.id;
 if (SDL_GamepadDiagnosticHelpers[key] === signature) return;
 SDL_GamepadDiagnosticHelpers[key] = signature;
 SDL_GamepadLog("info", "SDL read controller identity in " + (ENVIRONMENT_IS_PTHREAD ? "a worker" : "the page thread"), {
  index: index, id: gamepad.id, source: source
 });
}

function SDL_GetEmscriptenGamepad(device_index) {
 if (typeof navigator != "undefined" && navigator.getGamepads) {
  try {
   var gamepad = SDL_FilterGamepadState(navigator.getGamepads())[device_index];
   if (gamepad) {
    SDL_LogGamepadWorkerRead(device_index, gamepad, "navigator.getGamepads()");
    return gamepad;
   }
  } catch (error) {
   SDL_GamepadLog("warn", "worker-side navigator.getGamepads() failed; asking the page thread through Emscripten", {
    index: device_index, error: String(error)
   });
  }
 }
 if (!SDL_EmscriptenGamepadEvent) SDL_EmscriptenGamepadEvent = _malloc(${size[1]});
 if (!SDL_EmscriptenGamepadEvent) {
  SDL_GamepadLog("error", "could not allocate EmscriptenGamepadEvent in the game thread", { index: device_index });
  return { id: "" };
 }
 _emscripten_sample_gamepad_data();
 var status = _emscripten_get_gamepad_status(device_index, SDL_EmscriptenGamepadEvent);
 if (status != 0) {
  SDL_LogGamepadStatusFailure(device_index, status);
  return { id: "" };
 }
 var gamepad = { id: UTF8ToString(SDL_EmscriptenGamepadEvent + ${id[1]}, ${id[2]}) };
 SDL_LogGamepadWorkerRead(device_index, gamepad, "Emscripten worker-to-page proxy");
 return gamepad;
}
`;

  // Replace our old reader as well as inserting it into an upstream runtime.
  // This lets existing cached builds pick up new diagnostics on the next run.
  if (!/function SDL_GamepadLog\(/.test(source)) {
    if (/function SDL_GetEmscriptenGamepad\(/.test(source)) {
      const oldReader = /var SDL_EmscriptenGamepadEvent = 0;\n\nfunction SDL_GetEmscriptenGamepad\([\s\S]*?\n}\n(?=\nfunction SDL_GetEmscriptenJoystickVendor\()/;
      if (!oldReader.test(source)) {
        problems.push(`${name}: cannot update the gamepad reader — its existing patch has moved`);
        return;
      }
      source = source.replace(oldReader, reader.trimEnd());
    } else {
      const anchor = /function SDL_GetEmscriptenJoystickVendor\(device_index\) \{/g;
      if ([...source.matchAll(anchor)].length !== 1) {
        problems.push(`${name}: cannot patch the gamepad helpers — SDL's joystick identity helper moved`);
        return;
      }
      source = source.replace(anchor, `${reader}\nfunction SDL_GetEmscriptenJoystickVendor(device_index) {`);
    }
    writeFileSync(join(dir, name), source);
    fixes.push(`${name}: the worker-side gamepad reader and diagnostics`);
  }

  // The three joystick identity helpers, and only those: SDL's rumble EM_ASM
  // reads navigator.getGamepads too, but it already runs on the page thread.
  source = readFileSync(join(dir, name), 'utf8');
  const workerReads = (source.match(/let gamepad = SDL_GetEmscriptenGamepad\(device_index\);/g) ?? []).length;
  const directReads = (source.match(/let gamepad = navigator\["getGamepads"\]\(\)\[device_index\];/g) ?? []).length;
  if (workerReads === 0 && directReads === 3) {
    source = source.replace(
      /let gamepad = navigator\["getGamepads"\]\(\)\[device_index\];/g,
      'let gamepad = SDL_GetEmscriptenGamepad(device_index);',
    );
    writeFileSync(join(dir, name), source);
    fixes.push(`${name}: the joystick helpers reading Gamepad API data across the worker boundary`);
  } else if (workerReads !== 3 || directReads !== 0) {
    problems.push(
      `${name}: gamepad patch is incomplete — expected 3 worker-side identity reads and 0 direct navigator reads, found ${workerReads} and ${directReads}`,
    );
    return;
  }

  const filterStart = reader.indexOf('function SDL_GamepadLooksLikeConsoleController(gamepad)');
  const filterEnd = reader.indexOf('function SDL_GamepadInput(gamepad)', filterStart);
  const controllerFilter = reader.slice(filterStart, filterEnd);
  const logStart = reader.indexOf('function SDL_GamepadLog(level, message, details)');
  const logEnd = reader.indexOf('\n}\n', logStart) + 3;
  const logger = reader.slice(logStart, logEnd);

  // A startup marker distinguishes a stale runtime from a live runtime whose
  // SDL poll or callback path is not reaching the bridge.
  patch(name, {
    probe: /SDL_GamepadLog\("info", "runtime gamepad bridge initialized; waiting for SDL polling"\)/,
    from: /function SDL_GamepadLog\(level, message, details\) \{[\s\S]*?\n\}/,
    to: `${logger}\nSDL_GamepadLog("info", "runtime gamepad bridge initialized; waiting for SDL polling");`,
    why: 'the gamepad bridge startup diagnostic',
  });

  // Upgrade already-patched runtimes too. Earlier versions only rejected a
  // device when its buttons array was empty; audio adapters can expose a small
  // non-empty array and still steal FNA's first player slot.
  patch(name, {
    probe: /function SDL_GamepadLooksLikeConsoleController\(gamepad\)/,
    from: /function SDL_GamepadHasButtons\(gamepad\) \{[\s\S]*?\nfunction SDL_GamepadInput\(gamepad\) \{/,
    to: `${controllerFilter}function SDL_GamepadInput(gamepad) {`,
    why: 'the Xbox/PlayStation capability filter for small phantom browser devices',
  });

  patch(name, {
    probe: /SDL_FilterGamepadState\(navigator\.getGamepads\(\)\)\[device_index\]/,
    from: /navigator\.getGamepads\(\)\[device_index\]/,
    to: 'SDL_FilterGamepadState(navigator.getGamepads())[device_index]',
    why: 'the worker identity lookup using the filtered browser controller slots',
  });

  patch(name, {
    probe: /if \(SDL_ShouldIgnoreGamepadEvent\(eventTypeString, e\["gamepad"\]\)\) \{\n   SDL_LogIgnoredGamepad\(e\["gamepad"\], e\["gamepad"\]\.index, eventTypeString\);\n   return;\n  \}\n  var gamepadEvent = targetThread/,
    from: /(?:var gamepadEvent = targetThread \? _malloc\(1432\) : JSEvents\.gamepadEvent;\n  )?(?:if \(!SDL_GamepadHasButtons\(e\["gamepad"\]\)\) \{[^\n]*\}\n  )?(?:if \(SDL_ShouldIgnoreGamepadEvent\(eventTypeString, e\["gamepad"\]\)\) \{[^\n]*\}\n  )?fillGamepadEventData\(gamepadEvent, e\["gamepad"\]\);\n  (?:SDL_LogGamepadEvent\(eventTypeString, e\["gamepad"\], targetThread\);\n  )?if \(targetThread\)/,
    to: 'if (SDL_ShouldIgnoreGamepadEvent(eventTypeString, e["gamepad"])) {\n   SDL_LogIgnoredGamepad(e["gamepad"], e["gamepad"].index, eventTypeString);\n   return;\n  }\n  var gamepadEvent = targetThread ? _malloc(1432) : JSEvents.gamepadEvent;\n  fillGamepadEventData(gamepadEvent, e["gamepad"]);\n  SDL_LogGamepadEvent(eventTypeString, e["gamepad"], targetThread);\n  if (targetThread)',
    why: 'the browser-to-SDL gamepad event diagnostics and small-device filter',
  });

  patch(name, {
    probe: /SDL_LogGamepadRegistration\("gamepadconnected", result, targetThread\)/,
    from: /if \(_emscripten_sample_gamepad_data\(\)\) return -1;\n return registerGamepadEventCallback\(2, userData, useCapture, callbackfunc, 26, "gamepadconnected", targetThread\);/,
    to: 'if (_emscripten_sample_gamepad_data()) { SDL_GamepadLog("warn", "SDL could not register gamepadconnected because its initial page-thread sample failed"); SDL_LogGamepadRegistration("gamepadconnected", -1, targetThread); return -1; }\n var result = registerGamepadEventCallback(2, userData, useCapture, callbackfunc, 26, "gamepadconnected", targetThread);\n SDL_LogGamepadRegistration("gamepadconnected", result, targetThread);\n return result;',
    why: 'the SDL gamepad connection-listener registration diagnostics',
  });

  patch(name, {
    probe: /SDL_LogGamepadRegistration\("gamepaddisconnected", result, targetThread\)/,
    from: /if \(_emscripten_sample_gamepad_data\(\)\) return -1;\n return registerGamepadEventCallback\(2, userData, useCapture, callbackfunc, 27, "gamepaddisconnected", targetThread\);/,
    to: 'if (_emscripten_sample_gamepad_data()) { SDL_GamepadLog("warn", "SDL could not register gamepaddisconnected because its initial page-thread sample failed"); SDL_LogGamepadRegistration("gamepaddisconnected", -1, targetThread); return -1; }\n var result = registerGamepadEventCallback(2, userData, useCapture, callbackfunc, 27, "gamepaddisconnected", targetThread);\n SDL_LogGamepadRegistration("gamepaddisconnected", result, targetThread);\n return result;',
    why: 'the SDL gamepad disconnection-listener registration diagnostics',
  });

  patch(name, {
    probe: /SDL_LogGamepadPoll\(JSEvents\.lastGamepadState, true\)/,
    from: /if \(navigator\.getGamepads\) return \(JSEvents\.lastGamepadState = navigator\.getGamepads\(\)\) \? 0 : -1;/,
    to: `if (navigator.getGamepads) {
   JSEvents.lastGamepadState = navigator.getGamepads();
   SDL_LogGamepadPoll(JSEvents.lastGamepadState, true);
   return JSEvents.lastGamepadState ? 0 : -1;
  }
  SDL_LogGamepadPoll(null, false);`,
    why: 'the browser Gamepad API availability and input-state diagnostics',
  });

  patch(name, {
    probe: /JSEvents\.lastGamepadState = SDL_FilterGamepadState\(navigator\.getGamepads\(\)\)/,
    from: /JSEvents\.lastGamepadState = navigator\.getGamepads\(\);/,
    to: 'JSEvents.lastGamepadState = SDL_FilterGamepadState(navigator.getGamepads());',
    why: 'filtering empty browser devices while preserving their slot numbers',
  });

  patch(name, {
    probe: /SDL_LogGamepadPoll\(null, false, e\)/,
    from: /} catch \(e\) {\n  navigator\.getGamepads = null;\n }/,
    to: '} catch (e) {\n  SDL_LogGamepadPoll(null, false, e);\n  navigator.getGamepads = null;\n }',
    why: 'the Gamepad API exception diagnostics',
  });

  patch(name, {
    probe: /SDL_LogGamepadStatusCopy\(index, JSEvents\.lastGamepadState\[index\]\)/,
    from: /fillGamepadEventData\(gamepadState, JSEvents\.lastGamepadState\[index\]\);\n return 0;/,
    to: 'fillGamepadEventData(gamepadState, JSEvents.lastGamepadState[index]);\n SDL_LogGamepadStatusCopy(index, JSEvents.lastGamepadState[index]);\n return 0;',
    why: 'the controller snapshot copied into WebAssembly for SDL polling',
  });

  patch(name, {
    probe: /SDL_LogGamepadStatusFailure\(index, -5\)/,
    from: /if \(index < 0 \|\| index >= JSEvents\.lastGamepadState\.length\) return -5;/,
    to: 'if (index < 0 || index >= JSEvents.lastGamepadState.length) { SDL_LogGamepadStatusFailure(index, -5); return -5; }',
    why: 'the invalid gamepad index diagnostics',
  });

  patch(name, {
    probe: /SDL_LogGamepadStatusFailure\(index, -7\)/,
    from: /if \(!JSEvents\.lastGamepadState\[index\]\) return -7;/,
    to: 'if (!JSEvents.lastGamepadState[index]) { SDL_LogGamepadStatusFailure(index, -7); return -7; }',
    why: 'the missing gamepad snapshot diagnostics',
  });

  const verified = readFileSync(join(dir, name), 'utf8');
  const required = [
    ['worker reader', /function SDL_GetEmscriptenGamepad\(/],
    ['startup diagnostic', /SDL_GamepadLog\("info", "runtime gamepad bridge initialized; waiting for SDL polling"\)/],
    ['Xbox/PlayStation capability filter', /function SDL_GamepadLooksLikeConsoleController\(gamepad\)/],
    ['slot-preserving gamepad filter', /function SDL_FilterGamepadState\(gamepads\)/],
    ['filtered worker identity lookup', /SDL_FilterGamepadState\(navigator\.getGamepads\(\)\)\[device_index\]/],
    ['small-device event filter', /SDL_ShouldIgnoreGamepadEvent\(eventTypeString, e\["gamepad"\]\)/],
    ['slot-preserving small-device poll', /SDL_FilterGamepadState\(navigator\.getGamepads\(\)\)/],
    ['page poll diagnostics', /SDL_LogGamepadPoll\(JSEvents\.lastGamepadState, true\)/],
    ['browser gamepad events', /window\.addEventListener\("gamepadconnected"/],
    ['browser disconnect events', /window\.addEventListener\("gamepaddisconnected"/],
    ['SDL event registration', /SDL_LogGamepadRegistration\("gamepadconnected", result, targetThread\)/],
    ['SDL disconnection registration', /SDL_LogGamepadRegistration\("gamepaddisconnected", result, targetThread\)/],
    ['browser event diagnostics', /SDL_LogGamepadEvent\(eventTypeString, e\["gamepad"\], targetThread\)/],
    ['WebAssembly snapshot diagnostics', /SDL_LogGamepadStatusCopy\(index, JSEvents\.lastGamepadState\[index\]\)/],
    ['invalid index diagnostics', /SDL_LogGamepadStatusFailure\(index, -5\)/],
    ['missing snapshot diagnostics', /SDL_LogGamepadStatusFailure\(index, -7\)/],
  ];
  for (const [label, probe] of required) {
    if (!probe.test(verified)) problems.push(`${name}: gamepad patch is incomplete — ${label} is missing`);
  }
};

/**
 * Tell the page when the game's main loop stops.
 *
 * FNA does not return from `Game.Run()` on this platform. `RunLoop()` sees
 * `NeedsPlatformMainLoop()` and hands control to `emscripten_set_main_loop(cb,
 * 0, 1)`, whose third argument makes the glue `throw "unwind"` — the C stack is
 * discarded on the way in and nothing after that call ever runs. So
 * `CelesteLoader.MainLoop()`, which the SDK awaits for exactly this, is a
 * promise that never settles: quitting the game leaves the last (black) frame
 * on the canvas, FMOD still playing on its own thread, and the host with no way
 * to know the game is gone. Upstream's frontend awaits the same promise and has
 * the same hole.
 *
 * What does happen on quit is `emscripten_cancel_main_loop()`, from FNA's own
 * emscripten iteration callback the moment `RunApplication` goes false. That is
 * the signal, and this puts it on a channel the page can hear.
 *
 * A BroadcastChannel rather than anything of emscripten's own: this runs on the
 * deputy worker the loop lives on, which shares no scope with the page, and the
 * proxying the glue does have is for C functions registered at link time.
 * `EXIT_CHANNEL` in celeste.sdk.ts is the other end.
 */
const patchExitSignal = (name) => {
  patch(name, {
    probe: /celesteAnnounceMainLoopStopped/,
    from: /var _emscripten_cancel_main_loop = \(\) => \{\n Browser\.mainLoop\.pause\(\);\n Browser\.mainLoop\.func = null;\n\};/,
    to: `function celesteAnnounceMainLoopStopped() {
 try {
  var channel = new BroadcastChannel("celeste-wasm:runtime");
  channel.postMessage({ type: "mainloop-stopped" });
  channel.close();
 } catch (e) {}
}

var _emscripten_cancel_main_loop = () => {
 Browser.mainLoop.pause();
 Browser.mainLoop.func = null;
 celesteAnnounceMainLoopStopped();
};`,
    why: 'the main-loop-stopped signal the SDK turns into an exit event',
  });
};

for (const name of nativeGlue) {
  // The canvas is transferred to the worker the renderer runs on, selected by
  // CSS class. `CANVAS_CLASS` in celeste.sdk.ts is the other half of this.
  rewrite(name, {
    probe: /transferredCanvasNames\s*=\s*\[\s*["']\.canvas["']\s*\]/,
    from: /var offscreenCanvases ?= ?\{\};/,
    to: 'var offscreenCanvases={};if(globalThis.window&&!window.TRANSFERRED_CANVAS){transferredCanvasNames=[".canvas"];window.TRANSFERRED_CANVAS=true;}',
    why: 'the canvas is not registered for transfer to the render worker (the game would draw nowhere)',
  });

  // EM_ASM bodies have to run on the main thread; on the deputy thread the DOM
  // calls inside them throw.
  rewrite(name, {
    probe: /runMainThreadEmAsm\(code, sigPtr, argbuf, 1\)/,
    from: /return runEmAsmFunction\(code, sigPtr, argbuf\);/,
    to: 'return runMainThreadEmAsm(code, sigPtr, argbuf, 1);',
    why: 'EM_ASM is not proxied to the main thread',
  });

  patchGamepadHelpers(name);
  patchExitSignal(name);
}

for (const name of runtimeGlue) {
  // The jiterpreter's wasm module table is capped at 32768 entries by default;
  // Celeste plus Everest plus a mod pack needs the full 16-bit range.
  rewrite(name, {
    probe: /this\.appendULeb\(65535\)/,
    from: /this\.appendULeb\(32768\)/,
    to: 'this.appendULeb(65535)',
    why: 'the jiterpreter table limit was not raised to 65535',
  });
}

// ------------------------------------------------------------------- report --

  return {
    ok: problems.length === 0,
    problems,
    fixes,
    fixable,
    fileCount: files.length,
    wasmPieceCount: pieces.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: verify-runtime.mjs <_framework dir> [--fix]');
    process.exitCode = 1;
  } else {
    const result = verifyRuntime(dir, { fix: flags.includes('--fix') });
    for (const applied of result.fixes) console.log(`[verify-runtime] fixed ${applied}`);
    if (result.problems.length > 0) {
      console.error('[verify-runtime] this runtime is not usable by the SDK:');
      for (const problem of result.problems) console.error(`  - ${problem}`);
      if (result.fixable > 0) {
        console.error('\nSome of these can be applied automatically: re-run with --fix.');
      }
      process.exitCode = 1;
    } else {
      console.log(
        `[verify-runtime] ok — ${result.fileCount} files, ${result.wasmPieceCount} wasm pieces, ` +
          'gamepad worker bridge and diagnostics verified',
      );
    }
  }
}
