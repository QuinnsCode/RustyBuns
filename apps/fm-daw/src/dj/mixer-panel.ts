// The mixer's face (mixer.ts plays it), after the four-channel analog club mixer with twin filters: a dark face with
// the four channels in vertical strips and the master strip on the right, each strip top to bottom its trim, the four
// EQ knobs with caps coloured by band, the two aux sends, the filter assign, the cue button, then the LED meter beside
// a long-throw fader and the crossfader assign under it. The two filter sections sit at the bottom left and right with
// the crossfader between them. Knobs turn by a drag up or down (Shift for fine), by the wheel and by the arrow keys;
// a double-click puts one back to where it starts. On a phone the strips scroll sideways and the filters stack.
import "./mixer.css";
import { button, el, svg } from "./dom.ts";
import { CHANNELS, DECK_CHANNEL, filterGain, LFO_BEATS, resQ, sweepHz, type Band, type Ch, type FilterType, type Mixer } from "./mixer.ts";

const PHONES = svg('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>');
const POWER = svg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>');
/** A knob cap's colour by what it turns. */
const CAP: Record<Band | "trim" | "send" | "filter" | "master", string> = {
  trim: "#d9d6cf", high: "#4ab8ff", hiMid: "#4affa0", loMid: "#ffd23c", low: "#ff4a6a", send: "#8a8f99", filter: "#ff6b4a", master: "#f1efe9",
};
const BAND_LABEL: Record<Band, string> = { high: "HI", hiMid: "HI MID", loMid: "LO MID", low: "LOW" };
const TYPE_LABEL: Record<FilterType, string> = { hp: "HPF", bp: "BPF", lp: "LPF" };
const TYPE_TITLE: Record<FilterType, string> = { hp: "High-pass: cuts the lows below the sweep", bp: "Band-pass: keeps a band around the sweep", lp: "Low-pass: cuts the highs above the sweep" };

/** A knob: -135 to 135 degrees over `min` to `max`, read from `get` each frame and turned through `put`. */
function knob(o: { label: string; title: string; min: number; max: number; reset: number; cap: string; size?: "s" | "m" | "l"; get: () => number; put: (v: number) => void }) {
  const box = el("div", { class: `mx-knob mx-${o.size ?? "m"}` });
  const dial = el("div", { class: "mx-dial", role: "slider", tabindex: "0", title: o.title, "aria-label": o.title, "aria-valuemin": String(o.min), "aria-valuemax": String(o.max) }, '<i class="mx-cap"><b></b></i>');
  (dial.firstElementChild as HTMLElement).style.background = o.cap;
  box.append(dial, el("span", {}, o.label));
  const span = o.max - o.min, turn = (v: number) => o.put(Math.min(o.max, Math.max(o.min, v)));
  let drag: { y: number; v: number; id: number } | null = null;
  dial.addEventListener("pointerdown", (e) => { drag = { y: e.clientY, v: o.get(), id: e.pointerId }; dial.setPointerCapture(e.pointerId); e.preventDefault(); });
  dial.addEventListener("pointermove", (e) => { if (drag && e.pointerId === drag.id) turn(drag.v + ((drag.y - e.clientY) / (e.shiftKey ? 600 : 150)) * span); });
  const up = () => { drag = null; };
  dial.addEventListener("pointerup", up); dial.addEventListener("pointercancel", up);
  dial.addEventListener("wheel", (e) => { e.preventDefault(); turn(o.get() - Math.sign(e.deltaY) * span / (e.shiftKey ? 200 : 40)); }, { passive: false });
  dial.addEventListener("dblclick", () => turn(o.reset));
  dial.addEventListener("keydown", (e) => {
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    turn(o.get() + by * span / 40); e.preventDefault(); e.stopPropagation();
  });
  let shown = NaN;
  return {
    box,
    draw() {
      const v = o.get();
      if (v === shown) return;
      shown = v;
      (dial.firstElementChild as HTMLElement).style.transform = `rotate(${-135 + ((v - o.min) / span) * 270}deg)`;
      dial.setAttribute("aria-valuenow", v.toFixed(2));
    },
  };
}

