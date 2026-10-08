// Sounds, all synthesized: footsteps, rustling bushes, and the ranger's call
// (spoken by the browser's speech synthesis, quieter the farther away it is).

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

function noise(seconds: number, volume: number, pan: number, filter: number, q = 0.7) {
  const a = ac();
  if (a.state === "suspended") void a.resume();
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = filter; f.Q.value = q;
  const g = a.createGain();
  g.gain.value = volume;
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(f).connect(g).connect(p).connect(a.destination);
  src.start();
}

/** Volume and pan for a sound at (dx, dy) metres from a listener facing yaw. */
export function place(dx: number, dy: number, yaw: number, reach: number): { vol: number; pan: number } {
  const d = Math.hypot(dx, dy);
  const ang = Math.atan2(dx, dy) - yaw;
  return { vol: Math.max(0, 1 - d / reach), pan: Math.sin(ang) };
}

export const sounds = {
  rustle(vol: number, pan: number) { if (vol > 0.02) { noise(0.35, vol * 0.5, pan, 3200, 0.5); setTimeout(() => noise(0.25, vol * 0.35, pan, 2400, 0.6), 120); } },
  step(vol: number, pan: number) { if (vol > 0.02) noise(0.08, vol * 0.6, pan, 500, 1.2); },
  caught() { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(660, a.currentTime); o.frequency.exponentialRampToValueAtTime(220, a.currentTime + 0.4); g.gain.setValueAtTime(0.15, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.5); },
  call(vol: number, line: string) {
    if (vol <= 0.03 || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(line);
    u.volume = Math.min(1, vol); u.rate = 1.05; u.pitch = 0.8;
    speechSynthesis.speak(u);
  },
  unlock() { const a = ac(); if (a.state === "suspended") void a.resume(); },
};

export const CALLS = ["Anybody out there?", "Park ranger! Come on out!", "I know you're out here!", "Hello? Campers?", "Campsite's closed, folks!"];
