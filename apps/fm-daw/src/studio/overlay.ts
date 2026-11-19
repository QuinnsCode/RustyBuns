// Seated at an instrument with notes in the jam room: a see-through strip of your computer keys over the bottom of
// the view, each with the note it plays now (the octave shift included), lit while held; and a pitch wheel and a mod
// wheel at the left. The pitch wheel springs back to the middle when you let go; the mod wheel stays where you leave
// it and adds vibrato. Up and down arrows bend while held, [ and ] move the mod wheel, / shows or hides the keys
// (they're hidden on a touch screen, where you play by touch). A MIDI keyboard's wheels move them too. What the wheels
// do is one bend in semitones on the seat's track, sent to your sound and over the live line so the room hears it.
import { BEND_RANGE } from "../engine/params.ts";
import type { Live, Project } from "../project.ts";
import { QWERTY } from "../ui/input.ts";
import { keyNote, type Jam } from "./jam.ts";

/** How far (semitones) the pitch wheel bends at either end, and the mod wheel's deepest vibrato and its rate (Hz). */
export const WHEEL_SEMIS = 2, VIBRATO = 0.5, VIBRATO_HZ = 5.5;
/** How fast (per second) the pitch wheel springs back, and the arrows push it. */
const SPRING = 14, PUSH = 6;

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
/** The top letter row's note keys, with a gap where R and I sit. */
const UPPER: (string | null)[] = ["KeyW", "KeyE", null, "KeyT", "KeyY", "KeyU", null, "KeyO", "KeyP"];
const label = (code: string) => (code === "Semicolon" ? ";" : code === "Quote" ? "'" : code.slice(3));

export interface Cap { code: string; key: string; midi: number; note: string; black: boolean }
/** Each computer key and the note it plays where you sit (none at the kit or standing): the black keys' row and the white's. */
export function keyMap(j: Jam, p: Project, octave: number): { track: number; caps: Cap[] } | null {
  const caps: Cap[] = [];
  let track = -1;
  for (const code of Object.keys(QWERTY)) {
    const n = keyNote(j, p, code, octave);
    if (!n || p.tracks[n.track]?.kind === "drum") continue;
    track = n.track;
    caps.push({ code, key: label(code), midi: n.midi, note: noteName(n.midi), black: [1, 3, 6, 8, 10].includes(n.midi % 12) });
  }
  return caps.length ? { track, caps } : null;
}

/** The two wheels: where each sits, -1..1 for pitch, 0..1 for mod, and the bend they make. */
export class Wheels {
  pitch = 0;
  mod = 0;
  /** Held by a hand (a drag, an arrow, a MIDI wheel): it doesn't spring back while held. */
  held = false;
  private arrow = 0;
  private modArrow = 0;
  private last = 0;
  /** The arrows: -1 down, 1 up, 0 let go. */
  push(dir: number) { this.arrow = dir; }
  /** [ and ]: -1 lower, 1 higher, 0 let go. */
  modPush(dir: number) { this.modArrow = dir; }
  /** A MIDI pitch wheel (-1..1), which springs back on its own. */
  midi(x: number) { this.pitch = Math.max(-1, Math.min(1, x)); }
  /** The bend (semitones) at `t` seconds, after `dt` more: the pitch wheel's, plus the mod wheel's vibrato. */
  tick(dt: number, t: number): number {
    if (this.arrow) this.pitch = Math.max(-1, Math.min(1, this.pitch + this.arrow * PUSH * dt));
    else if (!this.held) this.pitch *= Math.exp(-SPRING * dt);
    if (Math.abs(this.pitch) < 0.002) this.pitch = 0;
    if (this.modArrow) this.mod = Math.max(0, Math.min(1, this.mod + this.modArrow * dt));
    const s = this.pitch * WHEEL_SEMIS + this.mod * VIBRATO * Math.sin(2 * Math.PI * VIBRATO_HZ * t);
    return Math.max(-BEND_RANGE, Math.min(BEND_RANGE, Math.round(s * 1000) / 1000));
  }
  /** The bend to send now, or null when it hasn't moved enough to say (a hundredth of a semitone, and 0 always). */
  changed(semis: number): number | null {
    if (semis === this.last || (semis !== 0 && Math.abs(semis - this.last) < 0.01)) return null;
    this.last = semis;
    return semis;
  }
}

/** The bend on the live line, as the World checks it. */
export const bendEvent = (track: number, semis: number): Live => ({ t: "bend", track, semis });

const CSS = `
.qo{position:fixed;inset:auto 0 86px 0;display:flex;justify-content:center;align-items:flex-end;gap:18px;pointer-events:none;z-index:5;font:600 13px 'Barlow Condensed',sans-serif;color:#f4f1ea}
.qo[hidden]{display:none}
.qo-keys{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:12px;background:rgba(21,23,27,.34);backdrop-filter:blur(2px)}
.qo-row{display:flex;gap:4px;justify-content:center}
.qo-row.up{justify-content:flex-start;padding-left:21px}
.qo-cap{width:38px;height:40px;border-radius:7px;border:1px solid rgba(244,241,234,.35);background:rgba(244,241,234,.12);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05}
.qo-cap.black{background:rgba(10,10,12,.45)}
.qo-cap b{font-size:15px}.qo-cap span{font-size:11px;opacity:.8}
.qo-cap.on{background:rgba(10,159,224,.75);border-color:#0a9fe0}
.qo-gap{width:38px}
.qo-wheels{display:flex;gap:8px;padding:8px;border-radius:12px;background:rgba(21,23,27,.34);pointer-events:auto;touch-action:none}
.qo-wheel{position:relative;width:26px;height:96px;border-radius:8px;background:rgba(10,10,12,.55);border:1px solid rgba(244,241,234,.3)}
.qo-wheel i{position:absolute;left:2px;right:2px;height:14px;border-radius:4px;background:#f4f1ea}
.qo-wheel.pitch::after{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px dashed rgba(244,241,234,.4)}
@media (pointer:coarse),(max-width:640px){.qo-keys{display:none}.qo{inset:auto auto 120px 16px}}
`;

