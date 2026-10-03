import { useEffect, useRef, useState } from "react";
import { AudioOut, START_DB, dbToGain, fetchWasm } from "./audio.ts";
import { connect, type Net, type NetStatus } from "./net.ts";
import { QWERTY, startMidi } from "./input.ts";
import { pushTick, useTick } from "./store.ts";
import { TRACK_COLORS } from "./colors.ts";
import { DrumGrid } from "./DrumGrid.tsx";
import { PianoRoll } from "./PianoRoll.tsx";
import { PatchEditor } from "./PatchEditor.tsx";
import { Keys } from "./Keys.tsx";
import { Meter } from "./Meter.tsx";
import { Bench } from "./Bench.tsx";
import { apply, audible, loopBeats, BAR_CHOICES, type Note, type Op, type Project } from "../project.ts";
import { demoProject, KIT, randomPatch } from "../presets.ts";
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
const GROUP_MS = 800;
const COUNT_IN = 4;

/** Everything the worklet needs to mirror a project. */
function loadMsg(p: Project): ToWorklet {
  return {
    t: "load", params: p.tracks.flatMap((t) => t.params), notes: p.tracks.map((t) => t.notes),
    bpm: p.bpm, swing: p.swing, loopBeats: loopBeats(p), audible: audible(p),
  };
}

/** The smallest worklet update for an op that's already been applied. */
function opMsg(op: Op, next: Project): ToWorklet {
  switch (op.t) {
    case "param": return { t: "param", track: op.track, i: op.i, v: next.tracks[op.track].params[op.i] };
    case "notes": return { t: "notes", track: op.track, notes: next.tracks[op.track].notes };
    case "track": return { t: "audible", mask: audible(next) };
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
  const [bounce, setBounce] = useState<{ busy: boolean; path?: string; saved?: boolean; error?: string }>({ busy: false });
  const transportOn = useTick((t) => t.playing || t.countIn > 0);
  const counting = useTick((t) => (t.countIn > 0 ? Math.ceil(t.countIn) : 0));

  const undo = useRef<Project[]>([]);
  const redo = useRef<Project[]>([]);
  const lastGroup = useRef({ key: "", at: 0 });
  const net = useRef<Net | null>(null);
  // the keyboard and MIDI handlers are registered once; they read these
  const live = useRef({ selected, octave, recording, gridIdx, strength, inputQ, transportOn, countIn });
  live.current = { selected, octave, recording, gridIdx, strength, inputQ, transportOn, countIn };

  const send = (m: ToWorklet) => audioRef.current?.send(m);

  function commit(op: Op, opts: { remote?: boolean; group?: string } = {}) {
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
  useEffect(() => {
    const n = connect({
      onSnapshot(p) {
        if (!p) { n.init(proj.current); return; }
        undo.current = []; redo.current = [];
        commit({ t: "replace", project: p }, { remote: true });
      },
      onOp(op) { commit(op, { remote: true }); },
      onStatus: setNetStatus,
    });
    net.current = n;
    return () => n.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- notes in ----
  const liveNotes = useRef(new Map<string, { track: number; midi: number }>());
  function noteOn(key: string, track: number, midi: number, vel: number) {
    if (midi < 0 || midi > 127 || liveNotes.current.has(key)) return;
    liveNotes.current.set(key, { track, midi });
    send({ t: "on", track, midi, vel });
    setHeld((h) => new Set(h).add(midi));
  }
  function noteOff(key: string) {
    const n = liveNotes.current.get(key);
    if (!n) return;
    liveNotes.current.delete(key);
    send({ t: "off", track: n.track, midi: n.midi });
    setHeld((h) => { const s = new Set(h); s.delete(n.midi); return s; });
  }
  function releaseAll() { for (const k of [...liveNotes.current.keys()]) noteOff(k); }
  const keyBase = (track: number, oct: number) => proj.current.tracks[track].root + 12 * oct;

  function audition(track: number) {
    const m = proj.current.tracks[track].root;
    noteOn(`aud:${track}`, track, m, 0.85);
    setTimeout(() => noteOff(`aud:${track}`), 300);
  }

  // ---- transport ----
  function play() { send({ t: "play", countIn: 0 }); }
  function stop() { send({ t: "stop" }); setRecording(false); send({ t: "rec", on: false }); }
  function toggleRecord() {
    const { recording, transportOn, countIn } = live.current;
    if (recording) { setRecording(false); send({ t: "rec", on: false }); return; }
    setRecording(true);
    send({ t: "rec", on: true });
    if (!transportOn) send({ t: "play", countIn: countIn ? COUNT_IN : 0 });
  }
  function panic() { releaseAll(); stop(); send({ t: "panic" }); }

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
      if (e.code === "Escape") { panic(); return; }
      if (!audioRef.current) return;
      if (e.code === "Space") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        if (!e.repeat) (live.current.transportOn ? stop : play)();
        return;
      }
      if (e.repeat) { if (e.code in QWERTY) e.preventDefault(); return; }
      if (e.code === "KeyR") { toggleRecord(); return; }
      if (e.code === "KeyZ") { setOctave((o) => Math.max(o - 1, -3)); return; }
      if (e.code === "KeyX") { setOctave((o) => Math.min(o + 1, 3)); return; }
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit) { setSelected(Number(digit[1]) - 1); return; }
      const semi = QWERTY[e.code];
      if (semi !== undefined) {
        e.preventDefault();
        const { selected, octave } = live.current;
        noteOn(`kb:${e.code}`, selected, keyBase(selected, octave) + semi, e.shiftKey ? 1 : 0.75);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code in QWERTY) noteOff(`kb:${e.code}`); };
    const blur = () => releaseAll();
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
      const pcm = renderProject(e, p, sr, loopSeconds(p, 4), dbToGain(-6));
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
  const color = TRACK_COLORS[selected];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>FM DAW</h1>
          <span className="dim">8 tracks · 4-op FM · Rust or TS</span>
        </div>

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
          <div className="field"><span className="silk">Bars</span>
            <div className="seg">
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
                <kbd>{i + 1}</kbd> {tr.name}<span className="kind">{tr.kind}</span>
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
          ) : t.kind === "drum" ? (
            <DrumGrid tracks={project.tracks} colors={TRACK_COLORS} selected={selected} loopBeats={L}
              onSelect={setSelected} onAudition={audition}
              onNotes={(i, notes) => commit({ t: "notes", track: i, notes })} />
          ) : (
            <PianoRoll key={selected} track={t} color={color} loopBeats={L} grid={Math.min(grid.beats, 0.25)}
              onNotes={(notes: Note[]) => commit({ t: "notes", track: selected, notes })}
              onPreview={(m, on) => (on ? noteOn(`roll:${m}`, selected, m, 0.8) : noteOff(`roll:${m}`))} />
          )}

          <PatchEditor track={t} color={color}
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
          ? netStatus.peers > 1 ? `Saved · jamming with ${netStatus.peers - 1} other${netStatus.peers > 2 ? "s" : ""}` : "Saved to this machine"
          : netStatus.state === "connecting" ? "Connecting…" : "Not saving (no world)"}</span>
        <span className="spacer" />
        {bounce.path && <span className="dim">{bounce.path}</span>}
        {bounce.saved && <button className="ghost" onClick={() => reveal(bounce.path!)}>Show</button>}
        {bounce.error && <span className="err">{bounce.error}</span>}
        <button className="ghost" onClick={doBounce} disabled={bounce.busy}>{bounce.busy ? "Bouncing…" : "Bounce 4 loops to WAV"}</button>
      </footer>

      {!audio && (
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
