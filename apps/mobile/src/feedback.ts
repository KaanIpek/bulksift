/**
 * The sound and the tap when a card lands.
 *
 * A bulk session is done looking at the cards, not at the phone - the whole
 * point of propping it up is that both hands are free for the pile. So the
 * confirmation has to be audible, or the only way to know a card registered is
 * to stop and look, which is the thing this app exists to avoid.
 *
 * Both files are synthesised by `tools/make_sounds.py` rather than downloaded,
 * so there is no licence question in a paid app over 300 milliseconds of audio.
 *
 * Loaded lazily and never awaited by the scanner: a frame thread that has 33 ms
 * to recognise a card must not wait on an audio session.
 */

import { Platform } from 'react-native';

import { audioSdk, hapticsSdk } from './native';
import type { Pile } from './sort';

type Player = { play: () => void; seekTo: (s: number) => Promise<void> | void };

let scan: Player | null = null;
let check: Player | null = null;
let bulk: Player | null = null;
let pull: Player | null = null;
let tried = false;
let enabled = true;

/** Turn the sound off. The haptic stays - it is silent and it is the point. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function soundEnabled(): boolean {
  return enabled;
}

function load(): void {
  if (tried) return;
  tried = true;
  const audio = audioSdk<{
    createAudioPlayer: (src: unknown) => Player;
    setAudioModeAsync: (m: Record<string, unknown>) => Promise<void>;
  }>();
  if (!audio) return;
  try {
    /*
     * Mix with whatever else is playing, and ignore the ring switch.
     *
     * Someone sorting a box is very likely listening to something, and an app
     * that stops their music to go "ka-ching" is an app they turn the sound off
     * in. `playsInSilentMode` is deliberate too: the sound IS the feedback, so
     * it should behave like a camera shutter rather than like media.
     */
    void audio.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
    scan = audio.createAudioPlayer(require('../assets/sound/scan.wav'));
    check = audio.createAudioPlayer(require('../assets/sound/check.wav'));
    bulk = audio.createAudioPlayer(require('../assets/sound/bulk.wav'));
    pull = audio.createAudioPlayer(require('../assets/sound/pull.wav'));
  } catch {
    scan = null;
    check = null;
    bulk = null;
    pull = null;
  }
}

function tap(kind: 'light' | 'warn' | 'success'): void {
  if (Platform.OS !== 'ios') return;
  const h = hapticsSdk<{
    impactAsync: (s: string) => Promise<void>;
    notificationAsync: (t: string) => Promise<void>;
    ImpactFeedbackStyle: Record<string, string>;
    NotificationFeedbackType: Record<string, string>;
  }>();
  if (!h) return;
  try {
    if (kind === 'warn') void h.notificationAsync(h.NotificationFeedbackType.Warning);
    else if (kind === 'success') void h.notificationAsync(h.NotificationFeedbackType.Success);
    else void h.impactAsync(h.ImpactFeedbackStyle.Light);
  } catch { /* a phone that will not buzz is not a problem worth reporting */ }
}

/**
 * A card landed.
 *
 * `sure` is false for a read the app wants a human to confirm; it gets the
 * quieter tone, because it is not a failure - the card was found and only the
 * price is ambiguous - but it should not sound identical to a clean hit.
 */
export function cardScanned(sure: boolean, pile: Pile | null = null): void {
  load();
  /*
   * With sorting on, the pile decides the cue and `sure` does not.
   *
   * An unsettled printing has already been judged by its dearest possibility
   * (see sort.ts), so "unsure" is folded into which pile the card landed on -
   * and a fourth sound for it would be one more thing to tell apart by ear at a
   * card a second. The pull cue also gets the one haptic that feels different,
   * so the stop signal survives a muted phone.
   */
  if (pile) {
    tap(pile === 'pull' ? 'success' : 'light');
    if (!enabled) return;
    // A missing sort sound falls back to the scan bell rather than to silence:
    // a card that makes no sound reads as a card that did not register.
    const q = (pile === 'pull' ? pull : pile === 'bulk' ? bulk : scan) ?? scan;
    if (!q) return;
    try {
      void q.seekTo(0);
      q.play();
    } catch { /* silence is survivable */ }
    return;
  }
  tap(sure ? 'light' : 'warn');
  if (!enabled) return;
  const p = sure ? scan : check;
  if (!p) return;
  try {
    // Rewind first: at a card a second the previous ring is still ringing, and
    // without this the second card is silent.
    void p.seekTo(0);
    p.play();
  } catch { /* silence is survivable */ }
}
