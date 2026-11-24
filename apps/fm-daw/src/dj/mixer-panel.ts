// The Qone mixer's face (mixer.ts plays it), laid out like a four-channel analog club mixer with twin filters: a slate
// metal face with white print, black knurled knobs (the EQ's with a dashed scale round them), round rubber buttons
// whose rings light orange, dot LED meters (green, blue from 0 dB, red), flip switches and a sunken crossfader.
// Left to right: FILTER 1's column, the four channels, FILTER 2's column, and the black master panel. Each channel
// top to bottom: its two aux sends, trim, the four bands, the filter switch (1, OFF, 2), the crossfader switch (X,
// OFF, Y), CUE, its number, then its LEDs beside a long fader; the crossfader sits under the four. Each filter column
// is its LFO (depth, shape, beats a round, its tempo from deck A, deck B or TAP, a lamp pulsing with it), the
// resonance, the curve, the HPF / BPF / LPF buttons, the big sweep and the filter's on button. The black panel: the
// stereo LEDs, master, booth, then the headphones (split cue, cue/master mix, level) and NIGHT. Hover a knob and its
// label reads its value (dB, Hz, Q). Knobs turn by a drag up or down (Shift for fine), by the wheel and by the arrow
// keys; a double-click puts one back to where it starts. A narrow mixer (a phone, a small laptop) puts the two filter
// columns side by side under the channels.
import "./mixer.css";
import { button, el, svg } from "./dom.ts";
import { bandDb, CHANNELS, DECK_CHANNEL, filterGain, LFO_BEATS, LFO_FOLLOW, LFO_SHAPES, lfoValue, resQ, sweepHz, trimDb, type Band, type Ch, type FilterType, type LfoFollow, type LfoShape, type Mixer } from "./mixer.ts";

const PHONES_D = '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>';
const PHONES = svg(PHONES_D);
const POWER = svg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>');
// small labels as icons (lucide, ISC), the word in the tooltip: the LFO a wave, the filter assign a funnel, and so on
const mini = (body: string) => svg(body, 13);
const WAVE = mini('<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>');
const TAP = mini('<path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>');
const SPLIT = mini('<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>');
const SPLINE = mini('<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>');
const SCISSORS = mini('<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>');
const SEND = mini('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>');
const HEADPHONES = mini(PHONES_D);
const MOON = mini('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
/** Each LFO shape drawn as its own little wave (the word in the tooltip). */
const SHAPE_ICON: Record<LfoShape, string> = {
  sine: mini('<path d="M2 12c2-6 5-6 6 0s4 6 6 0 4-6 6 0"/>'),
  tri: mini('<path d="M2 12 6 6l6 12 6-12 4 6"/>'),
  square: mini('<path d="M2 12V6h5v12h5V6h5v12h5v-6"/>'),
  up: mini('<path d="M2 18 11 6v12l9-12v12"/>'),
  down: mini('<path d="M2 6l9 12V6l9 12V6"/>'),
};
const SHAPE_WORD: Record<LfoShape, string> = { sine: "sine", tri: "triangle", square: "square", up: "ramp up", down: "ramp down" };
const FOLLOW_WORD: Record<LfoFollow, string> = { a: "deck A's beat", b: "deck B's beat", tap: "the TAP button" };
/** The one accent: between a cloud's orange and rust. */
export const ACCENT = "#ee6a1f";
const DB = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const PCT = (v: number) => `${Math.round(v * 100)}%`;
const HZ = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);
const BAND_LABEL: Record<Band, string> = { high: "HI", hiMid: "HI MID", loMid: "LO MID", low: "LOW" };
/** The band's short name under its knob (the long one is in its tooltip). */
const BAND_SHORT: Record<Band, string> = { high: "HI", hiMid: "MID", loMid: "LMID", low: "LOW" };
const TYPE_LABEL: Record<FilterType, string> = { hp: "HPF", bp: "BPF", lp: "LPF" };
const TYPE_TITLE: Record<FilterType, string> = { hp: "High-pass: cuts the lows below the sweep", bp: "Band-pass: keeps a band around the sweep", lp: "Low-pass: cuts the highs above the sweep" };

/**
 * A knob: -135 to 135 degrees over `min` to `max`, read from `get` each frame and turned through `put`. Hovered or
 * held, its label reads `show`'s words for the value (the hover readout, for a dark booth).
 */
