/**
 * Writing out a read that failed, so it can be measured instead of guessed at.
 *
 * Four hypotheses were tested against the synthetic harnesses and each one was
 * either fixed or refuted: glare (fixed by voting across frames), crop
 * misalignment (fixed by searching it), the index's own ceiling for Special
 * Illustration Rares (refuted - they are the most distinctive cards there are),
 * and the detector's working resolution (refuted - worth 5 bits for 2 to 5
 * times the frame cost). The device still reports distances around 230 where
 * anything reproducible on a desk sits near 80.
 *
 * That gap is compound and real, and the record for guessing at it is poor. A
 * single rectified card, exactly as the engine saw it, settles more than
 * another sweep - it can be dropped straight into the same harnesses and
 * compared against the reference image of the card it should have matched.
 *
 * The file is deliberately raw: no encoder, no dependency, and nothing lossy
 * between the pixels the descriptor read and the pixels that come out.
 */

import { Share } from 'react-native';
import { File, Paths } from 'expo-file-system';

export interface CapturedRead {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Whatever the engine believed at the time, for context. */
  note: Record<string, unknown>;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without Buffer, which React Native does not have. */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/**
 * Drop the alpha channel before encoding.
 *
 * It is 255 everywhere and it is a quarter of the file. 240x336 RGB is 236 KB,
 * which is 315 KB of base64 - small enough to email, which is the whole point.
 */
function rgbOnly(rgba: Uint8ClampedArray): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0, o = 0; i < n; i++) {
    out[o++] = rgba[i * 4];
    out[o++] = rgba[i * 4 + 1];
    out[o++] = rgba[i * 4 + 2];
  }
  return out;
}

/**
 * Write the capture next to the collection and open the share sheet.
 *
 * Sharing rather than uploading: there is no server in this app and adding one
 * for a diagnostic would be the wrong trade. The file goes wherever the user
 * sends it.
 */
export async function shareCapture(read: CapturedRead, at: number): Promise<string> {
  const payload = {
    format: 'bulksift-capture-1',
    width: read.width,
    height: read.height,
    pixels: 'rgb8',
    capturedAt: new Date(at).toISOString(),
    note: read.note,
    data: toBase64(rgbOnly(read.rgba)),
  };
  const name = `bulksift-capture-${at}.json`;
  const f = new File(Paths.document, name);
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(payload));
  await Share.share({ title: name, url: f.uri, message: name });
  return name;
}
