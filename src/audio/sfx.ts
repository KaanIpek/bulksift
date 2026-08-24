/** Every sound in the game is synthesised at runtime. That keeps the build to
 *  a single bundle with no audio files to download, decode or licence, and it
 *  costs a few hundred lines rather than a few megabytes. */

type Voice = 'select' | 'deselect' | 'send' | 'impact' | 'capture' | 'lost' | 'upgrade' | 'victory' | 'defeat' | 'tap';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Browsers only allow audio to start inside a gesture, so this is called
   *  from the first tap rather than at load. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);

    const length = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.35;
  }

  play(voice: Voice): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    switch (voice) {
      case 'tap':
        this.blip(t, 520, 0.05, 0.18, 'triangle');
        break;
      case 'select':
        this.blip(t, 660, 0.07, 0.22, 'triangle');
        this.blip(t + 0.05, 880, 0.06, 0.16, 'triangle');
        break;
      case 'deselect':
        this.blip(t, 400, 0.06, 0.14, 'triangle');
        break;
      case 'send':
        // A filtered noise sweep: boots moving off.
        this.sweep(t, 1400, 260, 0.34, 0.3);
        this.blip(t, 220, 0.12, 0.14, 'sawtooth');
        break;
      case 'impact':
        this.sweep(t, 900, 180, 0.16, 0.22);
        break;
      case 'upgrade':
        this.blip(t, 523, 0.1, 0.2, 'square');
        this.blip(t + 0.09, 659, 0.1, 0.2, 'square');
        this.blip(t + 0.18, 784, 0.16, 0.2, 'square');
        break;
      case 'capture':
        this.chord(t, [523, 659, 784], 0.35, 0.16);
        break;
      case 'lost':
        this.chord(t, [392, 311, 233], 0.4, 0.16);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.blip(t + i * 0.12, f, 0.3, 0.22, 'triangle'));
        break;
      case 'defeat':
        [440, 392, 330, 262].forEach((f, i) => this.blip(t + i * 0.16, f, 0.42, 0.2, 'sine'));
        break;
    }
  }

  private blip(at: number, freq: number, duration: number, gain: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private chord(at: number, freqs: number[], duration: number, gain: number): void {
    freqs.forEach((f, i) => this.blip(at + i * 0.03, f, duration, gain, 'triangle'));
  }

  private sweep(at: number, from: number, to: number, duration: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), at + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter).connect(env).connect(this.master!);
    src.start(at);
    src.stop(at + duration + 0.02);
  }
}

export const sfx = new Sfx();
