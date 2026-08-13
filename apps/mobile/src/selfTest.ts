/**
 * On-device engine self-test.
 *
 * Everything except VisionCamera can be verified without a camera: reading the
 * 1.9 MB binary index out of an asset, expanding the compact catalogue,
 * constructing the Scanner, and running detection + matching at whatever speed
 * this phone manages. Those are the parts most likely to behave differently
 * from the desktop browser, so they get checked with real frames rather than
 * assumed to work.
 *
 * Dev only - the fixture is gitignored and this is called behind __DEV__.
 */

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import {
  CANON_H,
  CANON_W,
  describe as describeCard,
  detectCard,
  rectify,
  rotate180,
  type Scanner,
} from '@bulksift/core';

const FRAMES_ASSET = require('../assets/dev/testframes.bin');
// Metro hands back the parsed object for .json requires.
const FRAMES_META = require('../assets/dev/testframes.json');

export interface SelfTestResult {
  total: number;
  correct: number;
  lines: string[];
}

function base64ToBytes(b64: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < table.length; i++) lookup[table.charCodeAt(i)] = i;
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    buffer = (buffer << 6) | lookup[b64.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

export async function runSelfTest(scanner: Scanner): Promise<SelfTestResult> {
  const meta = FRAMES_META as {
    width: number;
    height: number;
    channels: 3 | 4;
    count: number;
    frames: Array<{ id: string; name: string; set: string }>;
  };

  const asset = Asset.fromModule(FRAMES_ASSET);
  await asset.downloadAsync();
  const bytes = base64ToBytes(
    await FileSystem.readAsStringAsync(asset.localUri as string, {
      encoding: FileSystem.EncodingType.Base64,
    }),
  );

  const frameBytes = meta.width * meta.height * meta.channels;
  const lines: string[] = [];
  let correct = 0;
  let tDetect = 0;
  let tHash = 0;
  let tSearch = 0;

  for (let i = 0; i < meta.count; i++) {
    const want = meta.frames[i];
    const view = new Uint8Array(bytes.buffer, i * frameBytes, frameBytes);
    const t0 = Date.now();
    const hit = scanner.identify(view, meta.width, meta.height, meta.channels);
    const ms = Date.now() - t0;

    if (!hit) {
      lines.push(`MISS  ${want.name} (${want.set})  no card found  ${ms} ms`);
      continue;
    }
    const ok = hit.card.i === want.id;
    if (ok) correct++;
    lines.push(
      `${ok ? 'OK  ' : 'WRONG'} ${hit.card.n} (${hit.card.S})` +
      `${ok ? '' : ` — expected ${want.name} (${want.set})`}` +
      `  $${hit.topMarket?.toFixed(2) ?? '—'}  d=${hit.distance}  ${ms} ms`,
    );

    // Repeat the same work stage by stage. Knowing whether the time is in
    // detection, hashing or the 20k-row scan is the difference between
    // optimising the right thing and guessing.
    let t = Date.now();
    const det = detectCard(view, meta.width, meta.height, { channels: meta.channels });
    tDetect += Date.now() - t;
    if (!det) continue;

    t = Date.now();
    const up = rectify(view, meta.width, meta.height, det.quad, CANON_W, CANON_H, meta.channels);
    const qa = describeCard(up);
    const qb = describeCard(rotate180(up, CANON_W, CANON_H));
    tHash += Date.now() - t;

    t = Date.now();
    scanner.searchFor(qa);
    scanner.searchFor(qb);
    tSearch += Date.now() - t;
  }

  const n = Math.max(meta.count, 1);
  lines.push(
    `stages: detect ${(tDetect / n).toFixed(0)} ms · ` +
    `rectify+hash ${(tHash / n).toFixed(0)} ms · ` +
    `search x2 ${(tSearch / n).toFixed(0)} ms`,
  );

  return { total: meta.count, correct, lines };
}
