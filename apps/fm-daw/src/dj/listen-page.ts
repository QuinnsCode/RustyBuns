// A listen link's page (/listen/<id>, #5878): the set's name, the track list as it comes in, and a play button. No
// sign-in. The sound comes over the set's socket as WebM chunks (src/listen.ts) and plays through MediaSource, a few
// seconds behind the decks. `qlisten` is the harness for probes and the journey test.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { check } from "@rustybuns/util/guard";
import { LIVE_TYPE, SetSays, listenSocket, setFromPath } from "./live-wire.ts";
import { stamp, type Cue } from "./record.ts";
import { followTheme } from "../ui/theme.ts";
import { waitlistCard } from "./waitlist.ts";

followTheme();
const id = setFromPath(location.pathname);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const nameEl = $("#name"), statusEl = $("#status"), list = $<HTMLOListElement>("#cues"), playB = $<HTMLButtonElement>("#play");
const audio = new Audio();

let name = "", live = false, over = false, ears = 0, bytes = 0, wanted = false;
/** The set turned this page away (full: its listener cap), or a free limit ended it. */
let full: number | null = null, endedByLimit = false, cardFor: number | null = null;
const limitEl = $("#limit");
const cues: Cue[] = [];
let ws: WebSocket | null = null;
let ms: MediaSource | null = null, sb: SourceBuffer | null = null;
const queue: ArrayBuffer[] = [];
let level: AnalyserNode | null = null, actx: AudioContext | null = null;

function draw() {
  nameEl.textContent = name || "QDJs set";
  document.title = `${name || "QDJs set"}: listen live`;
  statusEl.textContent = !id ? "This isn't a listen link." : full !== null ? "This set is full." : over ? (endedByLimit ? "The set is over: it reached a free set's limit." : "The set is over.") : !live ? "Not live right now: this page plays as soon as the DJ goes live." : `Live${ears ? `: ${ears} listening` : ""}`;
  statusEl.classList.toggle("live", live && !over);
  playB.textContent = wanted ? "Stop" : "Play";
  playB.setAttribute("aria-pressed", String(wanted));
  if (full !== cardFor) { cardFor = full; limitEl.replaceChildren(...(full !== null ? [waitlistCard("ears", full, id ?? "")] : [])); }
  list.replaceChildren(...cues.map((c) => {
    const li = document.createElement("li"), at = document.createElement("span");
    at.textContent = stamp(c.at);
    li.append(at, ` ${c.name}${c.tube ? " (YouTube: not in the stream)" : ""}`);
    return li;
  }));
}

/** A fresh player: the next bytes the set sends start it (a header and a cluster). */
function newPlayer() {
  queue.length = 0; bytes = 0; sb = null;
  ms = new MediaSource();
  const m = ms;
  audio.src = URL.createObjectURL(m);
  m.addEventListener("sourceopen", () => {
    if (ms !== m) return;
    sb = m.addSourceBuffer(LIVE_TYPE);
    sb.addEventListener("updateend", pump);
    pump();
  }, { once: true });
}

/** Append what came, one piece at a time; keep the play head a couple of seconds behind the newest sound. */
function pump() {
  if (!sb || sb.updating) return;
  const b = sb.buffered;
  if (b.length) {
    const end = b.end(b.length - 1);
    if (audio.currentTime < b.start(0) || end - audio.currentTime > 8) audio.currentTime = Math.max(b.start(b.length - 1), end - 2);
    if (wanted && audio.paused) void audio.play().catch(() => {});
    if (audio.currentTime - b.start(0) > 60) { sb.remove(b.start(0), audio.currentTime - 30); return; }
  }
  const next = queue.shift();
  if (next) try { sb.appendBuffer(next); } catch { newPlayer(); }
}

function connect() {
  if (!id || ws) return;
  const s = new WebSocket(listenSocket(location.origin, id));
  s.binaryType = "arraybuffer";
  ws = s;
  s.onmessage = (e) => {
    if (typeof e.data !== "string") {
      if (!wanted) return;
      if (!ms) newPlayer();
      queue.push(e.data as ArrayBuffer); bytes += (e.data as ArrayBuffer).byteLength;
      pump();
      return;
    }
    let v: unknown;
    try { v = JSON.parse(e.data); } catch { return; }
    const m = check(SetSays, v);
    if (!m) return;
    if (m.t === "set") {
      // a set (re)starting sends its stream from the top: a player that already had some starts over
      if (m.live && !live && bytes) newPlayer();
      name = m.name ?? ""; live = !!m.live; over = false;
      if (m.cues) cues.splice(0, cues.length, ...m.cues);
    } else if (m.t === "cue" && m.cue) cues.push(m.cue);
    else if (m.t === "ears") ears = m.ears ?? 0;
    else if (m.t === "end") { over = true; live = false; endedByLimit = !!m.why; if (m.why === "ears") full = m.n ?? 0; }
    draw();
  };
  s.onclose = () => {
    if (ws !== s) return;
    ws = null;
    // the set ended or the line dropped: keep listening for the DJ while the page wants to play
    if (wanted && full === null) setTimeout(() => { if (wanted && !ws) { ms = null; connect(); } }, over ? 3000 : 1500);
  };
}

function play(on: boolean) {
  wanted = on;
  if (on) {
    if (!level) {
      const ctx = (actx = new AudioContext()), src = ctx.createMediaElementSource(audio);
      level = ctx.createAnalyser();
      level.fftSize = 2048;
      src.connect(level).connect(ctx.destination);
    }
    void actx?.resume();
    over = false; full = null;
    // reconnect so the set sends its start again for this player
    ws?.close(); ws = null; ms = null;
    connect();
  } else { audio.pause(); ms = null; sb = null; queue.length = 0; }
  draw();
}
playB.addEventListener("click", () => play(!wanted));

/** How loud the page plays now, 0 to 1 (RMS). */
function loud(): number {
  if (!level) return 0;
  const d = new Float32Array(level.fftSize);
  level.getFloatTimeDomainData(d);
  return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
}

declare global { interface Window { qlisten: typeof harness } }
const harness = {
  play: (on = true) => play(on),
  /** The set as this page has it: its name, live or over, the track list, listeners, and the player's state. */
  state: () => ({ id, name, live, over, full: full !== null, ears, cues: [...cues], bytes, playing: !audio.paused, time: audio.currentTime, buffered: sb?.buffered.length ? sb.buffered.end(sb.buffered.length - 1) - sb.buffered.start(0) : 0, level: loud() }),
};
window.qlisten = harness;
connect();
draw();