/** The overlay on the page. `send(track, semis)`: the bend the wheels make now, on the seat's track (0 when you leave it). */
export class Overlay {
  readonly wheels = new Wheels();
  private readonly root = document.createElement("div");
  private readonly keysEl = document.createElement("div");
  private readonly pitchEl: HTMLElement;
  private readonly modEl: HTMLElement;
  private readonly pitchKnob = document.createElement("i");
  private readonly modKnob = document.createElement("i");
  private caps = new Map<string, HTMLElement>();
  private shown = "";
  private track = -1;
  /** Whether the keys strip shows (/ toggles it). */
  keysOn = true;
  constructor(private readonly send: (track: number, semis: number) => void) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    this.root.className = "qo";
    this.root.hidden = true;
    this.keysEl.className = "qo-keys";
    const wheels = document.createElement("div");
    wheels.className = "qo-wheels";
    const wheel = (kind: string, title: string) => {
      const w = document.createElement("div");
      w.className = `qo-wheel ${kind}`; w.title = title; w.append(kind === "pitch" ? this.pitchKnob : this.modKnob);
      wheels.append(w);
      return w;
    };
    this.pitchEl = wheel("pitch", "Pitch bend: drag, or hold the up and down arrows");
    this.modEl = wheel("mod", "Mod (vibrato): drag, or [ and ]");
    this.drag(this.pitchEl, (y) => { this.wheels.pitch = 1 - 2 * y; }, () => { this.wheels.held = false; });
    this.drag(this.modEl, (y) => { this.wheels.mod = 1 - y; }, () => {});
    this.root.append(wheels, this.keysEl);
    document.body.append(this.root);
  }
  private drag(el: HTMLElement, at: (y: number) => void, done: () => void) {
    const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); at(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); };
    el.addEventListener("pointerdown", (e) => { el.setPointerCapture(e.pointerId); this.wheels.held = true; move(e); });
    el.addEventListener("pointermove", (e) => { if (el.hasPointerCapture(e.pointerId)) move(e); });
    for (const end of ["pointerup", "pointercancel"]) el.addEventListener(end, () => { this.wheels.held = false; done(); });
  }
  toggle() { this.keysOn = !this.keysOn; this.keysEl.hidden = !this.keysOn; }
  /** Every frame: what you sit at (null: nothing with notes) and what holds your notes now (`kb:<code>` a computer key). */
  frame(map: ReturnType<typeof keyMap>, holding: Iterable<string>, dt: number, t: number) {
    const held = new Set([...holding].filter((by) => by.startsWith("kb:")).map((by) => by.slice(3)));
    const track = map?.track ?? -1;
    if (track !== this.track) {
      // leaving a track lets its bend go
      if (this.track >= 0) this.send(this.track, 0);
      this.track = track;
      this.wheels.pitch = 0; this.wheels.mod = 0; this.wheels.changed(0);
    }
    this.root.hidden = !map;
    if (!map) return;
    const key = JSON.stringify(map.caps.map((c) => c.midi));
    if (key !== this.shown) { this.shown = key; this.draw(map.caps); }
    for (const [code, el] of this.caps) el.classList.toggle("on", held.has(code));
    const semis = this.wheels.changed(this.wheels.tick(dt, t));
    if (semis !== null) this.send(track, semis);
    this.pitchKnob.style.top = `${((1 - this.wheels.pitch) / 2) * 82}px`;
    this.modKnob.style.top = `${(1 - this.wheels.mod) * 82}px`;
  }
  private cap(c: Cap): HTMLElement {
    const el = document.createElement("div"), k = document.createElement("b"), n = document.createElement("span");
    el.className = `qo-cap${c.black ? " black" : ""}`;
    k.textContent = c.key; n.textContent = c.note;
    el.append(k, n);
    this.caps.set(c.code, el);
    return el;
  }
  private draw(caps: Cap[]) {
    this.caps.clear();
    const up = document.createElement("div"), down = document.createElement("div");
    up.className = "qo-row up"; down.className = "qo-row";
    // laid out as the keys sit on a computer keyboard: the top row half a key right, a gap where R and I are
    const byCode = new Map(caps.map((c) => [c.code, c]));
    for (const code of UPPER) {
      const c = code ? byCode.get(code) : undefined;
      if (!c) { const gap = document.createElement("div"); gap.className = "qo-gap"; up.append(gap); continue; }
      up.append(this.cap(c));
    }
    for (const c of caps) if (!UPPER.includes(c.code)) down.append(this.cap(c));
    this.keysEl.replaceChildren(up, down);
  }
}
