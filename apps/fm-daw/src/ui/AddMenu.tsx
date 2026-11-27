// One way onto the selected track: record audio, record MIDI, import audio, import MIDI (quantize input sits with Quantize). While recording it says
// what is going down and onto which track, and stop is one press. Icons after lucide (ISC), the word as the tooltip.
import { useRef, useState } from "react";
import { AUDIO_ACCEPT, MIDI_ACCEPT } from "./import.ts";
import { barsFor, landMidi, type MidiPlan, type MidiSong } from "../midi-file.ts";
import { MAX_BARS, type Project } from "../project.ts";

export interface Recording { kind: "audio" | "midi"; track: string }

export function Icon(props: { children: React.ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{props.children}</svg>;
}
const FILE = <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></>;
export const ICONS = {
  // mic
  audio: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></>,
  // keyboard-music
  midi: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M6 8h4" /><path d="M14 8h.01" /><path d="M18 8h.01" /><path d="M2 12h20" /><path d="M6 12v4" /><path d="M10 12v4" /><path d="M14 12v4" /><path d="M18 12v4" /></>,
  // file with a waveform
  importAudio: <>{FILE}<path d="M8 13v4" /><path d="M11 11v8" /><path d="M14 12v6" /><path d="M17 14v2" /></>,
  // file with a note
  importMidi: <>{FILE}<circle cx="10" cy="17" r="2" /><path d="M12 17v-6l3 1" /></>,
  // magnet
  snap: <><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15" /><path d="m5 8 4 4" /><path d="m12 15 4 4" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  // undo-2, redo-2
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" /></>,
};

export function AddMenu(props: {
  track: string; rec: Recording | null; counting: number; ready: boolean; input: string | null;
  onRecordAudio(): void; onRecordMidi(): void; onStop(): void; onFile(kind: "audio" | "midi", f: File): void; onInputOff(): void;
}) {
  const audioFile = useRef<HTMLInputElement>(null), midiFile = useRef<HTMLInputElement>(null);
  const picked = (kind: "audio" | "midi") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (f) props.onFile(kind, f);
  };
  const needSound = props.ready ? "" : " (press Start for sound first)";
  const r = props.rec;
  return (
    <div className="add-menu" role="group" aria-label={`Add to ${props.track}`}>
      {r ? <>
        <span className={`rec-status ${r.kind}`} role="status">
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-text">{props.counting ? `Count-in ${props.counting}: ` : "Recording "}{r.kind === "audio" ? "audio" : "MIDI"} onto <b>{r.track}</b></span>
        </span>
        <button className="icon-btn stop" onClick={props.onStop} title="Stop recording (R)" aria-label="Stop recording"><Icon>{ICONS.stop}</Icon></button>
      </> : <>
        <button className="icon-btn" onClick={props.onRecordAudio} disabled={!props.ready} title={`Record audio onto ${props.track}: a mic or a guitar, one pass of the loop${needSound}`} aria-label="Record audio"><Icon>{ICONS.audio}</Icon></button>
        <button className="icon-btn" onClick={props.onRecordMidi} disabled={!props.ready} title={`Record MIDI onto ${props.track}: the notes you play (R)${needSound}`} aria-label="Record MIDI"><Icon>{ICONS.midi}</Icon></button>
        <button className="icon-btn" onClick={() => audioFile.current?.click()} title={`Import audio onto ${props.track}: wav, mp3, m4a, ogg or flac (or drop one on a track)`} aria-label="Import audio"><Icon>{ICONS.importAudio}</Icon></button>
        <button className="icon-btn" onClick={() => midiFile.current?.click()} title={`Import MIDI onto ${props.track}: a .mid file (or drop one on a track)`} aria-label="Import MIDI"><Icon>{ICONS.importMidi}</Icon></button>
      </>}
      {props.input && !r && <span className="input-chip" title={`The input is open on ${props.input}: heard through its Amp, and Record audio takes it`}>
        <Icon>{ICONS.audio}</Icon>{props.input}
        <button className="icon-btn tiny" onClick={props.onInputOff} title="Close the input" aria-label="Close the input"><Icon>{ICONS.x}</Icon></button>
      </span>}
      <input ref={audioFile} type="file" accept={AUDIO_ACCEPT} hidden onChange={picked("audio")} />
      <input ref={midiFile} type="file" accept={MIDI_ACCEPT} hidden onChange={picked("midi")} />
    </div>
  );
}

/**
 * A MIDI file read, before it lands: one part onto a track or every part down from it, the loop grown to fit, the
 * file's tempo. Says plainly what won't fit.
 */
export function MidiLand(props: { song: MidiSong; file: string; project: Project; track: number; at: number; onLand(plan: MidiPlan): void; onCancel(): void }) {
  const { song, project: p } = props;
  const many = song.parts.length > 1;
  const [spread, setSpread] = useState(many);
  const [part, setPart] = useState(0);
  const need = barsFor(song.parts, props.at);
  const [grow, setGrow] = useState(true);
  const [tempo, setTempo] = useState(false);
  const plan: MidiPlan = { parts: spread ? song.parts : [song.parts[part]], track: props.track, at: props.at, grow, tempo };
  const got = landMidi(p, plan, song.bpm);
  const last = Math.min(p.tracks.length - 1, props.track + plan.parts.length - 1);
  const notes = plan.parts.reduce((n, x) => n + x.notes.length, 0);
  const past = barsFor(plan.parts, props.at) > p.bars;
  return (
    <section className="midi-land" aria-label="Import MIDI">
      <h2>Import <span className="dim">{props.file}</span></h2>
      {many && <div className="field-row">
        <label className="check"><input type="radio" name="midi-how" checked={spread} onChange={() => setSpread(true)} /> All {song.parts.length} parts, onto {p.tracks[props.track].name}{last > props.track ? ` to ${p.tracks[last].name}` : ""}</label>
        <label className="check"><input type="radio" name="midi-how" checked={!spread} onChange={() => setSpread(false)} /> One part onto {p.tracks[props.track].name}:</label>
        <select value={part} disabled={spread} onChange={(e) => setPart(Number(e.currentTarget.value))} aria-label="Which part">
          {song.parts.map((x, i) => <option key={i} value={i}>{x.name} ({x.notes.length} notes)</option>)}
        </select>
      </div>}
      {past && <label className="check"><input type="checkbox" checked={grow} onChange={(e) => setGrow(e.currentTarget.checked)} /> Grow the loop to {Math.min(need, MAX_BARS)} bars (it is {p.bars}) so every note fits</label>}
      {song.bpm !== null && Math.round(song.bpm) !== p.bpm && <label className="check"><input type="checkbox" checked={tempo} onChange={(e) => setTempo(e.currentTarget.checked)} /> Take the file's tempo, {Math.round(song.bpm)} BPM (now {p.bpm})</label>}
      <p className="dim">
        {notes} notes from bar {Math.floor(props.at / 4) + 1}, over what those bars held.
        {got.cut > 0 && ` ${got.cut} ${got.cut === 1 ? "note falls" : "notes fall"} past the loop and won't come in.`}
        {got.spare > 0 && ` ${got.spare} ${got.spare === 1 ? "part has" : "parts have"} no track left below and won't come in.`}
      </p>
      <div className="field-row">
        <button className="ghost on" onClick={() => props.onLand(plan)}>Import</button>
        <button className="ghost" onClick={props.onCancel}>Cancel</button>
      </div>
    </section>
  );
}
