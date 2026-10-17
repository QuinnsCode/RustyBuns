// Sound for the ground battle, synthesized with Web Audio so there is nothing to load. Every call
// takes how far off the thing is, so a blast across the field is a distant thud. The context starts
// on the first click (browsers insist), and until then every call is quiet and does nothing.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let master: GainNode | null = null;
let lastBoom = 0;

function ready(): AudioContext | null {
  if (!ctx && typeof AudioContext !== "undefined") {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
  return ctx && ctx.state === "running" ? ctx : null;
}
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => void ready(), { once: true });

const fade = (d: number) => Math.max(0, 1 - d / 160) ** 2;

function noiseBuf(c: AudioContext) {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// A gain that swells to `peak` and dies away over `len`, wired to the master volume.
function swell(c: AudioContext, peak: number, attack: number, len: number) {
  const g = c.createGain(), t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(master!);
  return g;
}

/** A blaster bolt: a short falling zap, brighter for the Marines and rougher for the Wooka's. */
export function zap(distance: number, marines: boolean) {
  const c = ready(), v = fade(distance);
  if (!c || v < 0.02) return;
  const o = c.createOscillator(), t = c.currentTime, f = marines ? 1500 : 700;
  o.type = marines ? "sawtooth" : "square";
  o.frequency.setValueAtTime(f * (0.9 + Math.random() * 0.2), t);
  o.frequency.exponentialRampToValueAtTime(f / 5, t + 0.12);
  o.connect(swell(c, 0.12 * v, 0.005, 0.14));
  o.start(t); o.stop(t + 0.15);
}

/** A blast: a sub thud that drops, a rumble of filtered noise, and a crack on top. Big ones boom. */
export function boom(distance: number, big: boolean) {
  const c = ready(), v = fade(distance);
  if (!c || v < 0.02) return;
  const t = c.currentTime;
  if (t - lastBoom < 0.04) return; // a cluster of blasts is one wall of sound, not a clipped one
  lastBoom = t;
  const len = big ? 2.2 : 0.9, delay = Math.min(0.6, distance / 400);
  const thud = c.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(big ? 90 : 120, t + delay);
  thud.frequency.exponentialRampToValueAtTime(big ? 22 : 35, t + delay + len * 0.7);
  thud.connect(swell(c, (big ? 1 : 0.6) * v, 0.01, len));
  thud.start(t + delay); thud.stop(t + delay + len);
  const rum = c.createBufferSource(), low = c.createBiquadFilter();
  rum.buffer = noiseBuf(c);
  low.type = "lowpass";
  low.frequency.setValueAtTime(big ? 900 : 1400, t + delay);
  low.frequency.exponentialRampToValueAtTime(70, t + delay + len);
  rum.connect(low);
  low.connect(swell(c, (big ? 0.9 : 0.5) * v, 0.01, len * 0.9));
  rum.start(t + delay); rum.stop(t + delay + len);
}

/**
 * A Wooka call. Two formants slide over a buzzy voice, so it comes out like "woo-ka": a rise, then
 * a fall. `size` is the pitch: a Fodder is high, a Chub or Warbur lower and longer.
 */
export function wooka(distance: number, size = 1, panic = false) {
  const c = ready(), v = fade(distance);
  if (!c || v < 0.03) return;
  const t = c.currentTime, len = (panic ? 0.25 : 0.42) * (0.8 + size * 0.4), base = ((panic ? 330 : 210) / size) * (0.9 + Math.random() * 0.25);
  const src = c.createOscillator();
  src.type = "sawtooth";
  src.frequency.setValueAtTime(base, t);
  src.frequency.linearRampToValueAtTime(base * (panic ? 1.5 : 1.3), t + len * 0.45);
  src.frequency.linearRampToValueAtTime(base * 0.75, t + len);
  const out = swell(c, 0.2 * v, 0.03, len);
  // "oo" then "ah": the first formant opens, the second closes.
  for (const [from, to, q] of [[320, 760, 6], [900, 1250, 8]] as const) {
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.linearRampToValueAtTime(to, t + len * 0.55);
    src.connect(f);
    f.connect(out);
  }
  src.start(t); src.stop(t + len + 0.02);
}

/** A spear or hex leaving the thrower: a quick whoosh. */
export function whoosh(distance: number) {
  const c = ready(), v = fade(distance);
  if (!c || v < 0.03) return;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), t = c.currentTime;
  s.buffer = noiseBuf(c);
  f.type = "bandpass";
  f.Q.value = 2;
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
  s.connect(f);
  f.connect(swell(c, 0.15 * v, 0.05, 0.32));
  s.start(t); s.stop(t + 0.33);
}
