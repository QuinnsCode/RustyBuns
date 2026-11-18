// Band night on the page: the stage with a mark for each mic and the DI, the input list on a clipboard (a .paper card)
// with what each channel came up as at line check, and the line check you hear. At the desk V switches 48 V and L has
// the next player play alone: you hear what their channel really carries (clean, humming, crackling, or nothing). K at
// the bass DI presses its ground lift. main.ts calls `bandNightView` once per world, then `key` and `tick` each frame.
import * as THREE from "three";
import { esc } from "@rustybuns/util";
import type { Heard, Sound } from "@rustybuns/gear";
import { INPUTS, PASS, ZONES, type Judged, type Show, bandNightState, check, judge, keyedRuns, night, show } from "./band-night.ts";
import { REACH, type World } from "../sim.ts";
import type { Cables } from "../cables/cables.ts";
import type { Switches } from "../audio/hear.ts";

export type BandNightView = {
  key(code: string): boolean;
  tick(): Judged;
  /** Have the player on `channel` play alone (or the next one not checked yet): what came up, and you hear it. */
  check(channel?: number): Heard | null;
  phantom(on: boolean): void;
  lift(on: boolean): void;
  doors(): Show;
  hint(): string | null;
  state(): ReturnType<typeof bandNightState>;
  dispose(): void;
};

/** Each input's sound as a player plays it alone, about a second: a kick's thump, a snare's crack, bass and guitar notes, a voice. */
function play(ctx: AudioContext, channel: number, sound: Sound) {
  const t = ctx.currentTime, out = ctx.createGain();
  out.gain.value = 0.25;
  out.connect(ctx.destination);
  if (sound === "silent") return;
  const tone = (type: OscillatorType, hz: number, at: number, len: number, to = hz) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t + at);
    o.frequency.exponentialRampToValueAtTime(to, t + at + len);
    g.gain.setValueAtTime(0.8, t + at);
    g.gain.exponentialRampToValueAtTime(0.001, t + at + len);
    o.connect(g).connect(out);
    o.start(t + at);
    o.stop(t + at + len);
  };
  const noise = (at: number, len: number, level = 0.6) => {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * level * (1 - i / d.length) ** 3;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(out);
    s.start(t + at);
  };
  for (const at of [0, 0.3, 0.6]) {
    if (channel === 1) tone("sine", 110, at, 0.25, 45);
    else if (channel === 2) (noise(at, 0.18), tone("triangle", 220, at, 0.08, 160));
    else if (channel === 3) tone("sawtooth", 82, at, 0.28, 80);
    else if (channel === 4) tone("square", 196, at, 0.28, 195);
    else tone("sine", channel === 5 ? 330 : 440, at, 0.28, channel === 5 ? 340 : 450);
  }
  // A ground loop's mains hum under it, or a bad connector's clicks over it.
  if (sound === "hum") for (const hz of [60, 120, 180]) tone("sine", hz, 0, 1, hz);
  if (sound === "crackle") for (let i = 0; i < 14; i++) noise(Math.random() * 0.9, 0.006, 1);
}

