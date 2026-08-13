/**
 * The rule that cost four builds: never hand a typed array to `scheduleOnRN`.
 *
 * Worklets serialise arguments by inspecting their type. An ArrayBuffer takes
 * a single memcpy (`SerializableArrayBuffer`). A Uint8Array is *not* an
 * ArrayBuffer, so it falls through to the generic object case, which walks
 * `getPropertyNames` - every index of the array becomes its own allocated
 * string key. A 960x540 BGRA frame is 2,073,600 elements, so one frame turned
 * into millions of allocations, and iOS killed the app for memory within
 * seconds of opening the camera, with or without a card in view.
 *
 * The fix is invisible in a diff - `frame.getPixelBuffer()` instead of
 * `new Uint8Array(frame.getPixelBuffer())` - and nothing in the type system
 * objects to the slow one, so it is guarded here instead.
 *
 *   node --experimental-strip-types apps/mobile/test/worklet-payload.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'src', 'ScannerScreen.tsx'), 'utf8');

/**
 * Comments are stripped first - this file documents the mistake it guards
 * against, and prose describing the wrong call must not read as the wrong call.
 */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

let failed = 0;

/** Every `scheduleOnRN(...)` call in the file, arguments included. */
function scheduleCalls(text: string): string[] {
  const calls: string[] = [];
  const needle = 'scheduleOnRN(';
  let at = text.indexOf(needle);
  while (at !== -1) {
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(text.slice(at, end + 1));
    at = text.indexOf(needle, end);
  }
  return calls;
}

const calls = scheduleCalls(source);

if (calls.length === 0) {
  console.log('FAIL  no scheduleOnRN call found - has the capture path moved?');
  failed++;
} else {
  console.log(`found ${calls.length} scheduleOnRN call(s)`);
}

const TYPED_ARRAY =
  /new\s+(Uint8|Uint8Clamped|Uint16|Uint32|Int8|Int16|Int32|Float32|Float64)Array/;

for (const call of calls) {
  const label = call.split('\n')[0].trim().slice(0, 58);
  if (TYPED_ARRAY.test(call)) {
    console.log(`FAIL  typed array passed to a worklet: ${label}`);
    failed++;
  } else {
    console.log(`OK   ${label}`);
  }
}

/*
 * A raw ArrayBuffer does not survive `scheduleOnRN` either, and fails silently
 * where the typed array failed loudly. The JavaScript half of the serialiser
 * walks arguments with `Object.entries`, which yields nothing for an
 * ArrayBuffer, so the frame arrived on the other side as an empty object -
 * "frame buffer is 0 bytes but rgb-bgra-8-bit at 1920x1080 ... needs 8294400".
 * Only the native serialiser understands ArrayBuffers, so it has to be called
 * before the hop.
 */
if (!/_createSerializable\(\s*\n?\s*frame\.getPixelBuffer\(\)/.test(source)) {
  console.log('FAIL  pixels are not serialised natively before crossing threads');
  failed++;
} else {
  console.log('OK   pixels serialised natively before crossing threads');
}

if (/scheduleOnRN\([^)]*frame\.getPixelBuffer\(\)/.test(source)) {
  console.log('FAIL  a bare ArrayBuffer is passed to scheduleOnRN - it arrives empty');
  failed++;
} else {
  console.log('OK   no bare ArrayBuffer passed to scheduleOnRN');
}

// A Frame holds a slot in a fixed camera buffer pool.
if (!/frame\.dispose\(\)/.test(source)) {
  console.log('FAIL  frame is never disposed - the camera pipeline will stall');
  failed++;
} else {
  console.log('OK   frame is disposed');
}

/*
 * Camera outputs are memoised on the identity of their options. An object
 * literal written inline builds a new native output - and a new native thread -
 * on every render, and the session never finishes configuring. This is what
 * made `capturePhoto()` reject with "PhotoOutput is not yet connected to the
 * CameraSession!" forever.
 */
if (/targetResolution:\s*\{/.test(source)) {
  console.log('FAIL  targetResolution is an inline literal - output rebuilds every render');
  failed++;
} else {
  console.log('OK   targetResolution is a stable reference');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
