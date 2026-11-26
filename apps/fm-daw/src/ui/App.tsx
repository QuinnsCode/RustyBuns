import { useEffect, useMemo, useRef, useState } from "react";
import { AudioOut, START_DB, dbToGain, fetchWasm } from "./audio.ts";
import { connect, roomName, shareBounce, type Net, type NetStatus } from "./net.ts";
import { Cursors, dropAllCursors, dropCursor, moveCursor } from "./Cursors.tsx";
import { FullCard } from "./Full.tsx";
import { ChatDock, useChat } from "./Chat.tsx";
import { LockButton } from "./Lock.tsx";
import { People } from "./People.tsx";
import { opNeeds, type Can, type GrantServer } from "../grants.ts";
import { mayHere } from "../guest-list.ts";
import type { GuestList } from "@rustybuns/util/guests";
import { WindBack, type Rewound } from "./WindBack.tsx";
import type { Rung } from "../rewind.ts";
import { QWERTY, startMidi } from "./input.ts";
import { startMidiOut, type MidiOut } from "./midi-out.ts";
import { onCc } from "./learn.ts";
import { PluginPump, bounceInserts, bouncePlugins, effectChoices, pluginChoices, usePlugins, type PluginShown } from "./plugins.ts";

/** A plugin track this page's own plugin is playing (started, not failed). */
const playing = (s: PluginShown | undefined) => !!s && !s.starting && s.error === null;
import { InsertPanel, PluginPanel, TrackSound } from "./PluginPanel.tsx";
import { AddMenu, MidiLand } from "./AddMenu.tsx";
import { useImports } from "./import.ts";
import { withValue, type TrackPlugin } from "../plugin-track.ts";
import { pageRack, type PageAudio } from "./wam.ts";
import { loadMine, loadSoloTakes, saveMine, saveSoloTakes } from "./mine.ts";
import { lastTick, pushEqPlayed, pushTick, useTick } from "./store.ts";
import { TRACK_COLORS } from "./colors.ts";
import { DrumGrid } from "./DrumGrid.tsx";
import { PianoRoll } from "./PianoRoll.tsx";
import { PatchEditor } from "./PatchEditor.tsx";
import { Keys } from "./Keys.tsx";
import { Meter } from "./Meter.tsx";
import { Bench } from "./Bench.tsx";
import { Shape } from "./Shape.tsx";
import { AmpPanel } from "./AmpPanel.tsx";
import { DeskPanel } from "./DeskPanel.tsx";
import { seshDesk, seshShape, shapeName, shapeOps, type ShapeAt } from "../mixer.ts";
import { Perform, STUTTERS } from "./Perform.tsx";
import { loadSound } from "../sounds.ts";
import { TAKE_RATE, TakeShelf, clipsOf, encodeTake, newTakeId, toChunks } from "../take.ts";
import { ClipLane } from "./ClipLane.tsx";
import { apply, audible, voiceless, roomGain, lettingGo, loopBeats, punchLane, Take, BAR_CHOICES, BEATS_PER_BAR, type Live, type Note, type Op, type Project, type TrackDoc } from "../project.ts";
import { demoProject, KIT, randomPatch } from "../presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "../drums.ts";
import { SONGS, fromAddress } from "../songs.ts";
import { GRIDS, quantize, quantizeNote } from "../quantize.ts";
import { clampView, fit, gridFor, snapView, windowNotes, zoomAbout, type View } from "./view.ts";
import { Timeline, type ViewChange } from "./Timeline.tsx";
import { TsEngine, type FmEngine } from "../engine/engine.ts";
import { WasmEngine, instantiateFm } from "../engine/wasm.ts";
import { renderProject, loopSeconds, bounceFrames, type BounceInserts } from "../engine/offline.ts";
import { encodeWav } from "../engine/wav.ts";
import { saveBounce, reveal } from "../actions/files.ts";
import type { FromWorklet, ToWorklet } from "../engine/messages.ts";
import { MASTER, type RecordedMove } from "../engine/sequencer.ts";
import { flatEq, type EqDoc } from "../engine/eq.ts";
import { DeskFeed, loadMsg, type HeardPlayer } from "./load.ts";
import { applyStudio, emptyStudio, type Patch } from "../studio.ts";
import { auxGear, boardIn } from "../room/room.ts";
import { LANE_BEND, LANE_STUTTER, P } from "../engine/params.ts";
import { Band } from "../studio/band.ts";
import { FarSound, PluginOut } from "../studio/plugin-line.ts";
import { webOpus, type MakeEncoder } from "../studio/opus.ts";
import { DESK_MS, LISTENS, type Listen } from "../clock.ts";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./app.css";
import COPY from "../../content/first-screen.json";

const UNDO_LIMIT = 100;
/** A song (past 32 bars) bounces once; a loop four times. */
const bounceLoops = (p: Project) => (p.bars > 32 ? 1 : 4);

const GROUP_MS = 800;
const COUNT_IN = 4;

/** The smallest worklet update for an op that's already been applied. */
function opMsg(op: Op, next: Project): ToWorklet {
  switch (op.t) {
    case "param": return { t: "param", track: op.track, i: op.i, v: next.tracks[op.track].params[op.i] };
    case "notes": return { t: "notes", track: op.track, notes: next.tracks[op.track].notes };
    case "auto": return { t: "auto", track: op.track, lanes: next.tracks[op.track].auto ?? [] };
    case "track": return { t: "audible", mask: audible(next) };
    // the take's sound itself goes by syncTakes once it's here
    case "take": case "clips": return { t: "audible", mask: audible(next) };
    case "eq": if (op.track !== undefined) return { t: "trackEq", track: op.track, bands: next.tracks[op.track].eq ?? flatEq() };
    // falls through: the master
    case "eqAuto": return { t: "eq", bands: next.eq, lanes: next.eqAuto ?? [] };
    case "eqPhase": return { t: "eqPhase", linear: !!next.eqLinear };
    case "amp": return { t: "amp", track: op.track, amp: next.tracks[op.track].amp ?? null };
    case "plugin": return { t: "plugin", track: op.track, on: !!next.tracks[op.track].plugin };
    // the worklet hears of an effect once it runs (src/ui/plugins.ts): the track stays dry until then
    case "insert": return { t: "audible", mask: audible(next) };
    case "voiceless": return { t: "voiceless", mask: voiceless(next) };
    case "global":
      if (op.bpm === undefined && op.swing === undefined && op.bars === undefined) {
        if (op.space !== undefined && op.squash === undefined) return { t: "space", amount: next.space };
        if (op.squash !== undefined && op.space === undefined) return { t: "squash", amount: next.squash };
        // the room's level alone: the master effect in App sends it, beside your own
        if (op.space === undefined && op.squash === undefined) return { t: "audible", mask: audible(next) };
      }
      return loadMsg(next);
    default: return loadMsg(next);
  }
}

/** The Shape tab's pick (`master`, a channel's id, `aux-<n>`) as the desk names it. */
const shapeAtKey = (key: string): ShapeAt => (key === "master" ? { master: true } : key.startsWith("aux-") ? { aux: Number(key.slice(4)) } : { channel: key });
/** What the page's web plugins play into, once the audio is on. */
const pageAudio = (a: AudioOut | null): PageAudio | null => a && { ctx: a.ctx, taps: a.webTaps, fxIn: a.fxIn, webIn: a.webIn, fxOut: a.fxOut, web: (t, g) => a.web(t, g), route: (t, on) => a.routeWeb(t, on) };

