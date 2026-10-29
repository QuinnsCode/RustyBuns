import { useEffect, useRef, useState } from "react";
import { AudioOut, START_DB, dbToGain, fetchWasm } from "./audio.ts";
import { connect, roomName, type Net, type NetStatus } from "./net.ts";
import { Cursors, dropCursor, moveCursor } from "./Cursors.tsx";
import { FullCard } from "./Full.tsx";
import { QWERTY, startMidi } from "./input.ts";
import { onCc } from "./learn.ts";
import { pushTick, useTick } from "./store.ts";
import { TRACK_COLORS } from "./colors.ts";
import { DrumGrid } from "./DrumGrid.tsx";
import { PianoRoll } from "./PianoRoll.tsx";
import { PatchEditor } from "./PatchEditor.tsx";
import { Keys } from "./Keys.tsx";
import { Meter } from "./Meter.tsx";
import { Bench } from "./Bench.tsx";
import { Perform, STUTTERS } from "./Perform.tsx";
import { loadSound } from "../sounds.ts";
import { apply, audible, lettingGo, loopBeats, BAR_CHOICES, BEATS_PER_BAR, type Live, type Note, type Op, type Project, type TrackDoc } from "../project.ts";
import { demoProject, KIT, randomPatch } from "../presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "../drums.ts";
import { SONGS } from "../songs.ts";
import { GRIDS, quantize, quantizeNote } from "../quantize.ts";
import { TsEngine, type FmEngine } from "../engine/engine.ts";
import { WasmEngine, instantiateFm } from "../engine/wasm.ts";
import { renderProject, loopSeconds } from "../engine/offline.ts";
import { encodeWav } from "../engine/wav.ts";
import { saveBounce, reveal } from "../actions/files.ts";
import type { FromWorklet, ToWorklet } from "../engine/messages.ts";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./app.css";

const UNDO_LIMIT = 100;
const PAGE_BEATS = 8 * BEATS_PER_BAR;
/** A song (past 32 bars) bounces once; a loop four times. */
const bounceLoops = (p: Project) => (p.bars > 32 ? 1 : 4);

function Pager(props: { page: number; pages: number; onPage(p: number): void }) {
  const bar = props.page * 8 + 1;
  return (
    <div className="machine" aria-label="Page">
      <button className="ghost" onClick={() => props.onPage(Math.max(props.page - 1, 0))} disabled={props.page === 0} title="Earlier 8 bars">‹</button>
      <span className="silk">Bars {bar}–{bar + 7} of {props.pages * 8}</span>
      <button className="ghost" onClick={() => props.onPage(Math.min(props.page + 1, props.pages - 1))} disabled={props.page === props.pages - 1} title="Later 8 bars">›</button>
    </div>
  );
}
const GROUP_MS = 800;
const COUNT_IN = 4;

/** Everything the worklet needs to mirror a project. */
function loadMsg(p: Project): ToWorklet {
  return {
    t: "load", params: p.tracks.flatMap((t) => t.params), notes: p.tracks.map((t) => t.notes), auto: p.tracks.map((t) => t.auto ?? []),
    bpm: p.bpm, swing: p.swing, loopBeats: loopBeats(p), audible: audible(p), space: p.space, squash: p.squash,
  };
}

/** The smallest worklet update for an op that's already been applied. */
function opMsg(op: Op, next: Project): ToWorklet {
  switch (op.t) {
    case "param": return { t: "param", track: op.track, i: op.i, v: next.tracks[op.track].params[op.i] };
    case "notes": return { t: "notes", track: op.track, notes: next.tracks[op.track].notes };
    case "track": return { t: "audible", mask: audible(next) };
    case "global":
      if (op.bpm === undefined && op.swing === undefined && op.bars === undefined) {
        if (op.space !== undefined && op.squash === undefined) return { t: "space", amount: next.space };
        if (op.squash !== undefined && op.space === undefined) return { t: "squash", amount: next.squash };
      }
      return loadMsg(next);
    default: return loadMsg(next);
  }
}

