// The remote's page (/remote.html?room=<sesh>): the model is remote.ts; this draws it and sends what you touch.
// It makes no sound: it is a hand on the room's desk, so the jam room and the desk play what it sets.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "./remote.css";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "../account.ts";
import { apply, MASTER_MIN, type Op, type Project } from "../project.ts";
import { demoProject } from "../presets.ts";
import { connect, type NetStatus } from "../ui/net.ts";
import { localMe, myKey } from "../ui/me.ts";
import type { GrantServer } from "../grants.ts";
import { icon } from "../amp/icons.ts";
import { ROOMS } from "../studio/rooms/index.ts";
import { yours } from "../studio/builder.ts";
import { P } from "../engine/params.ts";
import { levelOp, masterOp, muteOp, myTrack, rights, spaceOp, strips, tone, toneOp, transport } from "./remote.ts";

const $ = (id: string) => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} is missing`); return e; };
const eq = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "qollab-studio" });
const token = () => { const l = eq.login(); return l && eq.fresh(l, 5_000) ? l.token : null; };
const name = eq.login()?.name || localMe().name || "Someone";
const DEFS = [...Object.values(ROOMS), ...[yours()].filter((d) => d !== null)];

let project: Project = demoProject();
let status: NetStatus = { state: "connecting", peers: 0 };
let grants: GrantServer | null = null;
let me: string | null = null;
let playing = false;
/** Each live-line peer's seat in the jam room, as their body says. */
const seats = new Map<number, string | null>();
/** A track picked by hand (a tap on its name), when you sit nowhere. */
let picked: number | null = null;
/** A finger is down: draw() moves only values, so the control under it stays the same element. */
let dragging = false;

/** An edit: yours at once, and the room's. Faders send at most one a frame, so a drag doesn't flood the World. */
const pending = new Map<string, Op>();
let flushing = false;
function edit(key: string, op: Op) {
  project = apply(project, op);
  pending.set(key, op);
  if (!flushing) { flushing = true; requestAnimationFrame(() => { flushing = false; for (const o of pending.values()) net.send(o); pending.clear(); }); }
  draw();
}
function play(on: boolean) { playing = on; net.live(transport(on)); draw(); }

const mine = () => myTrack(seats, grants?.peers ?? {}, me, DEFS, project) ?? picked;

// ---- drawing ----
interface Props { className?: string; title?: string; type?: string; disabled?: boolean; tabIndex?: number; min?: string; max?: string; step?: string; value?: string }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
function iconButton(name: string, word: string, on: boolean, click: () => void, disabled: boolean) {
  const b = el("button", { type: "button", title: word, className: on ? "on" : "", disabled }, icon(name, 26));
  b.setAttribute("aria-label", word);
  b.setAttribute("aria-pressed", String(on));
  b.onclick = click;
  return b;
}
function fader(word: string, value: number, min: number, max: number, step: number, change: (v: number) => void, disabled: boolean, color?: string) {
  const r = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), title: word, disabled });
  r.setAttribute("aria-label", word);
  if (color) r.style.setProperty("--fill", color);
  r.oninput = () => change(Number(r.value));
  return r;
}
/** A knob: drag up or down (or the arrow keys) to turn it, 0 to 1. */
function knob(name: string, word: string, value: number, change: (v: number) => void, disabled: boolean) {
  const k = el("div", { className: "knob", tabIndex: disabled ? -1 : 0, title: word });
  k.setAttribute("role", "slider");
  k.setAttribute("aria-label", word);
  k.setAttribute("aria-valuemin", "0"); k.setAttribute("aria-valuemax", "1"); k.setAttribute("aria-valuenow", value.toFixed(2));
  if (disabled) k.setAttribute("aria-disabled", "true");
  k.style.setProperty("--turn", `${-135 + value * 270}deg`);
  k.append(el("span", { className: "dial" }), icon(name, 22));
  const turn = (v: number) => { value = v; k.style.setProperty("--turn", `${-135 + v * 270}deg`); k.setAttribute("aria-valuenow", v.toFixed(2)); change(v); };
  let from: { y: number; v: number } | null = null;
  k.onpointerdown = (e) => { if (disabled) return; from = { y: e.clientY, v: value }; k.setPointerCapture(e.pointerId); };
  k.onpointermove = (e) => { if (from) turn(Math.min(1, Math.max(0, from.v + (from.y - e.clientY) / 160))); };
  k.onpointerup = k.onpointercancel = () => { from = null; };
  k.onkeydown = (e) => {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.05 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.05 : 0;
    if (d && !disabled) { e.preventDefault(); turn(Math.min(1, Math.max(0, value + d))); }
  };
  return k;
}

/** Drawing replaces the page's controls, so while a finger is down only values move; the rest redraws once it lifts (after its click). */
const lift = () => { dragging = false; setTimeout(draw); };
document.addEventListener("pointerdown", () => { dragging = true; });
document.addEventListener("pointerup", lift);
document.addEventListener("pointercancel", lift);

function draw() {
  if (dragging) return syncValues();
  const may = rights(grants, status.floor?.state ?? null, me);
  const t = mine();

  $("net").title = status.state === "online" ? `Online, ${status.peers} in the room` : status.state === "full" ? "The room turned this remote away" : status.state === "offline" ? "Offline: trying again" : "Connecting";
  $("net").className = `dot ${status.state}`;

  const top = $("top");
  top.replaceChildren(
    iconButton(playing ? "square" : "play", playing ? "Stop" : "Play", playing, () => play(!playing), !may.play),
    el("label", { className: "master", title: "Master: the room's level" }, icon("volume-2", 22),
      fader("Master", project.master ?? 0, MASTER_MIN, 0, 1, (v) => edit("master", masterOp(v)), !may.mix)),
  );

  const card = $("mine");
  if (t === null) {
    card.className = "card none";
    card.replaceChildren(el("p", {}, "Sit at an instrument in the jam room, or tap a track's name below: it comes up here."));
  } else {
    const tr = project.tracks[t], s = strips(project)[t];
    card.className = "card";
    card.style.setProperty("--track", s.color);
    card.replaceChildren(
      el("h2", { title: tr.name }, tr.name),
      el("div", { className: "row" },
        fader(`${tr.name} volume`, tr.params[P.GAIN], 0, 1, 0.01, (v) => edit(`level:${t}`, levelOp(t, v)), !may.mix, s.color),
        iconButton(tr.mute ? "volume-x" : "volume-2", tr.mute ? "Unmute" : "Mute", tr.mute, () => edit(`mute:${t}`, muteOp(t, !tr.mute)), !may.mix)),
      el("div", { className: "row knobs" },
        knob("audio-waveform", "Tone", tone(tr), (v) => edit(`tone:${t}`, toneOp(t, v)), !may.mix),
        knob("waves", "Space", tr.params[P.SEND], (v) => edit(`space:${t}`, spaceOp(t, v)), !may.mix)),
    );
  }

  $("strips").replaceChildren(...strips(project).map((s) => {
    const pick = el("button", { type: "button", className: "name", title: `${s.name}: make it yours` }, s.name);
    pick.style.setProperty("--track", s.color);
    pick.onclick = () => { picked = s.track; draw(); };
    const row = el("div", { className: `strip${s.track === t ? " mine" : ""}${s.mute ? " muted" : ""}` }, pick,
      fader(`${s.name} volume`, s.level, 0, 1, 0.01, (v) => edit(`level:${s.track}`, levelOp(s.track, v)), !may.mix, s.color),
      iconButton(s.mute ? "volume-x" : "volume-2", s.mute ? `Unmute ${s.name}` : `Mute ${s.name}`, s.mute, () => edit(`mute:${s.track}`, muteOp(s.track, !s.mute)), !may.mix));
    row.dataset.track = String(s.track);
    return row;
  }));
  $("why").hidden = may.mix && may.play;
  $("why").textContent = !may.mix && !may.play ? "Listening only: the leader hasn't let you mix or play" : !may.mix ? "The leader hasn't let you mix: the faders are theirs" : "The leader hasn't let you start or stop the groove";
}
/** Mid-drag: only the values move, so the slider under your finger stays the same element. */
function syncValues() {
  const levels = strips(project);
  for (const row of document.querySelectorAll<HTMLElement>(".strip")) {
    const r = row.querySelector("input"), s = levels[Number(row.dataset.track)];
    if (r && s && r !== document.activeElement) r.value = String(s.level);
  }
}

// the socket last: it says how it stands at once, and draw() needs everything above
const net = connect({
  onSnapshot(p) { if (p) { project = p; draw(); } },
  onOp(op) { project = apply(project, op); draw(); },
  onLive(from, e) {
    if (e.t === "body") { seats.set(from, e.seat ?? null); draw(); }
    else if (e.t === "play" || e.t === "stop") { playing = e.t === "play"; draw(); }
  },
  onGone(from) { seats.delete(from); draw(); },
  onStatus(s) { status = s; draw(); },
  onChat(m) { if (m.t === "chat") { me = m.you; draw(); } },
  onGrants(m) { grants = m; draw(); },
  onTakeBytes() {},
  hello: () => ({ key: myKey(), name }),
  token,
});
$("sign").hidden = !!eq.login();
$("sign").setAttribute("href", `/jam.html${location.search}`);
draw();

// what a probe reads (bun run probe fm-daw /remote.html?room=<sesh> --js "qremote.state()")
Object.assign(window, { qremote: {
  state: () => ({ net: status.state, me, playing, mine: mine(), may: rights(grants, status.floor?.state ?? null, me), master: project.master ?? 0, strips: strips(project) }),
  pick: (track: number | null) => { picked = track; draw(); },
} });