export function knob(o: { label: string; title: string; min: number; max: number; reset: number; size?: "s" | "m" | "l"; get: () => number; put: (v: number) => void; show?: (v: number) => string }) {
  const box = el("div", { class: `mx-knob mx-${o.size ?? "m"}` });
  const dial = el("div", { class: "mx-dial", role: "slider", tabindex: "0", title: o.title, "aria-label": o.title, "aria-valuemin": String(o.min), "aria-valuemax": String(o.max) }, '<i class="mx-cap"><b></b></i>');
  const label = el("span", {}, o.label);
  box.append(dial, label);
  let hover = false;
  box.addEventListener("pointerenter", () => { hover = true; shown = NaN; });
  box.addEventListener("pointerleave", () => { hover = false; shown = NaN; });
  const span = o.max - o.min, turn = (v: number) => o.put(Math.min(o.max, Math.max(o.min, v)));
  let drag: { y: number; v: number; id: number } | null = null;
  dial.addEventListener("pointerdown", (e) => { drag = { y: e.clientY, v: o.get(), id: e.pointerId }; dial.setPointerCapture(e.pointerId); e.preventDefault(); });
  dial.addEventListener("pointermove", (e) => { if (drag && e.pointerId === drag.id) turn(drag.v + ((drag.y - e.clientY) / (e.shiftKey ? 600 : 150)) * span); });
  const up = () => { drag = null; shown = NaN; };
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
      const v = o.get(), read = (hover || drag) && o.show;
      if (v === shown) return;
      shown = v;
      if (read) label.textContent = o.show!(v); else label.innerHTML = o.label;
      box.classList.toggle("read", !!read);
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

/** An LED meter: a column of round LEDs, green, then blue from 0 dB, red at the top; `lightMeter` lights it. */
const METER_DOTS = 11;
const meter = (cls = "") => el("div", { class: `mx-meter ${cls}` }, "<i></i>");
/** Light a meter's LEDs up to `v` (0 to 1), a whole LED at a time. */
const lightMeter = (lit: HTMLElement, v: number) => { lit.style.clipPath = `inset(${(1 - Math.round(Math.min(1, Math.max(0, v)) * METER_DOTS) / METER_DOTS) * 100}% 0 0 0)`; };

/** A round rubber button whose ring lights when it's on, as on a club mixer. */
const round = (icon: string, title: string, cls = "") => button(icon, title, `mx-rb ${cls}`);

/** A three-way flip switch (1, OFF, 2 or X, OFF, Y): a lever in a slot, each position printed under it and pressed to set it. */
function flip<T>(title: string, cls: string, opts: readonly { v: T; label: string; title: string }[], get: () => T, put: (v: T) => void) {
  const box = el("div", { class: `mx-flip ${cls}`, title });
  const bs = opts.map((x) => { const b = button(x.label, x.title); b.addEventListener("click", () => put(x.v)); box.append(b); return b; });
  const lever = el("i", { class: "mx-lever", "aria-hidden": "true" });
  box.append(lever);
  return { box, draw() { const at = opts.findIndex((x) => x.v === get()); bs.forEach((b, i) => b.classList.toggle("on", i === at)); lever.dataset.at = String(at); } };
}

/** Mount the mixer's face for `m`. `far(ch)`: that channel is someone else's deck (dimmed, not yours to touch). */
export function mountMixer(m: Mixer, o: { far?: (ch: Ch) => boolean; extra?: HTMLElement[] } = {}) {
  const root = el("div", { class: "mx", role: "group", "aria-label": "The mixer" });
  const face = el("div", { class: "mx-face" });
  const strips = el("div", { class: "mx-strips" });
  const draws: (() => void)[] = [];
  const add = <T extends { draw(): void }>(x: T) => { draws.push(() => x.draw()); return x; };

  // the four channels, top to bottom as on the hardware: aux sends, trim, the four bands, the filter and crossfader
  // switches, the cue button, the channel's number, then its LEDs beside the long fader
  const chans = Array.from({ length: CHANNELS }, (_, n) => {
    const ch = n as Ch, s = () => m.channels[ch]!.s, strip = el("div", { class: "mx-strip" });
    const deck = DECK_CHANNEL.indexOf(ch as 1 | 2);
    const k = (key: "trim" | Band | "send1" | "send2", label: string, title: string, show: (v: number) => string, size: "s" | "m" = "m") =>
      add(knob({ label, title: `${title}, channel ${n + 1}`, min: key.startsWith("send") ? 0 : -1, max: 1, reset: 0, size, get: () => s()[key], put: (v) => m.set(ch, key, v), show })).box;
    const sends = el("div", { class: "mx-pair" });
    sends.append(k("send1", `${SEND}1`, "Aux send 1", PCT, "s"), k("send2", `${SEND}2`, "Aux send 2", PCT, "s"));
    strip.append(sends, k("trim", "TRIM", "Input level: -12 to +12 dB", (v) => DB(trimDb(v))));
    for (const b of ["high", "hiMid", "loMid", "low"] as const)
      strip.append(k(b, BAND_SHORT[b], b === "high" || b === "low" ? `${BAND_LABEL[b]}: +6 dB to a full kill` : `${BAND_LABEL[b]}: +6 dB to -26 dB`, (v) => (bandDb(b, v) <= -80 ? "KILL" : DB(bandDb(b, v)))));
    const fa = add(flip(`Channel ${n + 1}'s filter: 1, off or 2`, "mx-fa", [
      { v: 1, label: "1", title: `Channel ${n + 1} through filter 1` },
      { v: 0, label: "OFF", title: `Channel ${n + 1} skips the filters` },
      { v: 2, label: "2", title: `Channel ${n + 1} through filter 2` },
    ] as const, () => s().filter, (v) => m.assignFilter(ch, v)));
    const xa = add(flip(`Channel ${n + 1} on the crossfader: X, THRU or Y`, "mx-x", [
      { v: "x", label: "X", title: `Channel ${n + 1} on the crossfader's left (X)` },
      { v: "off", label: "OFF", title: `Channel ${n + 1} skips the crossfader (THRU)` },
      { v: "y", label: "Y", title: `Channel ${n + 1} on the crossfader's right (Y)` },
    ] as const, () => s().xf, (v) => m.assignX(ch, v)));
    const cue = round(PHONES, `Cue channel ${n + 1} in the headphones`, "mx-cue");
    cue.addEventListener("click", () => m.cue(ch, !s().cue));
    const row = el("div", { class: "mx-faderrow" }), met = meter();
    const fd = add(fader(`Channel ${n + 1} fader`, "mx-fader", 0, 1, 0.8, () => s().fader, (v) => m.set(ch, "fader", v)));
    row.append(met, fd.i);
    strip.append(fa.box, xa.box, cue, el("div", { class: "mx-num" }, `${n + 1}${deck >= 0 ? `<small>${deck ? "B" : "A"}</small>` : ""}`), row);
    strips.append(strip);
    return { strip, cue, met: met.firstElementChild as HTMLElement, ch };
  });

  // the black panel on the right: the stereo LEDs, master and booth, then the headphones' monitor section
  const out = el("div", { class: "mx-out" });
  out.append(el("div", { class: "mx-brand", title: "The Qone mixer" }, "QONE"));
  const lr = el("div", { class: "mx-lr" }), ml = meter("mx-tall"), mr = meter("mx-tall");
  lr.append(ml, mr);
  out.append(lr, el("div", { class: "mx-lrtag" }, "<span>L</span><span>R</span>"));
  out.append(add(knob({ label: "MASTER", title: "Master level: what the room hears", min: 0, max: 1, reset: 0.8, get: () => m.master, put: (v) => m.setMaster(v), show: PCT })).box);
  out.append(add(knob({ label: "BOOTH", title: "Booth level: your own speakers, apart from the master", min: 0, max: 1, reset: 0.8, get: () => m.booth, put: (v) => m.setBooth(v), show: PCT })).box);
  const split = round(SPLIT, "Split cue: one output (a laptop's headphones), the cue in your left ear and the master in your right", "mx-split");
  split.addEventListener("click", () => m.setSplit(!m.split));
  out.append(el("div", { class: "mx-rule" }), split);
  out.append(add(knob({ label: "MIX", title: "Headphones: the cue (left) to the master (right)", min: 0, max: 1, reset: 0, size: "s", get: () => m.cueBlend, put: (v) => m.setCueBlend(v), show: (v) => `${Math.round((1 - v) * 100)}/${Math.round(v * 100)}` })).box);
  out.append(add(knob({ label: "LEVEL", title: "Headphone level", min: 0, max: 1, reset: 0.8, size: "s", get: () => m.phones, put: (v) => m.setPhones(v), show: PCT })).box);
  out.append(el("div", { class: "mx-jack", title: "Headphones" }, `<i></i>${HEADPHONES}`));
  const night = button(MOON, "Night: the face turned down and the lit controls glowing brighter, for a dark booth", "mx-night");
  night.addEventListener("click", () => root.classList.toggle("night"));
  const opts = el("div", { class: "mx-opts" });
  opts.append(night, ...(o.extra ?? []));
  out.append(opts);

  // the twin filters, a column either side of the channels: the LFO at the top, then the filter's types, sweep and on
  const filters = ([0, 1] as const).map((n) => {
    const f = () => m.filters[n], box = el("div", { class: `mx-filter mx-f${n + 1}` });
    const lamp = el("i", { class: "mx-lamp", "aria-hidden": "true" });
    const tag = el("div", { class: "mx-silk", title: `LFO ${n + 1}: it swings filter ${n + 1}'s sweep on the beat` }, `${WAVE}LFO`);
    tag.append(lamp);
    const depth = add(knob({ label: "DEPTH", title: `LFO ${n + 1} depth: how far it swings filter ${n + 1}'s sweep`, min: 0, max: 1, reset: 0, get: () => f().depth, put: (v) => m.filter(n, { depth: v }), show: (v) => `±${(v * 3).toFixed(1)}` })).box;
    const beats = button("", `LFO ${n + 1}: beats a round`, "mx-beats");
    beats.addEventListener("click", () => { const i = LFO_BEATS.indexOf(f().beats as (typeof LFO_BEATS)[number]); m.filter(n, { beats: LFO_BEATS[(i + 1) % LFO_BEATS.length]! }); });
    const shape = button("", "", "mx-shape");
    shape.addEventListener("click", () => m.filter(n, { shape: LFO_SHAPES[(LFO_SHAPES.indexOf(f().shape) + 1) % LFO_SHAPES.length]! }));
    const follow = button("", "", "mx-follow");
    follow.addEventListener("click", () => m.filter(n, { follow: LFO_FOLLOW[(LFO_FOLLOW.indexOf(f().follow) + 1) % LFO_FOLLOW.length]! }));
    const tap = round("", `LFO ${n + 1} tempo: tap it on the beat`, "mx-tap");
    tap.addEventListener("pointerdown", () => m.tap(n, performance.now()));
    const lfo = el("div", { class: "mx-lforow" });
    lfo.append(shape, beats);
    const res = add(knob({ label: "RES", title: `Filter ${n + 1} resonance: mild to wild`, min: 0, max: 1, reset: 0.3, get: () => f().res, put: (v) => m.filter(n, { res: v }), show: (v) => `Q ${resQ(v).toFixed(1)}` })).box;
    const curve = el("canvas", { class: "mx-curve", width: "160", height: "64", "aria-label": `Filter ${n + 1}'s curve` });
    const typesBox = el("div", { class: "mx-types" });
    const types = (["hp", "bp", "lp"] as const).map((t) => {
      const b = round(TYPE_LABEL[t], `${TYPE_TITLE[t]} (press more than one to combine)`);
      b.addEventListener("click", () => m.toggleType(n, t));
      typesBox.append(b);
      return { t, b };
    });
    const freq = add(knob({ label: "FREQ", title: `Filter ${n + 1} sweep: 20 Hz to 20 kHz`, min: 0, max: 1, reset: n ? 0.3 : 0.6, size: "l", get: () => f().freq, put: (v) => m.filter(n, { freq: v }), show: (v) => HZ(sweepHz(v)) })).box;
    const on = round(`${POWER}<span>${n + 1}</span>`, `Filter ${n + 1} on or off`, "mx-fon");
    on.addEventListener("click", () => m.filter(n, { on: !f().on }));
    const lfoPart = el("div", { class: "mx-fpart" }), filtPart = el("div", { class: "mx-fpart" });
    lfoPart.append(tag, depth, lfo, follow, tap, res);
    filtPart.append(curve, typesBox, freq, on);
    box.append(lfoPart, filtPart);
    let drawn = "";
    return {
      box,
      draw() {
        const s = f(), key = `${s.on}${s.types.join()}${s.freq}${s.res}`;
        on.classList.toggle("on", s.on);
        for (const x of types) x.b.classList.toggle("on", s.types.includes(x.t));
        beats.textContent = `${s.beats < 1 ? "½" : s.beats}`;
        const tapKey = `${s.follow}${Math.round(s.follow === "tap" ? s.bpm : m.lfoBpm(n))}${s.shape}`;
        if (tap.dataset.k !== tapKey) {
          tap.dataset.k = tapKey;
          tap.innerHTML = `${TAP}<span>${Math.round(s.follow === "tap" ? s.bpm : m.lfoBpm(n))}</span>`;
          tap.classList.toggle("on", s.follow === "tap");
          shape.innerHTML = SHAPE_ICON[s.shape]; shape.title = `LFO ${n + 1} shape: ${SHAPE_WORD[s.shape]} (press for the next)`; shape.setAttribute("aria-label", shape.title);
          follow.textContent = s.follow === "tap" ? "TAP" : `DECK ${s.follow.toUpperCase()}`;
          follow.title = `LFO ${n + 1} tempo: from ${FOLLOW_WORD[s.follow]} (press for the next)`; follow.setAttribute("aria-label", follow.title);
          follow.classList.toggle("on", s.follow !== "tap");
        }
        // the lamp pulses with the LFO, so you can see it sit on the beat
        lamp.style.opacity = String(s.depth > 0 ? 0.15 + 0.85 * ((lfoValue(s.shape, m.lfoPhase(n)) + 1) / 2) : 0.1);
        if (key !== drawn) { drawn = key; drawCurve(curve, s.on, s.types, sweepHz(s.freq), resQ(s.res), `FILTER ${n + 1}`); }
      },
    };
  });

  // the crossfader in its sunken bed under the channels, its curve switch beside it
  const xf = add(fader("Crossfader (← →): X on the left, Y on the right", "mx-xfade", -1, 1, 0, () => m.xfader, (v) => m.cross(v)));
  const curveB = button("", "The crossfader's curve: smooth for blends, cut for scratching", "mx-curveb");
  curveB.addEventListener("click", () => m.setCurve(m.curve === "smooth" ? "cut" : "smooth"));
  const xbed = el("div", { class: "mx-xbed" });
  xbed.append(curveB, el("b", {}, "X"), xf.i, el("b", {}, "Y"));
  const mid = el("div", { class: "mx-mid" });
  mid.append(strips, xbed);
  face.append(filters[0]!.box, mid, filters[1]!.box, out);
  root.append(face);

  return {
    root,
    /** Each frame: the meters, the buttons lit, and knobs and faders where the mixer has them. */
    draw() {
      for (const c of chans) {
        c.strip.classList.toggle("far", !!o.far?.(c.ch));
        c.cue.classList.toggle("on", m.channels[c.ch]!.s.cue);
        lightMeter(c.met, m.level(c.ch));
      }
      const [l, r] = m.masterLevels();
      lightMeter(ml.firstElementChild as HTMLElement, l);
      lightMeter(mr.firstElementChild as HTMLElement, r);
      split.classList.toggle("on", m.split);
      if (curveB.dataset.c !== m.curve) { curveB.dataset.c = m.curve; curveB.innerHTML = m.curve === "smooth" ? SPLINE : SCISSORS; curveB.title = `The crossfader's curve: ${m.curve === "smooth" ? "smooth, for blends" : "cut, for scratching"} (press to change)`; }
      night.classList.toggle("on", root.classList.contains("night"));
      m.tick();
      for (const f of filters) f.draw();
      for (const d of draws) d();
    },
  };
}

/** The filter's curve, 20 Hz to 20 kHz across, -24 to +24 dB up: the LFO swings it, this is where it rests. */
function drawCurve(c: HTMLCanvasElement, on: boolean, types: readonly FilterType[], f0: number, q: number, name: string) {
  const g = c.getContext("2d");
  if (!g) return;
  const w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#2a2d33"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.fillStyle = on ? ACCENT : "#7c7f86"; g.font = '600 24px "Barlow Condensed", sans-serif'; g.textBaseline = "top"; g.fillText(name, 6, 3);
  g.strokeStyle = on ? ACCENT : "#5b5f68"; g.lineWidth = 2;
  g.shadowColor = on ? ACCENT : "transparent"; g.shadowBlur = on ? 6 : 0;
  g.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const hz = 20 * Math.pow(1000, x / w), db = 20 * Math.log10(Math.max(1e-4, filterGain(types, hz, f0, q)));
    const y = h / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (h / 2 - 2);
    if (x) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
  g.shadowBlur = 0;
}

export type MixerFace = ReturnType<typeof mountMixer>;
