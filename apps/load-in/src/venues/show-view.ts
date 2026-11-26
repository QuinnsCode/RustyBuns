// The show on the page: the band on stage (a marker over whoever needs you), the desk's card with the song, the crowd
// meter, what the band is asking for, what rings, and the selected channel strip. At the desk: 1 to 5 pick a channel,
// [ ] its fader, ; ' its wedge send, , . its trim, J / K move the notch finder a band, N puts a notch there or takes it
// out, Enter opens the doors. On stage: F hands up the spare guitar or swaps the bass cable, Q / E turn the wedge. At
// the guitar amp, before doors (soundcheck): 1 to 5 pick a knob, [ ] turn it; the show's guitar is baked through it.
// main.ts calls `showView` once per world, then `key`, `tick` each frame, and `hint` for the line under the crosshair.
import * as THREE from "three";
import { BANDS } from "@rustybuns/gear";
import { esc } from "@rustybuns/util";
import { assist } from "../assists.ts";
import { doors } from "../clock.ts";
import { REACH, type Answer, type World } from "../sim.ts";
import { aim } from "./dive-bar.ts";
import { showSound } from "../audio/stems.ts";
import { AMP_KNOBS, SHOW_HEAD, type AmpKnob } from "../audio/amp.ts";
import {
  AUDIENCE, SET_LIST, BAND, CHANNELS, CUE_TEXT, type Channel, type Desk, type Move, type Show, atAmp, atDesk, fixOnStage, mix, newDesk, newShow, notch, nudge,
  ring, setAmp, showState, songAt, startShow, stepShow,
} from "./show.ts";
import { crowdOf, letIn } from "../crowd/crowd.ts";
import { crowdView } from "../crowd/crowd-view.ts";

export type ShowView = {
  /** A key while playing; true when the show used it. */
  key(code: string): boolean;
  /** Each frame: doors on the clock, the set's tick, the card and the sound. */
  tick(dt: number): void;
  hint(): string | null;
  /** The show as the harness reads it, and how many songs have their guitar baked through the amp. */
  state(): ReturnType<typeof showState> & { baked: number };
  /** The harness's hands on the desk and the stage (what the keys do, without walking the keys). */
  desk: {
    nudge(ch: Channel, m: Move): void;
    notch(ch: Channel, hz: number): Answer;
    start(): Answer;
    fix(kind: "broken-string" | "dying-cable"): Answer;
    /** Soundcheck at the guitar amp: turn a knob by `by` (you stand at the amp, before doors). */
    amp(knob: AmpKnob, by: number): Answer;
    /** Run the set on for `seconds` while you stand where you are. */
    run(seconds: number): void;
  };
  dispose(): void;
};

const hzText = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
const dbText = (db: number) => (Number.isFinite(db) ? `${db > 0 ? "+" : ""}${Math.round(db)} dB` : "off");

