import { clamp } from '../core/math';
import type { Params } from '../core/params';

/**
 * Functional telemetry through the ears, not sound design.
 *
 * Without force feedback, tyre scrub is the highest-bandwidth limit indicator
 * available: pitch and gain ride slip magnitude and vertical load, so the
 * driver can find the limit by ear with the telemetry overlay hidden. Engine
 * audio exists only so gear changes and the powerband are audible. Everything
 * is synthesised -- no audio assets.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private noiseSource: AudioBufferSourceNode | null = null;
  private scrubGain: GainNode | null = null;
  private scrubFilter: BiquadFilterNode | null = null;
  private scrapeGain: GainNode | null = null;
  private scrapeFilter: BiquadFilterNode | null = null;

  private started = false;

  constructor(private params: Params) {}

  /** Must be called from a user gesture -- browsers refuse audio otherwise. */
  start(): void {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;
    this.ctx = new Ctor();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // --- engine: sawtooth plus a sub, low-passed ------------------------
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 1400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();

    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    this.engineSub.connect(subGain);
    subGain.connect(this.engineFilter);
    this.engineSub.start();

    // --- shared noise source for scrub and scrape -----------------------
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;

    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubFilter.frequency.value = 900;
    this.scrubFilter.Q.value = 1.6;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    this.noiseSource.connect(this.scrubFilter);
    this.scrubFilter.connect(this.scrubGain);
    this.scrubGain.connect(this.master);

    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.frequency.value = 2600;
    this.scrapeFilter.Q.value = 3.5;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.noiseSource.connect(this.scrapeFilter);
    this.scrapeFilter.connect(this.scrapeGain);
    this.scrapeGain.connect(this.master);

    this.noiseSource.start();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /**
   * @param rpm engine speed
   * @param throttle 0..1
   * @param scrub combined slip magnitude summed across the wheels, 0..~4
   * @param load total vertical load through the sliding wheels, newtons
   * @param scrape sustained wall-contact intensity, 0..1
   */
  update(rpm: number, throttle: number, scrub: number, load: number, scrape: number): void {
    if (!this.ctx || !this.master) return;
    const e = this.params.expression;
    const now = this.ctx.currentTime;
    const smooth = 0.06;

    this.master.gain.setTargetAtTime(e.audioEnabled ? e.masterVolume : 0, now, smooth);

    if (this.engineOsc && this.engineSub && this.engineGain && this.engineFilter) {
      const base = 28 + (rpm / 1000) * 20;
      this.engineOsc.frequency.setTargetAtTime(base, now, 0.02);
      this.engineSub.frequency.setTargetAtTime(base * 0.5, now, 0.02);
      this.engineFilter.frequency.setTargetAtTime(600 + rpm * 0.32, now, 0.05);
      const gain = (0.1 + throttle * 0.55) * e.engineVolume;
      this.engineGain.gain.setTargetAtTime(gain, now, smooth);
    }

    if (this.scrubGain && this.scrubFilter) {
      // Load raises the pitch as well as the volume: a heavily loaded sliding
      // tyre sounds different from a light one, which is the cue that tells
      // the driver which end is letting go.
      const intensity = clamp(scrub * 0.55, 0, 1);
      const loadFactor = clamp(load / 12000, 0, 1.4);
      this.scrubFilter.frequency.setTargetAtTime(520 + loadFactor * 900 + intensity * 700, now, 0.05);
      this.scrubGain.gain.setTargetAtTime(intensity * intensity * 0.4 * e.scrubVolume, now, 0.04);
    }

    if (this.scrapeGain && this.scrapeFilter) {
      const s = clamp(scrape, 0, 1);
      this.scrapeFilter.frequency.setTargetAtTime(1800 + s * 2600, now, 0.03);
      this.scrapeGain.gain.setTargetAtTime(s * 0.35 * e.impactVolume, now, 0.03);
    }
  }

  /** One-shot impact: a filtered noise burst whose weight tracks the impulse. */
  impact(magnitude: number, tier: 'scuff' | 'bump' | 'crash'): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const e = this.params.expression;

    const length = tier === 'crash' ? 0.55 : tier === 'bump' ? 0.28 : 0.12;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, tier === 'crash' ? 1.6 : 3);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = tier === 'crash' ? 900 : tier === 'bump' ? 1800 : 4200;

    const gain = ctx.createGain();
    const level = clamp(magnitude / 60000, 0.05, 1) * e.impactVolume;
    gain.gain.value = level;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + length);
  }
}