/** A long fader, 0 to 1, read from `get` while nobody holds it. */
function fader(title: string, cls: string, min: number, max: number, reset: number, get: () => number, put: (v: number) => void) {
  const i = el("input", { type: "range", min: String(min), max: String(max), step: "0.005", value: String(get()), title, "aria-label": title, class: cls });
  i.addEventListener("input", () => put(Number(i.value)));
  i.addEventListener("dblclick", () => { put(reset); i.value = String(reset); });
  return { i, draw() { if (document.activeElement !== i) i.value = String(get()); } };
}

/** An LED meter: green, then amber, then red at the top. */
const meter = (cls = "") => el("div", { class: `mx-meter ${cls}` }, "<i></i>");

/** Mount the mixer's face for `m`. `far(ch)`: that channel is someone else's deck (dimmed, not yours to touch). */
export function mountMixer(m: Mixer, o: { far?: (ch: Ch) => boolean; extra?: HTMLElement[] } = {}) {
  const root = el("div", { class: "mx", role: "group", "aria-label": "The mixer" });
  const strips = el("div", { class: "mx-strips" });
  const draws: (() => void)[] = [];
  const add = <T extends { draw(): void }>(x: T) => { draws.push(() => x.draw()); return x; };

  const chans = Array.from({ length: CHANNELS }, (_, n) => {
    const ch = n as Ch, s = () => m.channels[ch]!.s, strip = el("div", { class: "mx-strip" });
    const deck = DECK_CHANNEL.indexOf(ch as 1 | 2);
    strip.append(el("div", { class: "mx-num" }, `${n + 1}${deck >= 0 ? `<small>${deck ? "B" : "A"}</small>` : ""}`));
    const k = (key: "trim" | Band | "send1" | "send2", label: string, title: string, cap: string, size: "s" | "m" = "m") =>
      add(knob({ label, title: `${title}, channel ${n + 1}`, min: key.startsWith("send") ? 0 : -1, max: 1, reset: 0, cap, size, get: () => s()[key], put: (v) => m.set(ch, key, v) })).box;
    strip.append(k("trim", "TRIM", "Input level: -12 to +12 dB", CAP.trim));
    for (const b of ["high", "hiMid", "loMid", "low"] as const)
      strip.append(k(b, BAND_LABEL[b], b === "high" || b === "low" ? `${BAND_LABEL[b]}: +6 dB to a full kill` : `${BAND_LABEL[b]}: +6 dB to -26 dB`, CAP[b]));
    const sends = el("div", { class: "mx-pair" });
    sends.append(k("send1", "AUX 1", "Aux send 1", CAP.send, "s"), k("send2", "AUX 2", "Aux send 2", CAP.send, "s"));
    strip.append(sends);
    // the filter assign: 1, 2, or neither (off)
    const fa = el("div", { class: "mx-assign" });
    const f1 = button("1", `Channel ${n + 1} through filter 1`), f2 = button("2", `Channel ${n + 1} through filter 2`);
    f1.addEventListener("click", () => m.assignFilter(ch, s().filter === 1 ? 0 : 1));
    f2.addEventListener("click", () => m.assignFilter(ch, s().filter === 2 ? 0 : 2));
    fa.append(f1, el("span", {}, "FLT"), f2);
    const cue = button(PHONES, `Cue channel ${n + 1} in the headphones`, "mx-cue");
    cue.addEventListener("click", () => m.cue(ch, !s().cue));
    const row = el("div", { class: "mx-faderrow" }), met = meter();
    const fd = add(fader(`Channel ${n + 1} fader`, "mx-fader", 0, 1, 0.8, () => s().fader, (v) => m.set(ch, "fader", v)));
    row.append(met, fd.i);
    // the crossfader assign: X (left), THRU (off), Y (right)
    const xa = el("div", { class: "mx-assign mx-x" });
    const xs = (["x", "off", "y"] as const).map((a) => {
      const b = button(a === "off" ? "THRU" : a.toUpperCase(), a === "off" ? `Channel ${n + 1} skips the crossfader` : `Channel ${n + 1} on the crossfader's ${a === "x" ? "left (X)" : "right (Y)"}`);
      b.addEventListener("click", () => m.assignX(ch, a));
      xa.append(b);
      return { a, b };
    });
    strip.append(fa, cue, row, xa);
    strips.append(strip);
    return { strip, f1, f2, cue, met: met.firstElementChild as HTMLElement, xs, ch };
  });

  // the master strip: master and booth, the stereo meters, the headphones
  const ms = el("div", { class: "mx-strip mx-masterstrip" });
  ms.append(el("div", { class: "mx-num" }, "MST"));
  ms.append(add(knob({ label: "MASTER", title: "Master level: what the room hears", min: 0, max: 1, reset: 0.8, cap: CAP.master, get: () => m.master, put: (v) => m.setMaster(v) })).box);
  ms.append(add(knob({ label: "BOOTH", title: "Booth level: your own speakers, apart from the master", min: 0, max: 1, reset: 0.8, cap: CAP.master, get: () => m.booth, put: (v) => m.setBooth(v) })).box);
  const lr = el("div", { class: "mx-lr" }), ml = meter("mx-tall"), mr = meter("mx-tall");
  lr.append(ml, mr);
  ms.append(lr, el("div", { class: "mx-sub" }, "PHONES"));
  ms.append(add(knob({ label: "CUE MIX", title: "Headphones: the cue (left) to the master (right)", min: 0, max: 1, reset: 0, cap: CAP.send, size: "s", get: () => m.cueBlend, put: (v) => m.setCueBlend(v) })).box);
  ms.append(add(knob({ label: "LEVEL", title: "Headphone level", min: 0, max: 1, reset: 0.8, cap: CAP.send, size: "s", get: () => m.phones, put: (v) => m.setPhones(v) })).box);
  const split = button("SPLIT", "Split cue: one output (a laptop's headphones), the cue in your left ear and the master in your right", "mx-split");
  split.addEventListener("click", () => m.setSplit(!m.split));
  ms.append(split);
  strips.append(ms);

  // the two filters and the crossfader between them
  const bottom = el("div", { class: "mx-bottom" });
  const filters = ([0, 1] as const).map((n) => {
    const f = () => m.filters[n], box = el("div", { class: `mx-filter mx-f${n + 1}` });
    const head = el("div", { class: "mx-fhead" });
    const on = button(`${POWER}<span>${n + 1}</span>`, `Filter ${n + 1} on or off`, "mx-fon");
    on.addEventListener("click", () => m.filter(n, { on: !f().on }));
    const types = (["hp", "bp", "lp"] as const).map((t) => {
      const b = button(TYPE_LABEL[t], `${TYPE_TITLE[t]} (press more than one to combine)`);
      b.addEventListener("click", () => m.toggleType(n, t));
      return { t, b };
    });
    head.append(on, ...types.map((x) => x.b));
    const curve = el("canvas", { class: "mx-curve", width: "200", height: "56", "aria-label": `Filter ${n + 1}'s curve` });
    const knobs = el("div", { class: "mx-fknobs" });
    knobs.append(
      add(knob({ label: "FREQ", title: `Filter ${n + 1} sweep: 20 Hz to 20 kHz`, min: 0, max: 1, reset: n ? 0.3 : 0.6, cap: CAP.filter, size: "l", get: () => f().freq, put: (v) => m.filter(n, { freq: v }) })).box,
      add(knob({ label: "RES", title: `Filter ${n + 1} resonance: mild to wild`, min: 0, max: 1, reset: 0.3, cap: CAP.filter, get: () => f().res, put: (v) => m.filter(n, { res: v }) })).box,
    );
    const lfo = el("div", { class: "mx-lfo" });
    const beats = button("", `Filter ${n + 1} LFO: beats per sweep`, "mx-beats");
    beats.addEventListener("click", () => { const i = LFO_BEATS.indexOf(f().beats as (typeof LFO_BEATS)[number]); m.filter(n, { beats: LFO_BEATS[(i + 1) % LFO_BEATS.length]! }); });
    const tap = button("", `Filter ${n + 1} LFO tempo: tap it on the beat`, "mx-tap");
    tap.addEventListener("pointerdown", () => m.tap(n, performance.now()));
    lfo.append(add(knob({ label: "LFO", title: `Filter ${n + 1} LFO depth: how far it swings the sweep`, min: 0, max: 1, reset: 0, cap: CAP.send, size: "s", get: () => f().depth, put: (v) => m.filter(n, { depth: v }) })).box, beats, tap);
    box.append(head, curve, knobs, lfo);
    let drawn = "";
    return {
      box,
      draw() {
        const s = f(), key = `${s.on}${s.types.join()}${s.freq}${s.res}`;
        on.classList.toggle("on", s.on);
        for (const x of types) x.b.classList.toggle("on", s.types.includes(x.t));
        beats.textContent = `${s.beats < 1 ? "1/2" : s.beats} BEAT${s.beats > 1 ? "S" : ""}`;
        tap.textContent = `TAP ${Math.round(s.bpm)}`;
        if (key !== drawn) { drawn = key; drawCurve(curve, s.on, s.types, sweepHz(s.freq), resQ(s.res)); }
      },
    };
  });
  const mid = el("div", { class: "mx-xmid" });
  const xf = add(fader("Crossfader (← →): X on the left, Y on the right", "mx-xfade", -1, 1, 0, () => m.xfader, (v) => m.cross(v)));
  const xrow = el("div", { class: "mx-xrow" });
  xrow.append(el("b", {}, "X"), xf.i, el("b", {}, "Y"));
  const curveB = button("", "The crossfader's curve: smooth for blends, cut for scratching", "mx-curveb");
  curveB.addEventListener("click", () => m.setCurve(m.curve === "smooth" ? "cut" : "smooth"));
  const opts = el("div", { class: "mx-opts" });
  opts.append(curveB, ...(o.extra ?? []));
  mid.append(xrow, opts);
  bottom.append(filters[0]!.box, mid, filters[1]!.box);
  root.append(strips, bottom);

  return {
    root,
    /** Each frame: the meters, the buttons lit, and knobs and faders where the mixer has them. */
    draw() {
      for (const c of chans) {
        const s = m.channels[c.ch]!.s;
        c.strip.classList.toggle("far", !!o.far?.(c.ch));
        c.f1.classList.toggle("on", s.filter === 1); c.f2.classList.toggle("on", s.filter === 2);
        c.cue.classList.toggle("on", s.cue);
        for (const x of c.xs) x.b.classList.toggle("on", s.xf === x.a);
        c.met.style.transform = `scaleY(${m.level(c.ch)})`;
      }
      const [l, r] = m.masterLevels();
      (ml.firstElementChild as HTMLElement).style.transform = `scaleY(${l})`;
      (mr.firstElementChild as HTMLElement).style.transform = `scaleY(${r})`;
      split.classList.toggle("on", m.split);
      curveB.textContent = m.curve === "smooth" ? "SMOOTH" : "CUT";
      for (const f of filters) f.draw();
      for (const d of draws) d();
    },
  };
}

/** The filter's curve, 20 Hz to 20 kHz across, -24 to +24 dB up: the LFO swings it, this is where it rests. */
function drawCurve(c: HTMLCanvasElement, on: boolean, types: readonly FilterType[], f0: number, q: number) {
  const g = c.getContext("2d");
  if (!g) return;
  const w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#2a2d33"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.strokeStyle = on ? "#ff6b4a" : "#5b5f68"; g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const hz = 20 * Math.pow(1000, x / w), db = 20 * Math.log10(Math.max(1e-4, filterGain(types, hz, f0, q)));
    const y = h / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (h / 2 - 2);
    if (x) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
}

export type MixerFace = ReturnType<typeof mountMixer>;