export function showView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World): ShowView {
  const desk: Desk = newDesk(), show: Show = newShow(), sound = showSound();
  let sel: Channel = "vocal", finder = BANDS.indexOf(2500), knob: AmpKnob = "gain";
  // Bake the guitar through the amp as the band walks on with it, and again each time you set it.
  sound.bake(show.amp);
  const turn = (k: AmpKnob, by: number) => { const a = setAmp(getWorld(), show, k, by); if (a.ok) sound.bake(show.amp); return a; };
  const group = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const stage = new THREE.Mesh(new THREE.BoxGeometry(8, 0.02, 3), mat(0x2a2522));
  stage.position.set(0, 0.01, 1.5);
  group.add(stage);
  const people = (["singer", "guitarist", "bassist"] as const).map((who, i) => {
    const p = BAND[who];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, p.head - 0.6, 4, 12), mat([0x7a4b8c, 0x3d6b8c, 0x8c6b3d][i]!));
    body.position.set(p.x, (p.head - 0.6) / 2 + 0.22, p.z);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xf2b84b }));
    flag.position.set(p.x, p.head + 0.45, p.z);
    flag.visible = false;
    group.add(body, flag);
    return { who, flag };
  });
  scene.add(group);
  const card = document.createElement("div");
  card.className = "bar-card show-card";
  hud.append(card);
  // The show plays its own sound, so the house speakers' card goes; once the band is on, so does the doors clock.
  document.body.classList.add("at-show");
  let last = "";

  const whoFor = { "more-me": "singer", "broken-string": "guitarist", "dying-cable": "bassist" } as const;
  const nearBand = (who: keyof typeof BAND) => { const w = getWorld(), p = BAND[who]; return Math.hypot(w.you.x - p.x, w.you.z - p.z) <= REACH; };
  const stageFix = () => (show.open.some((c) => c.kind === "broken-string") && nearBand("guitarist") ? "broken-string" : show.open.some((c) => c.kind === "dying-cable") && nearBand("bassist") ? "dying-cable" : null);
  const nearWedge = () => { const w = getWorld(), i = w.items.find((x) => x.key === "wedge-vox"); return !!i && !w.held && Math.hypot(w.you.x - i.x, w.you.z - i.z) <= REACH + 0.4; };
  const audience = crowdView(scene);
  /** The set starts and the audience comes in. */
  const begin = () => {
    const a = startShow(show), w = getWorld();
    if (a.ok && !crowdOf(w)) letIn(w, AUDIENCE);
    return a;
  };
  const doorsOpen = () => { if (begin().ok) sound.start(); };

  function deskKey(code: string): boolean {
    const n = Number(code.replace("Digit", ""));
    if (code.startsWith("Digit") && n >= 1 && n <= CHANNELS.length) return (sel = CHANNELS[n - 1]!), true;
    const moves: Record<string, Move> = { BracketLeft: { fader: -1 }, BracketRight: { fader: 1 }, Semicolon: { send: -1 }, Quote: { send: 1 }, Comma: { trim: -1 }, Period: { trim: 1 } };
    if (moves[code]) return nudge(desk, sel, moves[code]), true;
    if (code === "KeyJ" || code === "KeyK") return (finder = Math.max(0, Math.min(BANDS.length - 1, finder + (code === "KeyJ" ? -1 : 1)))), true;
    if (code === "KeyN") return notch(desk, sel, BANDS[finder]!), true;
    if (code === "Enter") return doorsOpen(), true;
    return false;
  }

  function ampKey(code: string): boolean {
    const n = Number(code.replace("Digit", ""));
    if (code.startsWith("Digit") && n >= 1 && n <= AMP_KNOBS.length) return (knob = AMP_KNOBS[n - 1]!), true;
    if (code === "BracketLeft" || code === "BracketRight") return turn(knob, code === "BracketLeft" ? -0.5 : 0.5), true;
    return false;
  }

  function render(ringing: number[]) {
    const s = showState(getWorld(), desk, show), m = s.mix[sel], strip = desk[sel];
    document.body.classList.toggle("show-on", show.on || show.done);
    for (const p of people) p.flag.visible = show.open.some((c) => whoFor[c.kind] === p.who);
    const { song, at } = songAt(show.t);
    const lines = [
      `<b>${show.done ? "Set over" : show.on ? esc(`${song.name}, ${Math.floor(at)} s`) : "Doors: Enter"}</b>${s.solo ? " <span class=trip>guitar solo</span>" : ""}`,
      `Crowd <meter min=0 max=100 value=${s.crowd}></meter> ${s.crowd}`,
      ...show.open.map((c) => `<span class=trip>${esc(CUE_TEXT[c.kind].seen)}</span>${assist("ringNamed") ? `<small>, ${esc(CUE_TEXT[c.kind].fix)}</small>` : ""}`),
      ringing.length ? `<span class=trip>${assist("ringNamed") ? `Ringing at ${hzText(ringing[0]!)}` : "It's howling"}</span>` : `<small>${s.margin} dB before it rings</small>`,
      `<b>${sel}</b> ${m.db} dB (wants ${m.target})${m.dead ? " <span class=trip>dead</span>" : m.ok ? "" : " <span class=trip>off</span>"}`,
      `<small>trim ${dbText(strip.trim)}, wedge ${dbText(strip.send)}, notches ${strip.eq.map((b) => hzText(b.hz)).join(" ") || "none"}; finder ${hzText(BANDS[finder]!)}</small>`,
    ];
    // At the amp before doors, its panel in place of the channel strip.
    if (s.atAmp && !show.on && !show.done) {
      lines.splice(-2, 2,
        `<b>Guitar amp: ${SHOW_HEAD.name}</b> ${AMP_KNOBS.map((k) => (k === knob ? `<b>${k} ${show.amp[k]}</b>` : `${k} ${show.amp[k]}`)).join(", ")}`,
        `<small>${sound.ready < SET_LIST.length ? `baking the guitar through it, ${sound.ready} of ${SET_LIST.length} songs` : "the guitar is baked through it"}</small>`);
    }
    const html = lines.map((l) => `<div>${l}</div>`).join("");
    if (html !== last) card.innerHTML = last = html;
  }

  function tick(dt: number) {
    const w = getWorld(), left = doors("show", w.t).left;
    if (left !== null && left <= 0) doorsOpen();
    const { ringing } = stepShow(w, desk, show, dt);
    audience.update(w, crowdOf(w));
    render(show.on ? ringing : ring(w, desk).ringing);
    sound.update(show.on ? { song: songAt(show.t).index, mix: mix(desk, show), desk, ringing } : null);
  }

  return {
    key(code) {
      const w = getWorld();
      if (atDesk(w) && deskKey(code)) return sound.start(), true;
      if (atAmp(w) && !show.on && !show.done && ampKey(code)) return true;
      const fix = stageFix();
      if (code === "KeyF" && fix && !w.held) return fixOnStage(w, show, fix), true;
      if ((code === "KeyQ" || code === "KeyE") && nearWedge()) return aim(w, "wedge-vox", { turn: ((code === "KeyQ" ? -1 : 1) * Math.PI) / 12 }), true;
      return false;
    },
    tick,
    hint() {
      const fix = stageFix();
      if (fix) return fix === "broken-string" ? "F hand up the spare guitar" : "F swap the bass cable";
      if (atAmp(getWorld()) && !show.on && !show.done) return "1-5 amp knob, [ ] turn it";
      if (atDesk(getWorld())) return "1-5 channel, [ ] fader, ; ' wedge send, , . trim, J / K / N notch, Enter doors";
      if (nearWedge()) return "Q / E turn the wedge";
      return null;
    },
    state: () => ({ ...showState(getWorld(), desk, show), baked: sound.ready }),
    desk: {
      nudge: (ch, m) => nudge(desk, ch, m),
      notch: (ch, hz) => notch(desk, ch, hz),
      start: begin,
      fix: (kind) => fixOnStage(getWorld(), show, kind),
      amp: (k, by) => turn(k, by),
      run(seconds) { for (let t = 0; t < seconds && show.on; t += 0.1) stepShow(getWorld(), desk, show, 0.1); },
    },
    dispose() {
      sound.close();
      audience.dispose();
      document.body.classList.remove("at-show", "show-on");
      scene.remove(group);
      card.remove();
    },
  };
}