export function bandNightView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World, getCables: () => Cables, getOn: () => Switches): BandNightView {
  const runs = () => keyedRuns(getCables());
  let j = judge(getWorld(), runs(), getOn());
  const group = new THREE.Group();
  const s = ZONES.stage, d = ZONES.desk;
  const stage = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, 0.03, s.z1 - s.z0), new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 0.9 }));
  stage.position.set((s.x0 + s.x1) / 2, 0.015, (s.z0 + s.z1) / 2);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xe8d9a0, transparent: true, opacity: 0.55 });
  const deskMark = new THREE.Mesh(new THREE.PlaneGeometry(d.x1 - d.x0, d.z1 - d.z0), new THREE.MeshBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.25 }));
  deskMark.rotation.x = -Math.PI / 2;
  deskMark.position.set((d.x0 + d.x1) / 2, 0.004, (d.z0 + d.z1) / 2);
  group.add(stage, deskMark);
  // A gaffer-tape cross at each input's mark on the stage plot.
  for (const l of INPUTS) for (const r of [Math.PI / 4, -Math.PI / 4]) {
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.05), markMat);
    tape.rotation.set(-Math.PI / 2, 0, r);
    tape.position.set(l.mark.x, 0.035, l.mark.z);
    group.add(tape);
  }
  scene.add(group);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.append(card);
  let last = "", opened: Show | null = null, ctx: AudioContext | null = null;
  const near = (gearId: string) => {
    const w = getWorld(), i = w.items.find((x) => x.gear === gearId);
    return !!i && i.key !== w.held?.key && Math.hypot(w.you.x - i.x, w.you.z - i.z) <= REACH;
  };
  const SOUND: Record<Sound, string> = { clean: "clean", hum: "hums", crackle: "crackles", silent: "nothing" };

  const view: BandNightView = {
    key(code) {
      if (code === "Enter") return view.doors(), true;
      if (code === "KeyV" && near("mixer-small")) return view.phantom(!night(getWorld()).phantom), true;
      if (code === "KeyL" && near("mixer-small") && !opened) return view.check(), true;
      if (code === "KeyK" && near("di-box")) return view.lift(!night(getWorld()).lift), true;
      return false;
    },
    check(channel) {
      const w = getWorld(), n = night(w);
      const ch = channel ?? INPUTS.find((l) => !n.checked.has(l.channel))?.channel ?? (n.last ? (n.last.channel % INPUTS.length) + 1 : 1);
      const h = check(w, runs(), getOn(), ch);
      if (h && typeof AudioContext !== "undefined") {
        try {
          play((ctx ??= new AudioContext()), h.on ?? h.channel, h.sound);
        } catch { /* no audio in this browser: the card still says what came up */ }
      }
      return h;
    },
    phantom: (on) => void (night(getWorld()).phantom = on),
    lift: (on) => void (night(getWorld()).lift = on),
    tick() {
      const w = getWorld(), r = runs();
      j = judge(w, r, getOn());
      const n = night(w), st = bandNightState(w, r, getOn());
      const row = (h: Heard) => {
        const done = n.checked.has(h.channel);
        const said = !done ? "" : h.on === null ? " - nothing" : ` - on ${h.on}, ${SOUND[h.sound]}`;
        return `<span class="pen ${done ? (h.ok ? "pass" : "trip") : ""}">${h.channel}. ${esc(h.what)}${said}</span>`;
      };
      const lines = [
        `<b class="marker">${opened ? "Doors open" : "Band night"}</b>`,
        ...st.jobs.map((x) => `<span class="${x.done ? "pass" : ""}">${x.done ? "[x]" : "[ ]"} ${esc(x.job)}</span>`),
        "<b>Input list</b>",
        ...j.heard.map(row),
        n.last ? `<small class="${n.last.ok ? "pass" : "trip"}">${esc(n.last.why ?? `${n.last.what}: on ${n.last.on}, clean`)}</small>` : "",
        opened ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass, paid $${opened.pay} of $${opened.fee}</span>` : "<small>L line check, V 48 V at the desk; K lift at the DI; Enter doors</small>",
      ];
      const html = lines.filter(Boolean).map((l) => `<div>${l}</div>`).join("");
      if (html !== last) card.innerHTML = last = html;
      return j;
    },
    doors: () => (opened = show(getWorld(), runs(), getOn())),
    hint: () => {
      const n = night(getWorld());
      if (near("mixer-small")) return `L line check, V 48 V (${n.phantom ? "on" : "off"})`;
      if (near("di-box")) return `K ground lift (${n.lift ? "lifted" : "down"})`;
      return null;
    },
    state: () => bandNightState(getWorld(), runs(), getOn()),
    dispose() {
      void ctx?.close();
      scene.remove(group);
      card.remove();
    },
  };
  return view;
}