export function App() {
  const [project, setProject] = useState<Project>(demoProject);
  const proj = useRef(project);
  const [selected, setSelected] = useState(0);
  const [audio, setAudio] = useState<AudioOut | null>(null);
  const audioRef = useRef<AudioOut | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [masterDb, setMasterDb] = useState(START_DB);
  const [engine, setEngine] = useState<"ts" | "rust">("ts");
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [metro, setMetro] = useState(false);
  const [gridIdx, setGridIdx] = useState(2);
  const [strength, setStrength] = useState(1);
  const [inputQ, setInputQ] = useState(true);
  const [octave, setOctave] = useState(0);
  const [held, setHeld] = useState<Set<number>>(() => new Set());
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [netStatus, setNetStatus] = useState<NetStatus>({ state: "connecting", peers: 0 });
  const [view, setView] = useState<"pattern" | "engines">("pattern");
  const [page, setPage] = useState(0);
  const [repeat, setRepeatState] = useState(0);
  const [bend, setBendState] = useState(0);
  const [bounce, setBounce] = useState<{ busy: boolean; path?: string; saved?: boolean; error?: string }>({ busy: false });
  const transportOn = useTick((t) => t.playing || t.countIn > 0);
  const counting = useTick((t) => (t.countIn > 0 ? Math.ceil(t.countIn) : 0));

  const undo = useRef<Project[]>([]);
  const redo = useRef<Project[]>([]);
  const lastGroup = useRef({ key: "", at: 0 });
  const net = useRef<Net | null>(null);
  // the keyboard and MIDI handlers are registered once; they read these
  // the sesh's floor: held or closed by its maker, a guest's edits and hands stay in their own page
  const floor = netStatus.state === "online" ? netStatus.floor : undefined;
  const locked = !!floor && floor.state !== "free" && !floor.host;
  const live = useRef({ selected, octave, recording, gridIdx, strength, inputQ, transportOn, countIn, repeat, locked, floor });
  live.current = { selected, octave, recording, gridIdx, strength, inputQ, transportOn, countIn, repeat, locked, floor };

  const send = (m: ToWorklet) => audioRef.current?.send(m);

  function commit(op: Op, opts: { remote?: boolean; group?: string } = {}) {
    if (!opts.remote && live.current.locked) return;
    const prev = proj.current;
    const next = apply(prev, op);
    if (next === prev) return;
    if (!opts.remote) {
      const now = performance.now();
      const grouped = opts.group && lastGroup.current.key === opts.group && now - lastGroup.current.at < GROUP_MS;
      if (!grouped) { undo.current.push(prev); if (undo.current.length > UNDO_LIMIT) undo.current.shift(); }
      lastGroup.current = { key: opts.group ?? "", at: now };
      redo.current = [];
      net.current?.send(op);
    }
    proj.current = next;
    setProject(next);
    send(opMsg(op, next));
  }

  function history(dir: "undo" | "redo") {
    const from = dir === "undo" ? undo.current : redo.current;
    const to = dir === "undo" ? redo.current : undo.current;
    if (live.current.locked) return;
    const p = from.pop();
    if (!p) return;
    to.push(proj.current);
    const op: Op = { t: "replace", project: p };
    proj.current = p;
    setProject(p);
    send(loadMsg(p));
    net.current?.send(op);
    lastGroup.current = { key: "", at: 0 };
  }

  // ---- audio ----
  function onWorklet(m: FromWorklet) {
    if (m.t === "tick") pushTick(m);
    else if (m.t === "engine") { setEngine(m.kind); setEngineNote(m.error ?? null); }
    else if (m.t === "rec") {
      const { gridIdx, strength, inputQ } = live.current;
      const L = loopBeats(proj.current);
      const note = inputQ ? quantizeNote(m.note, GRIDS[gridIdx].beats, strength, L) : m.note;
      const t = proj.current.tracks[m.track];
      commit({ t: "notes", track: m.track, notes: [...t.notes, note] }, { group: "rec" });
    }
  }

  async function startAudio() {
    setStartError(null);
    try {
      const a = await AudioOut.start(onWorklet);
      audioRef.current = a;
      a.send(loadMsg(proj.current));
      a.send({ t: "master", gain: dbToGain(masterDb) });
      a.send({ t: "metro", on: metro });
      setAudio(a);
    } catch (e) { setStartError((e as Error).message); }
  }

  useEffect(() => () => { void audioRef.current?.ctx.close(); }, []);

  // ---- world ----
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const n = connect({
      onSnapshot(p) {
        if (!p) { n.init(proj.current); return; }
        undo.current = []; redo.current = [];
        commit({ t: "replace", project: p }, { remote: true });
      },
      onOp(op) { commit(op, { remote: true }); },
      onLive,
      onGone,
      onStatus: setNetStatus,
    });
    net.current = n;
    return () => { n.close(); net.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // ---- the live line: other players' hands, heard here, recorded only into their own take ----
  const peerState = useRef(new Map<number, { bends: Set<number>; repeat: boolean }>());
  const peer = (from: number) => {
    let s = peerState.current.get(from);
    if (!s) peerState.current.set(from, (s = { bends: new Set(), repeat: false }));
    return s;
  };
  function onLive(from: number, e: Live) {
    const key = (track: number, midi: number) => `net:${from}:${track}:${midi}`;
    if (e.t === "on") noteOn(key(e.track, e.midi), e.track, e.midi, e.vel, false);
    else if (e.t === "off") noteOff(key(e.track, e.midi));
    else if (e.t === "bend") { peer(from).bends.add(e.track); send({ t: "bend", track: e.track, semis: e.semis }); }
    else if (e.t === "repeat") { peer(from).repeat = e.beats > 0; setRepeatState(e.beats); send({ t: "repeat", beats: e.beats }); }
    else if (e.t === "play") send({ t: "play", countIn: 0 });
    else if (e.t === "stop") stopHere();
    else moveCursor(from, e.x, e.y);
  }
  function onGone(from: number) {
    for (const k of [...liveNotes.current.keys()]) if (k.startsWith(`net:${from}:`)) noteOff(k);
    const s = peerState.current.get(from);
    peerState.current.delete(from);
    for (const track of s?.bends ?? []) send({ t: "bend", track, semis: 0 });
    if (s?.repeat) { setRepeatState(0); send({ t: "repeat", beats: 0 }); }
    dropCursor(from);
  }
  // your pointer, for everyone else, about 20 times a second
  useEffect(() => {
    let last = 0;
    const move = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      live1({ t: "cursor", x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [solo, setSolo] = useState(false);
  const live1 = (e: Live) => { if (!live.current.locked || lettingGo(e)) net.current?.live(e); };
  // the maker took the floor: let go of what this page was playing into the room
  useEffect(() => {
    if (!locked || !audioRef.current) return;
    releaseAll();
    if (live.current.repeat) setRepeat(0);
    if (bend) setBend(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);
  // a pitch wheel sends hundreds a second: share at most 25, always the last one
  const bendOut = useRef<{ at: number; timer?: ReturnType<typeof setTimeout>; e?: Live }>({ at: 0 });
  function shareBend(e: Live) {
    const b = bendOut.current, wait = b.at + 40 - performance.now();
    b.e = e;
    if (b.timer) return;
    b.timer = setTimeout(() => { b.timer = undefined; b.at = performance.now(); if (b.e) live1(b.e); }, Math.max(wait, 0));
  }

  // ---- notes in ----
  const liveNotes = useRef(new Map<string, { track: number; midi: number; share: boolean }>());
  /** `share` false: a note from the live line, so it isn't sent back or recorded here. */
  function noteOn(key: string, track: number, midi: number, vel: number, share = true) {
    if (midi < 0 || midi > 127 || liveNotes.current.has(key)) return;
    liveNotes.current.set(key, { track, midi, share });
    send({ t: "on", track, midi, vel, rec: share });
    if (share) live1({ t: "on", track, midi, vel });
    setHeld((h) => new Set(h).add(midi));
  }
  function noteOff(key: string) {
    const n = liveNotes.current.get(key);
    if (!n) return;
    liveNotes.current.delete(key);
    send({ t: "off", track: n.track, midi: n.midi });
    if (n.share) live1({ t: "off", track: n.track, midi: n.midi });
    setHeld((h) => { const s = new Set(h); s.delete(n.midi); return s; });
  }
  function releaseAll() { for (const k of [...liveNotes.current.keys()]) noteOff(k); }
  const keyBase = (track: number, oct: number) => proj.current.tracks[track].root + 12 * oct;

  function audition(track: number) {
    const m = proj.current.tracks[track].root;
    noteOn(`aud:${track}`, track, m, 0.85);
    setTimeout(() => noteOff(`aud:${track}`), 300);
  }

  // ---- performance: not saved, not undone ----
  function setRepeat(beats: number) { setRepeatState(beats); send({ t: "repeat", beats }); live1({ t: "repeat", beats }); }
  function setBend(semis: number) {
    const track = live.current.selected;
    setBendState(semis);
    send({ t: "bend", track, semis });
    shareBend({ t: "bend", track, semis });
  }

  // ---- transport: everyone in the room plays and stops together ----
  function play() { send({ t: "play", countIn: 0 }); live1({ t: "play" }); }
  function stopHere() { send({ t: "stop" }); setRecording(false); send({ t: "rec", on: false }); }
  function stop() { stopHere(); live1({ t: "stop" }); }
  function toggleRecord() {
    const { recording, transportOn, countIn } = live.current;
    if (recording) { setRecording(false); send({ t: "rec", on: false }); return; }
    setRecording(true);
    send({ t: "rec", on: true });
    if (!transportOn) send({ t: "play", countIn: countIn ? COUNT_IN : 0 });
  }
  function panic() { releaseAll(); stop(); setRepeatState(0); send({ t: "panic" }); }

  async function chooseEngine(kind: "ts" | "rust") {
    setEngineNote(null);
    try { await audioRef.current?.useEngine(kind); } catch (e) { setEngineNote((e as Error).message); }
  }

  // ---- keyboard ----
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      return el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range" && (el as HTMLInputElement).type !== "checkbox");
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyZ") { e.preventDefault(); history(e.shiftKey ? "redo" : "undo"); return; }
      if (mod || e.altKey) return;
      // Esc stops all sound; the sesh's maker also takes the floor
      if (e.code === "Escape") { if (live.current.floor?.host && live.current.floor.state === "free") net.current?.floor("held"); panic(); return; }
      if (!audioRef.current) return;
      if (e.code === "Space") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        if (!e.repeat) (live.current.transportOn ? stop : play)();
        return;
      }
      if (e.repeat) { if (e.code in QWERTY) e.preventDefault(); return; }
      if (e.code === "KeyR") { toggleRecord(); return; }
      const stutter = STUTTERS.find((s) => `Key${s.key}` === e.code);
      if (stutter) { setRepeat(stutter.beats); return; }
      if (e.code === "KeyZ") { setOctave((o) => Math.max(o - 1, -3)); return; }
      if (e.code === "KeyX") { setOctave((o) => Math.min(o + 1, 3)); return; }
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (digit) { setSelected(digit[1] === "0" ? 9 : Number(digit[1]) - 1); return; }
      const semi = QWERTY[e.code];
      if (semi !== undefined) {
        e.preventDefault();
        const { selected, octave } = live.current;
        noteOn(`kb:${e.code}`, selected, keyBase(selected, octave) + semi, e.shiftKey ? 1 : 0.75);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code in QWERTY) noteOff(`kb:${e.code}`);
      const stutter = STUTTERS.find((s) => `Key${s.key}` === e.code);
      if (stutter && live.current.repeat === stutter.beats) setRepeat(0);
    };
    const blur = () => { releaseAll(); if (audioRef.current) setRepeat(0); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- MIDI ----
  useEffect(() => {
    if (!audio) return;
    let stopMidi: (() => void) | null = null;
    void startMidi({
      on(note, vel) {
        const { selected } = live.current;
        const t = proj.current.tracks[selected];
        // drums: middle C plays the drum's own note; synths play what you press
        noteOn(`midi:${note}`, selected, t.kind === "drum" ? t.root + note - 60 : note, vel);
      },
      off(note) { noteOff(`midi:${note}`); },
      panic,
      bend(x) { setBend(x * 2); },
      cc(n, x) {
        const { selected } = live.current;
        const hit = onCc(n, x);
        if (hit) commit({ t: "param", track: selected, i: hit.i, v: hit.v }, { group: `p:${selected}:${hit.i}` });
      },
      devices: setMidiDevices,
    }).then((s) => { stopMidi = s; });
    return () => stopMidi?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  // ---- bounce ----
  async function doBounce() {
    setBounce({ busy: true });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const p = proj.current, sr = 48000;
      let e: FmEngine = new TsEngine(sr);
      if (engine === "rust") {
        const bytes = await fetchWasm();
        if (bytes) e = new WasmEngine(await instantiateFm(bytes), sr);
      }
      const pcm = renderProject(e, p, sr, loopSeconds(p, bounceLoops(p)), dbToGain(-6));
      e.free?.();
      const wav = encodeWav(pcm, sr);
      try {
        const path = await saveBounce("FM DAW", toBase64(wav));
        setBounce({ busy: false, path, saved: true });
      } catch {
        // no desktop host (browser or edge): hand the file to the browser instead
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }));
        a.download = "fm-daw-bounce.wav";
        a.click();
        setBounce({ busy: false, path: "Downloaded fm-daw-bounce.wav" });
      }
    } catch (err) { setBounce({ busy: false, error: (err as Error).message }); }
  }

  const t = project.tracks[selected];
  const L = loopBeats(project);
  const grid = GRIDS[gridIdx];
  // Long songs are edited 8 bars at a time: the grid and roll see a window of
  // the timeline, and edits are mapped back into the whole thing.
  const pages = Math.max(1, Math.ceil(L / PAGE_BEATS));
  const pg = Math.min(page, pages - 1);
  const win = { from: pg * PAGE_BEATS, span: Math.min(PAGE_BEATS, L - pg * PAGE_BEATS) };
  const inWin = (n: Note) => n.s >= win.from && n.s < win.from + win.span;
  const windowed = (tr: TrackDoc): TrackDoc => ({ ...tr, notes: tr.notes.filter(inWin).map((n) => ({ ...n, s: n.s - win.from })) });
  const unwindow = (tr: TrackDoc, ns: Note[]) => [...tr.notes.filter((n) => !inWin(n)), ...ns.map((n) => ({ ...n, s: n.s + win.from }))];
  const color = TRACK_COLORS[selected];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>FM DAW</h1>
          <span className="dim">12 tracks · FM or analog · Rust or TS</span>
        </div>

        <label className="field"><span className="silk">Song</span>
          <select value="" onChange={(e) => { const s = SONGS[Number(e.currentTarget.value)]; if (s) commit({ t: "replace", project: s.make() }); }}>
            <option value="" disabled>Load a song…</option>
            {SONGS.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
          </select>
        </label>

        <div className="transport" aria-label="Transport">
          <button className={transportOn ? "play on" : "play"} onClick={transportOn ? stop : play} disabled={!audio} title="Play / stop (Space)">
            {transportOn ? "■ Stop" : "▶ Play"}
          </button>
          <button className={recording ? "rec on" : "rec"} onClick={toggleRecord} disabled={!audio} title="Record (R)" aria-pressed={recording}>
            ● {counting ? counting : "Rec"}
          </button>
          <label className="check"><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.currentTarget.checked)} /> Count-in</label>
          <label className="check"><input type="checkbox" checked={metro} onChange={(e) => { setMetro(e.currentTarget.checked); send({ t: "metro", on: e.currentTarget.checked }); }} /> Click</label>
        </div>

        <div className="tempo">
          <label className="field"><span className="silk">BPM</span>
            <input type="number" min={40} max={240} value={project.bpm}
              onChange={(e) => { const v = Number(e.currentTarget.value); if (v >= 40 && v <= 240) commit({ t: "global", bpm: v }, { group: "bpm" }); }} />
          </label>
          <label className="field"><span className="silk">Swing {Math.round(project.swing * 100)}%</span>
            <input type="range" min={0} max={60} value={Math.round(project.swing * 100)}
              onChange={(e) => commit({ t: "global", swing: Number(e.currentTarget.value) / 100 }, { group: "swing" })} />
          </label>
          <label className="field" title="Reverb and dotted-eighth delay on everything above the bass"><span className="silk">Space {Math.round(project.space * 100)}%</span>
            <input type="range" min={0} max={100} value={Math.round(project.space * 100)}
              onChange={(e) => commit({ t: "global", space: Number(e.currentTarget.value) / 100 }, { group: "space" })} />
          </label>
          <label className="field" title="Multiband squash on the master: loud parts down, quiet ones up, in three bands. Dense and in your face"><span className="silk">Squash {Math.round(project.squash * 100)}%</span>
            <input type="range" min={0} max={100} value={Math.round(project.squash * 100)}
              onChange={(e) => commit({ t: "global", squash: Number(e.currentTarget.value) / 100 }, { group: "squash" })} />
          </label>
          <div className="field"><span className="silk">Bars</span>
            <div className="seg">
              {!(BAR_CHOICES as readonly number[]).includes(project.bars) && <button className="on">{project.bars}</button>}
              {BAR_CHOICES.map((b) => (
                <button key={b} className={project.bars === b ? "on" : ""} onClick={() => commit({ t: "global", bars: b })}
                  title={b < project.bars ? "Notes past the new end are removed (undo brings them back)" : undefined}>{b}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="out">
          <div className="field"><span className="silk">Engine</span>
            <div className="seg">
              <button className={engine === "ts" ? "on" : ""} onClick={() => chooseEngine("ts")} disabled={!audio}>TS</button>
              <button className={engine === "rust" ? "on" : ""} onClick={() => chooseEngine("rust")} disabled={!audio}>Rust</button>
            </div>
          </div>
          <label className="field master"><span className="silk">Master {masterDb <= -60 ? "−∞" : `${masterDb} dB`}</span>
            <input type="range" min={-60} max={0} value={masterDb}
              onChange={(e) => { const v = Number(e.currentTarget.value); setMasterDb(v); send({ t: "master", gain: dbToGain(v) }); }} />
          </label>
          <Meter />
          <button className="panic" onClick={panic} title="Stop all sound (Esc)">Panic</button>
        </div>
      </header>
      {engineNote && <p className="note-bar" role="status">{engineNote}</p>}

      <div className="body">
        <nav className="tracks" aria-label="Tracks">
          {project.tracks.map((tr, i) => (
            <div key={i} className={i === selected ? "track sel" : "track"} style={{ "--track": TRACK_COLORS[i] } as React.CSSProperties}>
              <button className="track-name" onClick={() => { setSelected(i); }} onDoubleClick={() => audition(i)}>
                {i < 10 && <kbd>{(i + 1) % 10}</kbd>} {tr.name}<span className="kind">{tr.kind}</span>
              </button>
              <button className={tr.mute ? "ms on" : "ms"} aria-pressed={tr.mute} onClick={() => commit({ t: "track", track: i, mute: !tr.mute })} title="Mute">M</button>
              <button className={tr.solo ? "ms solo on" : "ms solo"} aria-pressed={tr.solo} onClick={() => commit({ t: "track", track: i, solo: !tr.solo })} title="Solo">S</button>
            </div>
          ))}
        </nav>

        <main className="center">
          <div className="toolbar">
            <div className="seg tabs">
              <button className={view === "pattern" ? "on" : ""} onClick={() => setView("pattern")}>Pattern</button>
              <button className={view === "engines" ? "on" : ""} onClick={() => setView("engines")}>Engine race</button>
            </div>
            <label className="field inline"><span className="silk">Grid</span>
              <select value={gridIdx} onChange={(e) => setGridIdx(Number(e.currentTarget.value))}>
                {GRIDS.map((g, i) => <option key={g.label} value={i}>{g.label}</option>)}
              </select>
            </label>
            <label className="field inline"><span className="silk">Strength {Math.round(strength * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(strength * 100)} onChange={(e) => setStrength(Number(e.currentTarget.value) / 100)} />
            </label>
            <label className="check" title="Quantize notes as they're recorded"><input type="checkbox" checked={inputQ} onChange={(e) => setInputQ(e.currentTarget.checked)} /> Quantize input</label>
            <button className="ghost" onClick={() => commit({ t: "notes", track: selected, notes: quantize(t.notes, grid.beats, strength, L) })}>Quantize {t.name}</button>
            <button className="ghost" onClick={() => commit({ t: "notes", track: selected, notes: [] })}>Clear {t.name}</button>
            <span className="spacer" />
            <button className="ghost" onClick={() => history("undo")} title="Undo (⌘Z)">Undo</button>
            <button className="ghost" onClick={() => history("redo")} title="Redo (⇧⌘Z)">Redo</button>
          </div>

          {view === "engines" ? (
            <Bench project={project} wasm={fetchWasm} />
          ) : t.kind === "drum" ? (<>
            <div className="machine" aria-label="Drum machine">
              <span className="silk">Drum machine</span>
              <label className="field inline"><span className="silk">Groove</span>
                <select value="" onChange={(e) => { const g = GROOVES[Number(e.currentTarget.value)]; if (g) commit({ t: "replace", project: applyGroove(proj.current, g) }); }}>
                  <option value="" disabled>Write a groove…</option>
                  {GROOVES.map((g, i) => <option key={g.name} value={i}>{g.name} · {g.bpm}</option>)}
                </select>
              </label>
              <label className="field inline"><span className="silk">Kit</span>
                <select value="" onChange={(e) => { const k = KITS[Number(e.currentTarget.value)]; if (k) commit({ t: "replace", project: applyKit(proj.current, k) }); }}>
                  <option value="" disabled>Swap the kit…</option>
                  {KITS.map((k, i) => <option key={k.name} value={i}>{k.name}</option>)}
                </select>
              </label>
            </div>
            {pages > 1 && <Pager page={pg} pages={pages} onPage={setPage} />}
            <DrumGrid tracks={project.tracks.map(windowed)} colors={TRACK_COLORS} selected={selected} loopBeats={win.span} from={win.from}
              onSelect={setSelected} onAudition={audition}
              onNotes={(i, notes) => commit({ t: "notes", track: i, notes: unwindow(project.tracks[i], notes) })} />
          </>) : (<>
            {pages > 1 && <Pager page={pg} pages={pages} onPage={setPage} />}
            <PianoRoll key={selected} track={windowed(t)} color={color} loopBeats={win.span} from={win.from} grid={Math.min(grid.beats, 0.25)}
              onNotes={(notes: Note[]) => commit({ t: "notes", track: selected, notes: unwindow(t, notes) })}
              onPreview={(m, on) => (on ? noteOn(`roll:${m}`, selected, m, 0.8) : noteOff(`roll:${m}`))} />
          </>)}

          <Perform track={t} color={color} repeat={repeat} bend={bend} onRepeat={setRepeat} onBend={setBend}
            onParam={(i, v) => commit({ t: "param", track: selected, i, v }, { group: `p:${selected}:${i}` })} />

          <PatchEditor track={t} color={color}
            onSound={(s) => commit({ t: "replace", project: { ...project, tracks: project.tracks.map((x, i) => (i === selected ? { ...x, params: loadSound(x.params, s) } : x)) } })}
            onParam={(i, v) => commit({ t: "param", track: selected, i, v }, { group: `p:${selected}:${i}` })}
            onRandom={() => commit({ t: "replace", project: { ...project, tracks: project.tracks.map((x, i) => (i === selected ? { ...x, params: randomPatch(x.kind, x.params) } : x)) } })}
            onReset={() => commit({ t: "replace", project: { ...project, tracks: project.tracks.map((x, i) => (i === selected ? { ...x, params: KIT[i].params.slice() } : x)) } })}
            onAudition={() => audition(selected)} />
        </main>
      </div>

      <Keys base={keyBase(selected, octave)} octave={octave} held={held} midiDevices={midiDevices} color={color}
        onKey={(m, on) => (on ? noteOn(`ui:${m}`, selected, m, 0.8) : noteOff(`ui:${m}`))}
        onOctave={(d) => setOctave((o) => Math.min(Math.max(o + d, -3), 3))} />

      <footer className="status">
        <span className={`dot ${netStatus.state}`} />
        <span>{netStatus.state === "online"
          ? netStatus.peers > 1 ? `Saved · jamming with ${netStatus.peers - 1} other${netStatus.peers > 2 ? "s" : ""}` : roomName() ? "Saved" : "Saved to this machine"
          : netStatus.state === "connecting" ? "Connecting…" : netStatus.state === "full" ? `${netStatus.full === "closed" ? "Closed by its maker" : "No room"}: playing alone, not saving` : "Not saving (no world)"}</span>
        {roomName() && <span className="dim" title="Keep this link: the name is the key to this groove">sesh {roomName()}</span>}
        {floor?.host && <>
          {floor.state !== "closed" && <button className={floor.state === "held" ? "ghost on" : "ghost"} aria-pressed={floor.state === "held"}
            title={floor.state === "held" ? "Let everyone edit and play again" : "Only you edit and play into the room (Esc)"}
            onClick={() => net.current?.floor(floor.state === "held" ? "free" : "held")}>{floor.state === "held" ? "Freezone" : "Hold"}</button>}
          <button className="ghost" title={floor.state === "closed" ? "Let everyone back in" : "End the jam: everyone else is sent away, the groove is kept"}
            onClick={() => net.current?.floor(floor.state === "closed" ? "free" : "closed")}>{floor.state === "closed" ? "Reopen" : "Close out"}</button>
        </>}
        {locked && <span className="warn-text" role="status">The maker holds the floor: you're heard only here</span>}
        <span className="spacer" />
        {bounce.path && <span className="dim">{bounce.path}</span>}
        {bounce.saved && <button className="ghost" onClick={() => reveal(bounce.path!)}>Show</button>}
        {bounce.error && <span className="err">{bounce.error}</span>}
        <button className="ghost" onClick={doBounce} disabled={bounce.busy}>{bounce.busy ? "Bouncing…" : bounceLoops(project) === 1 ? "Bounce the song to WAV" : "Bounce 4 loops to WAV"}</button>
      </footer>

      <Cursors />
      {netStatus.state === "full" && !solo && (
        <FullCard why={netStatus.full ?? "rooms"} room={roomName()} onSolo={() => setSolo(true)}
          onRetry={() => { setSolo(false); setAttempt((a) => a + 1); }} />
      )}
      {!audio && (netStatus.state !== "full" || solo) && (
        <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <div className="gate-card">
            <h2 id="gate-title">Speakers down first</h2>
            <p>FM DAW starts at <strong>−12 dB</strong>, and a limiter keeps every sample under <strong>−1 dBFS</strong> whatever the patch. <kbd>Esc</kbd> stops all sound.</p>
            <button className="play big" onClick={startAudio} autoFocus>Start audio</button>
            {startError && <p className="err">{startError}</p>}
            <p className="dim">Then: <kbd>Space</kbd> plays, letters <kbd>A</kbd>–<kbd>'</kbd> are a keyboard, <kbd>R</kbd> records, <kbd>1</kbd>–<kbd>8</kbd> pick a track.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