export function App() {
  // `?song=wobble-lab` opens that song solo, so a jump link never overwrites the sesh's groove
  const [asked] = useState(() => fromAddress(location.search));
  const [project, setProject] = useState<Project>(() => asked?.project ?? demoProject());
  const proj = useRef(project);
  const [selected, setSelected] = useState(asked?.track ?? 0);
  const [audio, setAudio] = useState<AudioOut | null>(null);
  const audioRef = useRef<AudioOut | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Someone new, once sound is on: one thing to try first, until they have played the groove once in this browser.
  const [tried, setTried] = useState(() => { try { return localStorage.getItem("fm-daw.tried") === "1"; } catch { return false; } });
  const markTried = () => { setTried(true); try { localStorage.setItem("fm-daw.tried", "1"); } catch {} };
  const [masterDb, setMasterDb] = useState(START_DB);
  const [engine, setEngine] = useState<"ts" | "rust">("ts");
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [metro, setMetro] = useState(false);
  const [gridIdx, setGridIdx] = useState(2);
  const [strength, setStrength] = useState(1);
  // off: what you play lands where you played it (the roll takes free notes); the magnet by Record MIDI snaps it to the Grid
  const [inputQ, setInputQ] = useState(false);
  const [octave, setOctave] = useState(0);
  const [held, setHeld] = useState<Set<number>>(() => new Set());
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  /** MIDI out to the plugins in your own DAW: the port list and the pick, redrawn when either changes. */
  const midiOut = useRef<MidiOut | null>(null);
  const [outPorts, setOutPorts] = useState<{ ports: string[]; picked: string | null }>({ ports: [], picked: null });
  const [netStatus, setNetStatus] = useState<NetStatus>({ state: "connecting", peers: 0 });
  const [view, setView] = useState<"pattern" | "shape" | "amp" | "desk" | "engines">("pattern");
  /** Which Shape the tab shows: "master", or a channel on the desk by id (`track-1`, `player-<who>`, `aux-1`). */
  const [shapeOn, setShapeOn] = useState("master");
  /** What the drum grid and the roll show (view.ts): any stretch of the loop, as the user zoomed and scrolled it. */
  const [timeView, setTimeView] = useState<View>({ from: 0, span: 8 * BEATS_PER_BAR });
  const [editorPx, setEditorPx] = useState(800);
  const [follow, setFollow] = useState(false);
  /** The window the editors showed last render, for the probe handle. */
  const viewRef = useRef<View>({ from: 0, span: 0 });
  /** Every view change goes through here, so the view stays inside the loop. */
  const changeView = (change: ViewChange) => setTimeView((prev) => {
    const L = loopBeats(proj.current);
    return clampView(change(clampView(prev, L), L), L);
  });
  const [repeat, setRepeatState] = useState(0);
  const [bend, setBendState] = useState(0);
  const [bounce, setBounce] = useState<{ busy: boolean; path?: string; saved?: boolean; error?: string; decks?: boolean; missed?: string[] }>({ busy: false });
  /** The track the input records onto while recording, or null with the input off. */
  const [armed, setArmed] = useState<number | null>(null);
  const armedRef = useRef<number | null>(null);
  armedRef.current = armed;
  const [inputNote, setInputNote] = useState<string | null>(null);
  /** The input heard through the armed track's amp; off whenever the input comes on. */
  const [monitor, setMonitor] = useState(false);
  const ampMisses = useTick((t) => t.ampMisses);
  /** Plugin tracks: their plugins on the desktop host, their sound into the worklet (src/ui/plugins.ts). */
  const pump = useRef<PluginPump | null>(null);
  /** The page's own plugins (src/ui/wam.ts): played on the audio once it's on, and bounced with or without it. */
  const [webRack] = useState(() => pageRack(() => pageAudio(audioRef.current)));
  /** Each FM track's Insert (#5359): a web effect on its sound, its own rack and pump beside the instruments'. */
  const [fxRack] = useState(() => pageRack(() => pageAudio(audioRef.current), "effect"));
  const fxPump = useRef<PluginPump | null>(null);
  /** The loudest of the last slice each plugin track sent the sesh (the probe's `line`). */
  const linePeaks = useRef(new Map<number, number>());
  const plugins = usePlugins(audio ? pump.current : null);
  const effects = usePlugins(audio ? fxPump.current : null);
  const transportOn = useTick((t) => t.playing || t.countIn > 0);
  const counting = useTick((t) => (t.countIn > 0 ? Math.ceil(t.countIn) : 0));

  const undo = useRef<Project[]>([]);
  const redo = useRef<Project[]>([]);
  const lastGroup = useRef({ key: "", at: 0 });
  const net = useRef<Net | null>(null);
  // wind back: while a past groove plays here, the sesh's own groove waits aside, kept in step with everyone's edits
  const aside = useRef<Project | null>(null);
  const [rewound, setRewound] = useState<Rewound | null>(null);
  // the keyboard and MIDI handlers are registered once; they read these
  // the sesh's floor and the leader's grants (src/grants.ts): what this page may send; the rest stays in it
  const chat = useChat();
  const floor = netStatus.state === "online" ? netStatus.floor : undefined;
  const [grants, setGrants] = useState<GrantServer | null>(null);
  // the guest list (src/guest-list.ts): someone on it gets their role's grants
  const [guests, setGuests] = useState<GuestList | null>(null);
  // ---- the desk beyond the tracks (src/mixer.ts): a channel for each player the live line plays sound for, and the
  // aux 2 return over what the sesh's gear room has cabled into it ----
  const [heard, setHeard] = useState<number[]>([]);
  const studio = useRef(emptyStudio());
  const [patch, setPatch] = useState<Patch | null>(null);
  const aux2 = useMemo(() => (patch ? auxGear(patch) : { settings: null, label: "" }), [patch]);
  const heardPlayers = useMemo(() => heard.flatMap((peer): HeardPlayer[] => { const who = grants?.peers[peer]; return who ? [{ peer, who, name: chat.view.names[who] || "Player" }] : []; }), [heard, grants, chat.view.names]);
  const deskPlayers = useMemo(() => [...new Map(heardPlayers.map((h) => [h.who, { who: h.who, name: h.name }])).values()], [heardPlayers]);
  const [deskFeed] = useState(() => new DeskFeed((m) => audioRef.current?.send(m)));
  const may1 = (c: Can, track?: number) => !floor || (grants ? mayHere(guests, grants.grants, floor.state, chat.view.you ?? undefined, floor.host, c, track) : floor.state === "free" || floor.host);
  const allowed = { play: may1("play"), edit: may1("edit"), mix: may1("mix"), lead: may1("lead") };
  // a grant of some tracks plays the selected track when it is one of them
  const locked = !may1("play", selected);
  const live = useRef({ selected, octave, recording, gridIdx, strength, inputQ, transportOn, countIn, repeat, bend, locked, floor, allowed });
  live.current = { selected, octave, recording, gridIdx, strength, inputQ, transportOn, countIn, repeat, bend, locked, floor, allowed };

  const send = (m: ToWorklet, transfer?: Transferable[]) => audioRef.current?.send(m, transfer);

  // ---- the sesh's shared clock (src/clock.ts), as the jam room keeps it: the leader's beat, and how you hear the others ----
  const [band] = useState(() => new Band(() => ({ bpm: proj.current.bpm, loopBeats: loopBeats(proj.current) }), () => performance.timeOrigin + performance.now()));
  const [listen, setListenState] = useState<Listen>(band.listen);
  /** Everyone else's guitars and plugin tracks, coming in as slices (src/studio/plugin-line.ts). */
  const [far] = useState(() => new FarSound(band, (m) => send(m, m.t === "sound" ? [m.pcm.buffer] : []), (t) => playing(pump.current?.state.get(t))));
  /** Your plugin tracks going to the sesh, by track, and the Opus encoder they use (null: none in this browser, PCM). */
  const pluginOuts = useRef(new Map<number, PluginOut>());
  const opusEncoder = useRef<MakeEncoder | null>(null);
  function chooseListen(l: Listen) { band.listen = l; setListenState(l); }

  function commit(op: Op, opts: { remote?: boolean; group?: string } = {}) {
    if (aside.current) {
      // a look back is for listening: your edits wait until you're back, the others' land on the groove aside
      if (opts.remote) aside.current = apply(aside.current, op);
      return;
    }
    if (!opts.remote && !live.current.allowed[opNeeds(op)]) return;
    const prev = proj.current;
    const next = apply(prev, op);
    if (next === prev) return;
    if (!opts.remote) {
      const now = performance.now();
      // a "drag:" group is one pointer's drag (ClipLane): one undo step however long it pauses
      const grouped = opts.group && lastGroup.current.key === opts.group && (now - lastGroup.current.at < GROUP_MS || opts.group.startsWith("drag:"));
      if (!grouped) { undo.current.push(prev); if (undo.current.length > UNDO_LIMIT) undo.current.shift(); }
      lastGroup.current = { key: opts.group ?? "", at: now };
      redo.current = [];
      net.current?.send(op);
    }
    proj.current = next;
    setProject(next);
    send(opMsg(op, next));
    syncTakes(next);
  }

  function history(dir: "undo" | "redo") {
    const from = dir === "undo" ? undo.current : redo.current;
    const to = dir === "undo" ? redo.current : undo.current;
    if (!live.current.allowed.edit || aside.current) return;
    const p = from.pop();
    if (!p) return;
    to.push(proj.current);
    const op: Op = { t: "replace", project: p };
    proj.current = p;
    setProject(p);
    send(loadMsg(p));
    syncTakes(p);
    net.current?.send(op);
    lastGroup.current = { key: "", at: 0 };
  }

  /** Play this groove in place of the one on screen, without sending it. */
  function show(p: Project) {
    proj.current = p;
    setProject(p);
    send(loadMsg(p));
    syncTakes(p);
  }
  function onRewound(ago: Rung, at: number, p: Project | null) {
    if (!p) { endLook(); setRewound({ ago, at, project: null }); return; }
    if (!aside.current) aside.current = proj.current;
    show(p);
    setRewound({ ago, at, project: p });
  }
  /** Back to the sesh's groove as it is now; hands back the one that was playing here. */
  function endLook(): Project | null {
    const now = aside.current;
    aside.current = null;
    setRewound(null);
    if (!now) return null;
    const was = proj.current;
    show(now);
    return was;
  }
  /** The leader's call: the groove they're hearing goes to everyone, as one edit (so undo takes it back). */
  function bringBack() {
    const p = endLook();
    if (p) commit({ t: "replace", project: p });
  }

  // ---- audio ----
  function onWorklet(m: FromWorklet) {
    if (m.t === "tick") {
      // the loop came round: what was played on the last pass goes in, so it plays on this one
      if (m.pos < lastPos.current) flushTake();
      lastPos.current = m.pos;
      pushTick(m);
    }
    else if (m.t === "move") takeMove(m);
    else if (m.t === "eqPlayed") pushEqPlayed(m.doc);
    else if (m.t === "engine") { setEngine(m.kind); setEngineNote(m.error ?? null); }
    else if (m.t === "pluginAsk") pump.current?.ask(m);
    else if (m.t === "sound" && m.track !== undefined) {
      linePeaks.current.set(m.track, m.pcm.reduce((x, v) => Math.max(x, Math.abs(v)), 0));
      pluginOuts.current.get(m.track)?.slice(m.beat, m.pcm, m.rate);
    }
    else if (m.t === "taken") {
      landTake(m.track, m.beat, m.pcm, m.rate);
      // Record audio takes one pass: the transport plays on, the recording stops
      if (live.current.recording) { stopRec(); imports.say(`Recorded a pass of audio onto ${proj.current.tracks[m.track]?.name ?? "the track"}.`); }
    }
    else if (m.t === "rec") {
      const { gridIdx, strength, inputQ } = live.current;
      const L = loopBeats(proj.current);
      const note = inputQ ? quantizeNote(m.note, GRIDS[gridIdx].beats, strength, L) : m.note;
      const t = proj.current.tracks[m.track];
      commit({ t: "notes", track: m.track, notes: [...t.notes, note] }, { group: "rec" });
    }
  }

  // ---- performance recorded as automation: a take per lane, punched in when the loop comes round or recording stops ----
  const take = useRef(new Take());
  const lastPos = useRef(0);
  function takeMove(m: RecordedMove) { if (!take.current.add(m)) { flushTake(); take.current.add(m); } }
  function flushTake() {
    for (const s of take.current.flush())
      if (s.track === MASTER) commit({ t: "eqAuto", lanes: punchLane(proj.current.eqAuto ?? [], s.i, s.pts) }, { group: "rec" });
      else commit({ t: "auto", track: s.track, lanes: punchLane(proj.current.tracks[s.track].auto ?? [], s.i, s.pts) }, { group: "rec" });
  }
  // ---- takes: the input recorded onto a track. Its sound goes to the sesh in chunks, then the edit that places it ----
  const takes = useRef(new TakeShelf());
  const input = useRef<{ stream: MediaStream; node: MediaStreamAudioSourceNode } | null>(null);
  const syncTakes = (p: Project) => takes.current.sync(p, send);
  function landTake(track: number, beat: number, pcm: Float32Array, rate: number) {
    if (!live.current.allowed.edit) return;
    const s16 = encodeTake(pcm, rate);
    if (!s16.length) return;
    const id = newTakeId();
    // everyone, this page included, hears the 16-bit copy the sesh keeps
    takes.current.keep(id, Float32Array.from(s16, (v) => v / 32767));
    for (const c of toChunks(id, s16)) net.current?.take(c);
    commit({ t: "take", track, take: { id, beat, frames: s16.length } }, { group: "rec" });
  }
  const inLatency = (a: AudioOut) => {
    const got: MediaTrackSettings & { latency?: number } = input.current?.stream.getAudioTracks()[0]?.getSettings() ?? {};
    return (got.latency ?? 0) + a.ctx.baseLatency;
  };
  /** The input closed: nothing records audio onto a track or is heard through its amp. */
  function closeInput() {
    if (input.current) {
      input.current.node.disconnect();
      for (const tr of input.current.stream.getTracks()) tr.stop();
      input.current = null;
    }
    setArmed(null);
    setMonitor(false);
    audioRef.current?.send({ t: "arm", track: -1, inLatency: 0 });
  }
  /** The input open and armed on `track`; the mic is asked for once and kept open. False, and said why, when it can't be. */
  async function openInput(track: number): Promise<boolean> {
    const a = audioRef.current;
    if (!a) return false;
    setInputNote(null);
    if (!input.current) {
      try {
        // a guitar or the desk's out, as it is: no echo cancelling, gating or levelling
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const node = a.ctx.createMediaStreamSource(stream);
        node.connect(a.node);
        input.current = { stream, node };
      } catch (e) {
        const why = e instanceof DOMException ? e.name : "";
        setInputNote(why === "NotAllowedError" || why === "SecurityError"
          ? "The microphone was refused, so there is nothing to record. Allow it for this page (the icon by the address), then press Record audio again."
          : why === "NotFoundError" ? "No microphone or input was found. Plug one in, then press Record audio again."
          : `No input: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    }
    a.send({ t: "arm", track, inLatency: inLatency(a) });
    setMonitor(false);
    setArmed(track);
    return true;
  }
  // the armed track follows the one you pick
  useEffect(() => {
    const a = audioRef.current;
    if (armed === null || armed === selected || !a) return;
    setArmed(selected);
    setMonitor(false);
    a.send({ t: "arm", track: selected, inLatency: inLatency(a) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /** One of your Perform moves: heard now, and kept as automation if you're recording. */
  const move = (track: number, i: number, v: number, was: number) => send({ t: "move", track, i, v, was });

  async function startAudio() {
    setStartError(null);
    try {
      const a = await AudioOut.start(onWorklet);
      audioRef.current = a;
      a.send(loadMsg(proj.current));
      deskFeed.reset();
      a.send({ t: "metro", on: metro });
      pump.current = new PluginPump((m, tr) => a.send(m, tr), a.ctx.sampleRate, undefined, (track, changes) => {
        let plug = proj.current.tracks[track]?.plugin;
        if (!plug) return;
        for (const c of changes) plug = withValue(plug, c.id, c.value);
        commit({ t: "plugin", track, plugin: plug }, { group: `plugEd:${track}` });
      }, webRack);
      fxPump.current = new PluginPump((m, tr) => a.send(m, tr), a.ctx.sampleRate, undefined, (track, changes) => {
        let fx = proj.current.tracks[track]?.insert;
        if (!fx) return;
        for (const c of changes) fx = withValue(fx, c.id, c.value);
        commit({ t: "insert", track, insert: fx }, { group: `fxEd:${track}` });
      }, fxRack, "insert");
      // others' guitars and plugin tracks come as Opus where this browser has WebCodecs, and yours go out that way
      const opus = await webOpus();
      if (opus) { far.decodeWith(opus.decoder); opusEncoder.current = opus.encoder; }
      takes.current.forget();
      syncTakes(proj.current);
      setAudio(a);
    } catch (e) { setStartError((e as Error).message); }
  }

  useEffect(() => () => { void audioRef.current?.ctx.close(); }, []);
  // the open Shape's channel copied out of the mix for its spectrum (the master's is the mix itself)
  const [deskShape, setDeskShape] = useState<ShapeAt | null>(null);
  const listenAt: ShapeAt | null = view === "shape" ? shapeAtKey(shapeOn) : view === "desk" ? deskShape : null;
  const listenKey = JSON.stringify(listenAt);
  useEffect(() => {
    if (!audio) return;
    audio.listen(listenAt);
    return () => { audio.listen(null); };
  }, [audio, listenKey]);
  const sideMeters = useRef<{ a: AudioOut; l: AnalyserNode; r: AnalyserNode } | null>(null);
  // played some other way (Space, the transport's Play, the room): the first-try card has done its job
  useEffect(() => { if (transportOn && audio && !tried) markTried(); }, [transportOn]);
  // each plugin track's plugin, started, stopped and its sliders sent on as the groove changes
  useEffect(() => { pump.current?.sync(project); fxPump.current?.sync(project); }, [audio, project]);
  // what you hear: your own master, under the room's (the remote's master fader, src/remote/)
  useEffect(() => { audio?.send({ t: "master", gain: dbToGain(masterDb) * roomGain(project) }); }, [audio, masterDb, project.master]);

  // Ask the desk instead of screenshotting it (scripts/probe.ts): what plays each track, and how loud it is. `peak` is
  // the engine's own meter (FM voices); `out` is what leaves for the speakers, plugins and amps too, over the last 170 ms;
  // `sides`, the same of each side (made on the first ask).
  useEffect(() => {
    const loudest = (an: AnalyserNode) => {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      return buf.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    };
    const out = () => { const an = audioRef.current?.analyser; return an ? loudest(an) : 0; };
    const sides = () => {
      const a = audioRef.current;
      if (!a) return { l: 0, r: 0 };
      if (sideMeters.current?.a !== a) {
        const split = new ChannelSplitterNode(a.ctx, { numberOfOutputs: 2 }), mk = () => new AnalyserNode(a.ctx, { fftSize: 8192 });
        const l = mk(), r = mk();
        a.node.connect(split);
        split.connect(l, 0);
        split.connect(r, 1);
        sideMeters.current = { a, l, r };
      }
      return { l: loudest(sideMeters.current.l), r: loudest(sideMeters.current.r) };
    };
    Object.assign(window, { fmdaw: {
      state: () => ({
        view: viewRef.current,
        audio: audioRef.current?.ctx.state ?? null, playing: live.current.transportOn, selected: live.current.selected, peak: Math.max(lastTick().peakL, lastTick().peakR), out: out(), sides: sides(),
        line: Object.fromEntries(linePeaks.current),
        bars: proj.current.bars, bpm: proj.current.bpm, recording: live.current.recording, armed: armedRef.current,
        tracks: proj.current.tracks.map((tr, i) => {
          const shown = (p: TrackPlugin, s: PluginShown | undefined) => ({ name: p.name, path: p.path, web: !!p.web, starting: s?.starting ?? true, error: s?.error ?? null, site: s?.site ?? null, sliders: (s?.params ?? []).map((q) => ({ name: q.name, value: q.value })) });
          return { name: tr.name, mute: tr.mute, level: tr.params[P.GAIN], notes: tr.notes.length, take: clipsOf(tr)[0] ? { beat: clipsOf(tr)[0].beat, seconds: clipsOf(tr)[0].frames / TAKE_RATE } : null, clips: clipsOf(tr), plays: tr.voiceless ? "none" : tr.plugin ? shown(tr.plugin, pump.current?.state.get(i)) : "fm", insert: tr.insert ? shown(tr.insert, fxPump.current?.state.get(i)) : null };
        }),
      }),
      start: startAudio,
      // the editors' view window, as the zoom and scroll set it (clamped to the loop)
      view: (from: number, span: number) => changeView(() => ({ from, span })),
      plays: (track: number, plugin: TrackPlugin | null) => commit({ t: "plugin", track, plugin }),
      insert: (track: number, insert: TrackPlugin | null) => commit({ t: "insert", track, insert }),
      mute: (track: number, mute: boolean) => commit({ t: "track", track, mute }),
      pan: (track: number, v: number) => commit({ t: "param", track, i: P.PAN, v }),
      // a track's Shape (its EQ bands), as the desk's Shape panel sets it
      shape: (track: number, bands: EqDoc) => commit({ t: "eq", track, bands }),
      // audio onto a track at a beat, as a recording lands (the clip lane then shows it)
      land: (track: number, beat: number, pcm: Float32Array, rate: number) => landTake(track, beat, pcm, rate),
      trust: (track: number) => { pump.current?.trust(track, proj.current); fxPump.current?.trust(track, proj.current); },
      // the sesh's live line for one plugin track, as going online turns it on; `state().line` is what it last sent
      line: (track: number, on: boolean) => { linePeaks.current.delete(track); send({ t: "pluginSend", track, on, web: !!proj.current.tracks[track]?.plugin?.web }); },
      // a bounce of one web plugin track holding a key for half of `seconds`: the loudest it got, or why it couldn't
      bounce: async (track: number, seconds: number) => {
        const plug = proj.current.tracks[track]?.plugin, frames = Math.round(seconds * 48000);
        if (!plug?.web) return { error: "not a web plugin track" };
        try {
          const pcm = await webRack.bounce(plug, [{ t: "on", key: 69, vel: 1, at: 0 }, { t: "off", key: 69, at: frames >> 1 }], 48000, frames);
          const peak = (from: number, to: number) => pcm.subarray(from * 2, to * 2).reduce((x, v) => Math.max(x, Math.abs(v)), 0);
          return { held: peak(0, frames >> 1), after: peak(frames - 4800, frames) };
        } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      },
      // the whole bounce of one track alone holding a note for `seconds` (no Space, no Squash): each side's level
      // over the note, and what it left out (#5551: the Insert's effect is in it)
      mix: async (track: number, seconds: number) => {
        const p0 = proj.current, beats = (seconds * p0.bpm) / 60;
        const p: Project = { ...p0, space: 0, squash: 0, eqLinear: false, tracks: p0.tracks.map((tr, i) => ({ ...tr, solo: i === track, mute: false, auto: [], ...(i === track ? { notes: [{ s: 0, l: beats, m: 60, v: 1 }] } : {}) })) };
        const sr = 48000, { pcm, missed } = await mixdown(p, sr, seconds), from = Math.round(sr * seconds * 0.25), to = Math.round(sr * seconds * 0.75);
        const rms = (side: number) => { let e = 0; for (let f = from; f < to; f++) e += pcm[2 * f + side] ** 2; return Math.sqrt(e / Math.max(1, to - from)); };
        return { l: rms(0), r: rms(1), missed };
      },
    } });
  });

  // ---- world ----
  const [attempt, setAttempt] = useState(0);
  // solo: off the sesh, playing your own project; it's saved in this browser and never sent
  const [solo, setSolo] = useState(asked !== null);
  // a plugin track playing here goes to the sesh too, as sound: nobody else has the plugin (src/studio/plugin-line.ts)
  const online = !solo && netStatus.state === "online";
  useEffect(() => {
    const outs = pluginOuts.current, want = new Map<number, string>();
    if (online && audio) for (const [t, s] of plugins) if (playing(s)) want.set(t, s.name);
    for (const [t, o] of outs) if (want.get(t) !== o.name) { o.stop(); outs.delete(t); send({ t: "pluginSend", track: t, on: false }); }
    for (const [t, name] of want) {
      if (outs.has(t)) continue;
      outs.set(t, new PluginOut(t, name, live1, () => proj.current.bpm, opusEncoder.current));
      send({ t: "pluginSend", track: t, on: true, web: !!proj.current.tracks[t]?.plugin?.web });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins, online, audio]);
  useEffect(() => { deskFeed.sync(project, heardPlayers, aux2.settings); }, [deskFeed, project, heardPlayers, aux2, audio]);
  // someone came in: they hear which tracks your plugins voice
  useEffect(() => { for (const o of pluginOuts.current.values()) o.hello(); }, [netStatus.peers]);
  useEffect(() => {
    if (solo) return;
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
      onChat: chat.onChat,
      onGrants: setGrants,
      onGuests: setGuests,
      onStudio(m) {
        // a bench pedal's board: read here, so the aux 2 return plays its circuit (a new patch object: aux 2 is worked out again)
        if (m.t === "studio-board") { if (boardIn(m.board)) setPatch({ ...studio.current.patch }); return; }
        studio.current = m.t === "studio-all" ? m.studio : applyStudio(studio.current, m.from, m.op);
        setPatch(studio.current.patch);
      },
      onTakeBytes(m) {
        if (takes.current.add(m)) syncTakes(proj.current);
      },
      onRewound,
      onClock(m) { const r = band.onClock(m); if (r) n.clock(r); },
      hello: chat.hello,
    });
    net.current = n;
    return () => { n.close(); net.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, solo]);

  // the clock: ping the leader (or, leading, answer), and tell the audio thread which beat its speakers play now
  useEffect(() => {
    // solo, there's no sesh to keep time with: what comes in (nothing) and what goes out (nothing) aren't stamped
    if (solo) { band.clock.source = null; return; }
    let ping: ReturnType<typeof setTimeout>;
    const pingLeader = () => {
      const floor = live.current.floor;
      band.leading(!!floor?.host);
      if (!band.leads && band.listen === "desk") chooseListen("loop");
      const m = floor ? band.ping() : null;
      if (m) net.current?.clock(m);
      ping = setTimeout(pingLeader, band.clock.every);
    };
    ping = setTimeout(pingLeader, 200);
    const grid = setInterval(() => {
      band.step(live.current.transportOn);
      const a = audioRef.current;
      if (!a) return;
      const ts = a.ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined) a.send(band.grid(ts.contextTime, performance.timeOrigin + ts.performanceTime));
      for (const m of band.due()) a.send(m, m.t === "sound" ? [m.pcm.buffer] : []);
    }, 50);
    return () => { clearTimeout(ping); clearInterval(grid); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo]);

  // ---- yours alone: my setup, and the solo project ----
  const [mySetup, setMySetup] = useState(() => loadMine("setup") !== null);
  function goSolo() {
    endLook();
    for (const from of [...peerState.current.keys()]) onGone(from);
    dropAllCursors();
    setSolo(true);
    undo.current = []; redo.current = [];
    const p = loadMine("solo");
    if (!p) return;
    commit({ t: "replace", project: p }, { remote: true });
    void loadSoloTakes(p).then((got) => {
      for (const [id, pcm] of got) takes.current.keep(id, pcm);
      syncTakes(proj.current);
    });
  }
  // back in, the sesh's groove comes with the snapshot
  function backToSesh() { undo.current = []; redo.current = []; setSolo(false); }
  useEffect(() => {
    if (!solo) return;
    const timer = setTimeout(() => { saveMine("solo", project); void saveSoloTakes(project, (id) => takes.current.get(id)); }, 400);
    return () => clearTimeout(timer);
  }, [solo, project]);

  // ---- the live line: other players' hands, heard here, recorded only into their own take ----
  /** What each player has going here: bends, a stutter, and the notes held on the shared beat ("track:midi"). */
  const peerState = useRef(new Map<number, { bends: Set<number>; repeat: boolean; held: Set<string> }>());
  const peer = (from: number) => {
    let s = peerState.current.get(from);
    if (!s) peerState.current.set(from, (s = { bends: new Set(), repeat: false, held: new Set() }));
    return s;
  };
  /** Who the live line plays sound for changed, maybe: each has a channel on the desk. */
  const heardNow = () => { const now = far.players(); setHeard((was) => (was.join() === now.join() ? was : now)); };
  function onLive(from: number, e: Live) {
    const key = (track: number, midi: number) => `net:${from}:${track}:${midi}`;
    if (far.heard(from, e)) { heardNow(); return; }
    if (band.onBeat(e) !== null) {
      // stamped: the audio thread plays it on the beat this listener hears it on, a loop late or at the desk
      // (MIDI out and the keyboard's lit keys follow only what comes as it comes)
      const s = peer(from);
      if (e.t === "on") s.held.add(`${e.track}:${e.midi}`);
      else if (e.t === "off") s.held.delete(`${e.track}:${e.midi}`);
      else if (e.t === "bend") s.bends.add(e.track);
      else if (e.t === "repeat") s.repeat = e.beats > 0;
      for (const m of band.heard(from, e)) send(m, m.t === "sound" ? [m.pcm.buffer] : []);
      return;
    }
    if (e.t === "on") noteOn(key(e.track, e.midi), e.track, e.midi, e.vel, false);
    else if (e.t === "off") noteOff(key(e.track, e.midi));
    else if (e.t === "bend") { peer(from).bends.add(e.track); send({ t: "bend", track: e.track, semis: e.semis }); }
    else if (e.t === "repeat") { peer(from).repeat = e.beats > 0; setRepeatState(e.beats); send({ t: "repeat", beats: e.beats }); }
    else if (e.t === "play") send({ t: "play", countIn: 0 });
    else if (e.t === "stop") stopHere();
    else if (e.t === "cursor") moveCursor(from, e.x, e.y);
  }
  function onGone(from: number) {
    for (const k of [...liveNotes.current.keys()]) if (k.startsWith(`net:${from}:`)) noteOff(k);
    const s = peerState.current.get(from);
    peerState.current.delete(from);
    far.gone(from);
    heardNow();
    // what they held, bent or stuttered lets go now, and again on the beat it would have, for a listener behind
    const b = band.beat(), letGo = (e: Live) => { for (const m of band.heard(from, e)) send(m); };
    for (const k of s?.held ?? []) { const [track, midi] = k.split(":").map(Number); send({ t: "off", track, midi }); letGo({ t: "off", track, midi, b }); }
    for (const track of s?.bends ?? []) { send({ t: "bend", track, semis: 0 }); letGo({ t: "bend", track, semis: 0, b }); }
    if (s?.repeat) { setRepeatState(0); send({ t: "repeat", beats: 0 }); letGo({ t: "repeat", beats: 0, b }); }
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
    midiOut.current?.on(track, midi, vel);
    if (share) live1({ t: "on", track, midi, vel, ...band.stamp() });
    setHeld((h) => new Set(h).add(midi));
  }
  function noteOff(key: string) {
    const n = liveNotes.current.get(key);
    if (!n) return;
    liveNotes.current.delete(key);
    send({ t: "off", track: n.track, midi: n.midi });
    midiOut.current?.off(n.track, n.midi);
    if (n.share) live1({ t: "off", track: n.track, midi: n.midi, ...band.stamp() });
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
  function setRepeat(beats: number) {
    move(live.current.selected, LANE_STUTTER, beats, live.current.repeat);
    setRepeatState(beats); send({ t: "repeat", beats }); live1({ t: "repeat", beats, ...band.stamp() });
  }
  function setBend(semis: number) {
    const track = live.current.selected;
    move(track, LANE_BEND, semis, live.current.bend);
    setBendState(semis);
    send({ t: "bend", track, semis });
    shareBend({ t: "bend", track, semis, ...band.stamp() });
  }

  // ---- transport: everyone in the room plays and stops together ----
  function play() { send({ t: "play", countIn: 0 }); live1({ t: "play" }); }
  function stopHere() { send({ t: "stop" }); setRecording(false); send({ t: "rec", on: false }); flushTake(); }
  function stop() { stopHere(); live1({ t: "stop" }); }
  function startRec() {
    const { transportOn, countIn } = live.current;
    setRecording(true);
    send({ t: "rec", on: true });
    if (!transportOn) send({ t: "play", countIn: countIn ? COUNT_IN : 0 });
  }
  function stopRec() { setRecording(false); send({ t: "rec", on: false }); flushTake(); }
  /** R and the Rec button: audio onto the track the input is open on, else the notes you play. */
  function toggleRecord() { if (live.current.recording) stopRec(); else startRec(); }
  /** Record audio: the input on the selected track, then the count-in and one pass, in one press. */
  async function recordAudio() {
    if (live.current.recording) return stopRec();
    imports.say(null);
    if (await openInput(live.current.selected)) startRec();
  }
  /** Record MIDI: the notes played onto the selected track, and no audio (the input closes). */
  function recordMidi() {
    if (live.current.recording) return stopRec();
    imports.say(null);
    if (input.current || armed !== null) closeInput();
    startRec();
  }

  // ---- imports (src/ui/import.ts): a sound file as a take, a MIDI file's notes; from the add menu or dropped on a track ----
  const imports = useImports({ project: () => proj.current, mayEdit: () => live.current.allowed.edit, commit, landTake, select: setSelected });
  function panic() { releaseAll(); stop(); setRepeatState(0); send({ t: "panic" }); midiOut.current?.panic(); }

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
      // the view: - zooms out, = zooms in, \ fits the loop
      if (e.code === "Minus" || e.code === "Equal") { e.preventDefault(); const k = e.code === "Minus" ? 2 : 0.5; changeView((v, L) => zoomAbout(v, L, k, v.from + v.span / 2)); return; }
      if (e.code === "Backslash") { e.preventDefault(); changeView((_, L) => fit(L)); return; }
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
        const plug = proj.current.tracks[selected]?.plugin;
        if (hit && "plug" in hit) { if (plug) commit({ t: "plugin", track: selected, plugin: withValue(plug, hit.plug, hit.v) }, { group: `plug:${selected}:${hit.plug}` }); }
        else if (hit) commit({ t: "param", track: selected, i: hit.i, v: hit.v }, { group: `p:${selected}:${hit.i}` });
      },
      devices: setMidiDevices,
    }).then((s) => { stopMidi = s; });
    let out: MidiOut | null = null;
    const sync = () => { if (out) setOutPorts({ ports: out.ports(), picked: out.picked() }); };
    void startMidiOut(sync).then((o) => { out = midiOut.current = o; sync(); });
    return () => { stopMidi?.(); out?.panic(); out?.stop(); midiOut.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  // ---- bounce ----
  /** `p` rendered `secs` long at `sr`, as a bounce plays it: interleaved stereo, and what it had to leave out. */
  async function mixdown(p: Project, sr: number, secs: number): Promise<{ pcm: Float32Array; missed: string[] }> {
    const bytes = engine === "rust" ? await fetchWasm() : null;
    const make = async (): Promise<FmEngine> => (bytes ? new WasmEngine(await instantiateFm(bytes.slice(0)), sr) : new TsEngine(sr));
    const render = async (fx?: BounceInserts) => {
      const e = await make();
      try { return renderProject(e, p, sr, secs, dbToGain(-6), (id) => takes.current.get(id), (t) => sound.get(t), aux2.settings, fx); } finally { e.free?.(); }
    };
    // a plugin track's sound comes from the desktop host, which has the plugin; one it can't play is named below
    const frames = bounceFrames(p, sr, secs);
    const { sound, missed } = await bouncePlugins(p, sr, frames, undefined, webRack, fxRack);
    // an FM track's web effect (#5551): its sound rendered first, then through a copy of the effect, then the mix with it
    const tap = new Map<number, Float32Array>();
    const ins = await bounceInserts(p, sr, frames, async () => { await render({ tap }); return tap; }, fxRack);
    return { pcm: await render({ back: (t) => ins.back.get(t) }), missed: [...missed, ...ins.missed] };
  }

  async function doBounce() {
    setBounce({ busy: true });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const p = proj.current, sr = 48000;
      const { pcm, missed } = await mixdown(p, sr, loopSeconds(p, bounceLoops(p)));
      const wav = encodeWav(pcm, sr);
      // Online, the sesh keeps its last bounce, so a DJ's decks can play it by the sesh's name.
      if (!solo && netStatus.state === "online") void shareBounce(wav, p.bpm).then((ok) => ok && setBounce((b) => ({ ...b, decks: true })));
      try {
        const path = await saveBounce("FM DAW", toBase64(wav));
        setBounce({ busy: false, path, saved: true, missed });
      } catch {
        // no desktop host (browser or edge): hand the file to the browser instead
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }));
        a.download = "fm-daw-bounce.wav";
        a.click();
        setBounce({ busy: false, path: "Downloaded fm-daw-bounce.wav", missed });
      }
    } catch (err) { setBounce({ busy: false, error: (err as Error).message }); }
  }

  const t = project.tracks[selected];
  const L = loopBeats(project);
  const grid = GRIDS[gridIdx];
  // The grid and roll see a window of the loop (view.ts): the view as zoomed,
  // widened to whole cells of a grid that thins as you zoom out. Edits map
  // back into the whole track; notes outside the window are never touched.
  const shownView = clampView(timeView, L);
  const step = gridFor(shownView.span, editorPx, t.kind === "drum" ? 0.25 : grid.beats, L);
  const win: View = snapView(shownView, step, L);
  viewRef.current = win;
  const windowed = (tr: TrackDoc) => windowNotes(tr.notes, win);
  const color = TRACK_COLORS[selected];
  // a track's Insert: an FM track's, or a web plugin track's (#5551), the effect's pick and then its sliders
  const insertPick = <TrackSound slot="insert" track={t} choices={effectChoices} onPlugin={(insert) => commit({ t: "insert", track: selected, insert })} />;
  const insertPanel = (
    <InsertPanel track={t} color={color} shown={effects.get(selected)}
      onValue={(id, v) => { if (t.insert) commit({ t: "insert", track: selected, insert: withValue(t.insert, id, v) }, { group: `fx:${selected}:${id}` }); }}
      onEditor={() => fxPump.current?.openEditor(selected, `${t.name} · ${t.insert?.name ?? ""}`) ?? Promise.resolve("start the sound first")}
      onTrust={() => fxPump.current?.trust(selected, proj.current)} />
  );
  // the selected track's audio, inside the Timeline under its editor so the ruler, zoom and playhead line up with it
  const clipLane = clipsOf(t).length > 0 && (
    <ClipLane key={selected} clips={clipsOf(t)} sound={(id) => takes.current.get(id)} bpm={project.bpm} loopBeats={L} from={win.from} span={win.span}
      grid={grid.beats} color={color} onClips={(clips, group) => commit({ t: "clips", track: selected, clips }, group ? { group } : {})} />
  );
  // a voice or a plugin, or no instrument: one undo step either way
  const trackSound = <TrackSound track={t} choices={pluginChoices}
    onPlugin={(plugin) => { const group = `sound:${performance.now()}`; if (t.voiceless) commit({ t: "voiceless", track: selected, on: false }, { group }); commit({ t: "plugin", track: selected, plugin }, { group }); }}
    onNone={() => { const group = `sound:${performance.now()}`; if (t.plugin) commit({ t: "plugin", track: selected, plugin: null }, { group }); commit({ t: "voiceless", track: selected, on: true }, { group }); }} />;

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
          {!solo && (
            <label className="field" title="How you hear the others: a loop late (everyone in time, a loop behind), at the desk (the leader: the whole band a fixed delay behind, lined up), or as it comes"><span className="silk">Hear the band</span>
              <select value={listen} onChange={(e) => { const v = e.currentTarget.value, l = LISTENS.find((x) => x === v); if (l) chooseListen(l); }}>
                {LISTENS.filter((l) => l !== "desk" || floor?.host).map((l) => (
                  <option key={l} value={l}>{l === "loop" ? "A loop late" : l === "desk" ? `At the desk (${DESK_MS} ms)` : "As it comes"}</option>
                ))}
              </select>
            </label>
          )}
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
              onChange={(e) => { const v = Number(e.currentTarget.value); setMasterDb(v); }} />
          </label>
          <Meter />
          <button className="panic" onClick={panic} title="Stop all sound (Esc)">Panic</button>
        </div>
      </header>
      {engineNote && <p className="note-bar" role="status">{engineNote}</p>}
      {inputNote && <p className="note-bar" role="status">{inputNote}</p>}
      {imports.note && <p className="note-bar" role="status">{imports.note} <button className="ghost tiny" onClick={() => imports.say(null)} aria-label="Dismiss" title="Dismiss">✕</button></p>}

      <div className="body">
        <nav className="tracks" aria-label="Tracks">
          {project.tracks.map((tr, i) => (
            <div key={i} className={`track${i === selected ? " sel" : ""}${imports.dropOn === i ? " drop" : ""}`} style={{ "--track": TRACK_COLORS[i] } as React.CSSProperties} {...imports.dropProps(i, win.from)}>
              <button className="track-name" onClick={() => { setSelected(i); }} onDoubleClick={() => audition(i)}>
                {i < 10 && <kbd>{(i + 1) % 10}</kbd>} {tr.name}{clipsOf(tr).length > 0 && <TakeMark />}<span className="kind" title={tr.voiceless ? "No instrument: its notes go out, silent here" : undefined}>{tr.voiceless ? "midi" : tr.plugin ? "plugin" : tr.kind}</span>
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
              <button className={view === "shape" ? "on" : ""} onClick={() => setView("shape")} title="Shape: an EQ on the master or on any one track (cuts, shelves, bells, notch)">Shape</button>
              <button className={view === "amp" ? "on" : ""} onClick={() => setView("amp")} title="Amp: play this track's take, or your guitar live, through a Q Amp head">Amp</button>
              <button className={view === "desk" ? "on" : ""} onClick={() => setView("desk")} title="Mixer: the sesh's desk, a strip per track (level, pan, Shape, Space send, mute, solo) and the Space return, for everyone in the sesh">Mixer</button>
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
            <button className="ghost" onClick={() => commit({ t: "notes", track: selected, notes: quantize(t.notes, grid.beats, strength, L) })}>Quantize {t.name}</button>
            <button className="ghost" onClick={() => commit({ t: "notes", track: selected, notes: [] })}>Clear {t.name}</button>
            <AddMenu track={t.name} ready={!!audio} counting={counting} input={armed !== null ? project.tracks[armed].name : null}
              rec={recording ? (armed !== null ? { kind: "audio", track: project.tracks[armed].name } : { kind: "midi", track: t.name }) : null}
              onRecordAudio={() => { void recordAudio(); }} onRecordMidi={recordMidi} snap={inputQ} onSnap={setInputQ} grid={grid.label} onStop={stopRec} onInputOff={closeInput}
              onFile={(kind, f) => { void imports.importFile(kind, f, selected, win.from); }} />
            {clipsOf(t).length > 0 && <button className="ghost" onClick={() => commit({ t: "take", track: selected, take: null })} title="Take the recorded audio off this track">Clear take</button>}
            <span className="spacer" />
            <button className="ghost" onClick={() => history("undo")} title="Undo (⌘Z)">Undo</button>
            <button className="ghost" onClick={() => history("redo")} title="Redo (⇧⌘Z)">Redo</button>
          </div>

          {imports.ask && <MidiLand song={imports.ask.song} file={imports.ask.file} project={project} track={imports.ask.track} at={imports.ask.at}
            onLand={(plan) => { if (imports.ask) imports.land(plan, imports.ask.song.bpm, imports.ask.file); }} onCancel={imports.cancel} />}
          {view === "engines" ? (
            <Bench project={project} wasm={fetchWasm} />
          ) : view === "desk" ? (
            <DeskPanel project={project} players={deskPlayers} cabled={aux2.label} onOps={(ops, group) => { for (const o of ops) commit(o, { group: group ?? "desk" }); }}
              sampleRate={audio?.ctx.sampleRate ?? 48000} analyser={audio?.analyser ?? null} heard={audio?.heard ?? null} onShape={setDeskShape} />
          ) : view === "amp" ? (
            <AmpPanel name={t.name} amp={t.amp} onChange={(amp, group) => commit({ t: "amp", track: selected, amp }, group ? { group } : {})}
              armed={armed === selected} monitor={monitor && armed === selected}
              onMonitor={(on) => { setMonitor(on); audio?.send({ t: "monitor", on }); }}
              roundTripMs={audio && armed !== null ? (inLatency(audio) + (audio.ctx.outputLatency || 0)) * 1000 : null}
              misses={ampMisses} />
          ) : view === "shape" ? (() => {
            // every Shape on the desk: the master's (it listens and automates), each track's, each player's, each return's
            const desk = seshDesk(project, deskPlayers);
            const ats: { key: string; at: ShapeAt }[] = [
              { key: "master", at: { master: true } },
              ...desk.channels.map((c) => ({ key: c.id, at: { channel: c.id } })),
              ...desk.returns.map((r) => ({ key: `aux-${r.aux}`, at: { aux: r.aux } })),
            ];
            const on = ats.find((x) => x.key === shapeOn) ?? ats[0];
            const doc = seshShape(project, deskPlayers, on.at);
            const head = (
              <label className="field inline"><span className="silk">Shape on</span>
                <select value={on.key} onChange={(e) => setShapeOn(e.currentTarget.value)} aria-label="Which Shape to edit">
                  {ats.map((x) => <option key={x.key} value={x.key}>{shapeName(desk, x.at)}{x.key !== "master" && seshShape(project, deskPlayers, x.at).some(Boolean) ? " ·" : ""}</option>)}
                </select>
              </label>
            );
            const sr = audio?.ctx.sampleRate ?? 48000, an = audio?.analyser ?? null;
            return on.key === "master" ? (
              <Shape key="master" head={head} doc={project.eq} sampleRate={sr} analyser={an}
                onChange={(bands, group) => commit({ t: "eq", bands }, group ? { group } : {})}
                onListen={(band) => audio?.send({ t: "eqListen", band })}
                lanes={project.eqAuto ?? []} onLanes={(lanes) => commit({ t: "eqAuto", lanes })}
                onMove={(i, v, was) => move(MASTER, i, v, was)} followsPlay
                linear={!!project.eqLinear} onLinear={(linear) => commit({ t: "eqPhase", linear })} />
            ) : (
              <Shape key={on.key} head={head} doc={doc} sampleRate={sr} analyser={audio?.heard ?? null}
                onChange={(bands, group) => { for (const o of shapeOps(proj.current, deskPlayers, on.at, bands)) commit(o, group ? { group } : {}); }} />
            );
          })() : t.kind === "drum" ? (<>
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
            <Timeline view={shownView} win={win} loop={L} beatsPerBar={BEATS_PER_BAR} tracks={project.tracks} colors={TRACK_COLORS}
              follow={follow} onFollow={setFollow} onView={changeView} onPx={setEditorPx}>
              {(() => {
                const shown = project.tracks.map(windowed);
                return <DrumGrid tracks={project.tracks.map((tr, i) => ({ ...tr, notes: shown[i].notes }))} colors={TRACK_COLORS} selected={selected}
                  loopBeats={win.span} from={win.from} step={step}
                  onSelect={setSelected} onAudition={audition}
                  onNotes={(i, notes) => commit({ t: "notes", track: i, notes: shown[i].back(notes) })} />;
              })()}
              {clipLane}
            </Timeline>
          </>) : (<>
            <Timeline view={shownView} win={win} loop={L} beatsPerBar={BEATS_PER_BAR} tracks={project.tracks} colors={TRACK_COLORS}
              follow={follow} onFollow={setFollow} onView={changeView} onPx={setEditorPx}>
              {(() => {
                const shown = windowed(t);
                return <PianoRoll key={selected} track={{ ...t, notes: shown.notes }} color={color} loopBeats={win.span} from={win.from} grid={step}
                  onNotes={(notes: Note[]) => commit({ t: "notes", track: selected, notes: shown.back(notes) })}
                  onPreview={(m, on) => (on ? noteOn(`roll:${m}`, selected, m, 0.8) : noteOff(`roll:${m}`))} />;
              })()}
              {clipLane}
            </Timeline>
          </>)}

          <Perform track={t} color={color} repeat={repeat} bend={bend} onRepeat={setRepeat} onBend={setBend}
            onParam={(i, v) => commit({ t: "param", track: selected, i, v }, { group: `p:${selected}:${i}` })}
            onPad={(i, v) => { move(selected, i, v, t.params[i]); commit({ t: "param", track: selected, i, v }, { group: `p:${selected}:${i}` }); }}
            onLanes={(lanes) => commit({ t: "auto", track: selected, lanes })} />

          {t.plugin ? (<>
            <PluginPanel track={t} color={color} shown={plugins.get(selected)} head={t.plugin.web ? <>{trackSound}{insertPick}</> : trackSound}
              onValue={(id, v) => { if (t.plugin) commit({ t: "plugin", track: selected, plugin: withValue(t.plugin, id, v) }, { group: `plug:${selected}:${id}` }); }}
              onParam={(i, v) => commit({ t: "param", track: selected, i, v }, { group: `p:${selected}:${i}` })}
              onEditor={() => pump.current?.openEditor(selected, `${t.name} · ${t.plugin?.name ?? ""}`) ?? Promise.resolve("start the sound first")}
              onTrust={() => pump.current?.trust(selected, proj.current)} />
            {t.plugin.web && insertPanel}</>
          ) : <><PatchEditor track={t} color={color} duck={{ names: project.tracks.map((x) => x.name), self: selected }} head={<>{trackSound}{insertPick}</>}
            onSound={(s) => commit({ t: "replace", project: { ...project, tracks: project.tracks.map((x, i) => (i === selected ? { ...x, params: loadSound(x.params, s) } : x)) } })}
            onParam={(i, v) => commit({ t: "param", track: selected, i, v }, { group: `p:${selected}:${i}` })}
            onRandom={() => commit({ t: "replace", project: { ...project, tracks: project.tracks.map((x, i) => (i === selected ? { ...x, params: randomPatch(x.kind, x.params) } : x)) } })}
            onReset={() => commit({ t: "replace", project: { ...project, tracks: project.tracks.map((x, i) => (i === selected ? { ...x, params: KIT[i].params.slice() } : x)) } })}
            onAudition={() => audition(selected)} />
            {insertPanel}</>}
        </main>
      </div>

      <Keys base={keyBase(selected, octave)} octave={octave} held={held} midiDevices={midiDevices} color={color}
        outPorts={outPorts} onOutPort={(name) => { releaseAll(); midiOut.current?.pick(name); }}
        onKey={(m, on) => (on ? noteOn(`ui:${m}`, selected, m, 0.8) : noteOff(`ui:${m}`))}
        onOctave={(d) => setOctave((o) => Math.min(Math.max(o + d, -3), 3))} />

      <footer className="status">
        <span className={`dot ${solo ? "online" : netStatus.state}`} />
        <span>{solo ? "Solo · saved in this browser, never shared" : netStatus.state === "online"
          ? netStatus.peers > 1 ? `Saved · jamming with ${netStatus.peers - 1} other${netStatus.peers > 2 ? "s" : ""}` : roomName() ? "Saved" : "Saved to this machine"
          : netStatus.state === "connecting" ? "Connecting…" : netStatus.state === "full" ? `${netStatus.full === "closed" ? "Closed by its maker" : netStatus.full === "blocked" ? "Not let in" : netStatus.full === "code" || netStatus.full === "tries" ? "Private sesh" : "No room"}: playing alone, not saving` : "Not saving (no world)"}</span>
        {roomName() && !solo && <span className="dim" title={netStatus.locked ? "Private: share the link and the code" : "Keep this link: the name is the key to this groove"}>sesh {roomName()}</span>}
        <button className="ghost" onClick={() => setMySetup(saveMine("setup", proj.current))} title="Keep a copy of this groove in this browser to come back to">Save my setup</button>
        <button className="ghost" disabled={!mySetup} onClick={() => { const p = loadMine("setup"); if (p) commit({ t: "replace", project: p }); }}
          title={solo ? "Load your saved setup (undo brings this one back)" : "Put your saved setup into the sesh, for everyone (undo brings theirs back)"}>Back to my setup</button>
        {roomName() && (solo
          ? <button className="ghost" onClick={backToSesh} title="Back to the shared groove; your solo project stays saved here">Back to the sesh</button>
          : <button className="ghost" onClick={goSolo} title="Play your own project, apart from the sesh: saved in this browser, never sent">Go solo</button>)}
        {floor && grants && !solo && netStatus.state === "online" && <People grants={grants} guests={guests} floor={floor.state} chat={chat.view} maker={floor.host} onGrant={(m) => net.current?.grant(m)}
          onGuest={(a) => net.current?.guest(a) ?? Promise.resolve({ ok: false, why: "Offline" })} />}
        {allowed.lead && floor && !solo && <>
          {floor.state !== "closed" && <button className={floor.state === "held" ? "ghost on" : "ghost"} aria-pressed={floor.state === "held"}
            title={floor.state === "held" ? "Let everyone edit and play again" : "Only you edit and play into the room (Esc)"}
            onClick={() => net.current?.floor(floor.state === "held" ? "free" : "held")}>{floor.state === "held" ? "Freezone" : "Hold"}</button>}
          <button className="ghost" title={floor.state === "closed" ? "Let everyone back in" : "End the jam: everyone else is sent away, the groove is kept"}
            onClick={() => net.current?.floor(floor.state === "closed" ? "free" : "closed")}>{floor.state === "closed" ? "Reopen" : "Close out"}</button>
          {netStatus.state === "online" && <LockButton locked={!!netStatus.locked} onLock={(c) => net.current?.lock(c)} />}
        </>}
        {locked && !solo && <span className="warn-text" role="status">You're listening: heard only here. Raise a hand to play</span>}
        {!solo && netStatus.state === "online" && <WindBack rewound={rewound} leads={allowed.lead} onAsk={(ago) => net.current?.rewind(ago)} onBack={() => endLook()} onBring={bringBack} />}
        <span className="spacer" />
        {bounce.path && <span className="dim">{bounce.path}</span>}
        {bounce.saved && <button className="ghost" onClick={() => reveal(bounce.path!)}>Show</button>}
        {!!bounce.missed?.length && <span className="err">Bounced without {bounce.missed.join(", ")}</span>}
        {bounce.error && <span className="err">{bounce.error}</span>}
        {bounce.decks && <span className="dim" title="A DJ booth's deck plays this bounce: load the sesh's name on a deck in Sound Guy Simulator">On the decks as {roomName()}</span>}
        <button className="ghost" onClick={doBounce} disabled={bounce.busy}>{bounce.busy ? "Bouncing…" : bounceLoops(project) === 1 ? "Bounce the song to WAV" : "Bounce 4 loops to WAV"}</button>
      </footer>

      <Cursors />
      {roomName() && !solo && <ChatDock chat={chat} net={net.current} online={netStatus.state === "online"} />}
      {netStatus.state === "full" && !solo && (
        <FullCard why={netStatus.full ?? "rooms"} room={roomName()} onSolo={goSolo}
          onRetry={() => { setSolo(false); setAttempt((a) => a + 1); }} />
      )}
      {audio && !tried && (
        <div className="first-try" role="status">
          <p><strong>{COPY.tryBold}</strong> {COPY.try}</p>
          <button className="play big" onClick={() => { play(); markTried(); }}>{COPY.playGroove}</button>
          <p className="dim">{COPY.then}<span className="keys-hint"> {COPY.keys}</span></p>
          <button className="ghost close" onClick={markTried} aria-label="Close" title="Close">×</button>
        </div>
      )}
      {!audio && (netStatus.state !== "full" || solo) && (
        <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <div className="gate-card">
            <h2 id="gate-title">{COPY.heading}</h2>
            <p>{COPY.pitch}</p>
            <p><strong>{COPY.speakersBold}</strong> {COPY.speakers}</p>
            <button className="play big" onClick={startAudio} autoFocus>{COPY.start}</button>
            {startError && <p className="err">{startError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A track holding a recorded take: lucide's audio-waveform (ISC). */
function TakeMark() {
  return (
    <svg className="take-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Recorded take">
      <title>Recorded take</title>
      <path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2" />
    </svg>
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
