// The desert night under the music (an open-air room): air moving through the brush in slow gusts, crickets out in
// the dark in trains of chirps, one group off each side, and the generator's hum, which you only notice as you walk
// toward it. Quiet on purpose (wind about -40 dBFS, the crickets under it) so it fills the gaps between tracks without
// showing over them; the room's mute takes it down with everything else. `chirps` and `humLevel` are pure, for the test.
import { mulberry32 } from "@rustybuns/util";

/** The generator's hum at `m` metres: full (a quiet set's -26 dBFS) within 3 m, falling 6 dB each time the distance doubles. */
export function humLevel(m: number): number {
  return 0.05 * Math.min(1, 3 / Math.max(m, 0.1));
}

/**
 * A loop of crickets, `seconds` long at `rate`: trains of three or four 4.4 kHz chirps (each 14 ms, 32 ms apart), a
 * train about every 0.8 s with a little drift, so the loop doesn't tick like a clock.
 */
export function chirps(rate: number, seconds: number, seed: number, hz = 4400): Float32Array {
  const r = mulberry32(seed), out = new Float32Array(Math.round(rate * seconds)), len = Math.round(rate * 0.014), gap = Math.round(rate * 0.032);
  for (let t = r() * 0.4; t < seconds - 0.2; t += 0.7 + r() * 0.25) {
    const pulses = 3 + (r() < 0.4 ? 1 : 0), start = Math.round(t * rate), f = hz * (0.97 + r() * 0.06);
    for (let p = 0; p < pulses; p++) for (let i = 0; i < len; i++) {
      const k = start + p * gap + i;
      if (k >= out.length) break;
      // a soft-edged burst: up and down in the chirp's own length
      out[k] += Math.sin((2 * Math.PI * f * i) / rate) * Math.sin((Math.PI * i) / len);
    }
  }
  return out;
}

export class NightAir {
  private out: GainNode;
  private hum: GainNode | null = null;
  private wasMuted = false;

  constructor(private ctx: BaseAudioContext, to: AudioNode, private generator: [number, number] | undefined, seed: number) {
    this.out = new GainNode(ctx, { gain: 1 });
    this.out.connect(to);
    // the wind: noise through a broad band, swelling in two slow, uneven gusts
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), n = noise.getChannelData(0), r = mulberry32(seed);
    for (let i = 0; i < n.length; i++) n[i] = r() * 2 - 1;
    const wind = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true }), band = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 520, Q: 0.5 });
    const air = new GainNode(ctx, { gain: 0.01 });
    for (const [hz, depth] of [[0.06, 0.006], [0.19, 0.003]] as const) {
      const lfo = new OscillatorNode(ctx, { frequency: hz }), d = new GainNode(ctx, { gain: depth });
      lfo.connect(d).connect(air.gain); lfo.start();
    }
    wind.connect(band).connect(air).connect(this.out); wind.start();
    // the crickets: two loops of different lengths, one off each side, so they never line up the same way twice
    for (const [side, secs, s] of [[-0.7, 6.3, seed + 1], [0.6, 7.9, seed + 2]] as const) {
      const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * secs), ctx.sampleRate);
      buf.copyToChannel(chirps(ctx.sampleRate, secs, s, side < 0 ? 4400 : 4700) as Float32Array<ArrayBuffer>, 0);
      const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }), g = new GainNode(ctx, { gain: 0.0035 }), pan = new StereoPannerNode(ctx, { pan: side });
      src.connect(g).connect(pan).connect(this.out); src.start(ctx.currentTime + (side < 0 ? 0 : 1.3));
    }
    // the generator: 60 Hz from a 3600 rpm engine and its harmonics, rough with a little noise, dull through its canopy
    if (generator) {
      this.hum = new GainNode(ctx, { gain: 0 });
      const engine = new OscillatorNode(ctx, { type: "sawtooth", frequency: 60 }), canopy = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 380, Q: 0.7 });
      const rumble = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true }), rough = new GainNode(ctx, { gain: 0.25 });
      engine.connect(canopy); rumble.connect(rough).connect(canopy);
      canopy.connect(this.hum).connect(this.out);
      engine.start(); rumble.start();
    }
  }

  /** Where you are, and whether the room is muted: the hum follows the distance to the generator. */
  listen(x: number, z: number, muted: boolean) {
    const now = this.ctx.currentTime;
    if (muted !== this.wasMuted) { this.out.gain.setTargetAtTime(muted ? 0 : 1, now, 0.05); this.wasMuted = muted; }
    if (this.hum && this.generator) this.hum.gain.setTargetAtTime(humLevel(Math.hypot(x - this.generator[0], z - this.generator[1])), now, 0.2);
  }
}
