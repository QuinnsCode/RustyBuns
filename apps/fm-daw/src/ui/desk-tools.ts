// The desk's editor actions as commands: one function per action, and every door calls it. The toolbar's buttons, the
// Cmd/Ctrl+K palette, WebMCP (and window.__commands) and the `window.fmdaw` probe handle all reach the same `Desk`
// (App.tsx builds it each render). Modelled on `studioTools` in src/studio/agent.ts. The piano roll adds its own.
import type { Command, Via } from "@rustybuns/util/commands";
import { bool, check, int, num, obj, oneOf, opt, type Guard } from "@rustybuns/util/guard";
import { GRIDS } from "../quantize.ts";

export const VIEWS = ["pattern", "shape", "amp", "desk", "engines"] as const;
export type DeskView = (typeof VIEWS)[number];
const GRID_LABELS = GRIDS.map((g) => g.label);

/** What the desk is showing and playing, as an agent reads it. */
export interface DeskState {
  view: DeskView;
  grid: string;
  strength: number;
  inputQuantize: boolean;
  selected: number;
  playing: boolean;
  recording: boolean;
  /** Whether this player may change the groove (the sesh's leader can say no). */
  mayEdit: boolean;
  tracks: { name: string; notes: number; mute: boolean; solo: boolean }[];
  /** The selected track's notes: start and length in beats, MIDI key, velocity 0..1. */
  notes: { s: number; l: number; m: number; v: number }[];
}

/** The desk's actions. App.tsx makes one per render; each is the one function its button calls. */
export interface Desk {
  state(): DeskState;
  view(v: DeskView): void;
  grid(i: number): void;
  strength(s: number): void;
  inputQuantize(on: boolean): void;
  quantize(): void;
  clear(): void;
  undo(): void;
  redo(): void;
  select(track: number): void;
  play(): void;
  stop(): void;
  /** Start recording onto the selected track, or stop if it is recording. */
  record(): void;
  mute(track: number, on: boolean): void;
  solo(track: number, on: boolean): void;
}

const no = (why: string) => ({ ok: false, why });
const read = <T>(g: Guard<T>, v: unknown): T | null => check(g, v);
const TrackArgs = obj({ track: int(0, 63) });
const OnArgs = obj({ track: int(0, 63), on: opt(bool()) });

/** The desk's commands, each through `desk()` (the desk as it is now). */
export function deskTools(desk: () => Desk): Command[] {
  const edit = (run: (d: Desk) => void) => () => {
    const d = desk();
    if (!d.state().mayEdit) return no("The leader hasn't let you change the groove");
    run(d);
    return { ok: true };
  };
  // a person in the palette types the number they see (from 1); an agent passes the index desk_state lists (from 0)
  const track = (a: unknown, via: Via, run: (d: Desk, track: number) => unknown) => {
    const args = read(TrackArgs, a), d = desk(), n = d.state().tracks.length;
    const i = args ? args.track - (via === "palette" ? 1 : 0) : -1;
    if (i < 0 || i >= n) return no(via === "palette" ? `No such track: 1 to ${n}` : `No such track: pass track 0 to ${n - 1} (desk_state lists them)`);
    return run(d, i);
  };
  const toggle = (a: unknown, via: Via, key: "mute" | "solo") => {
    const args = read(OnArgs, a);
    return track(a, via, (d, i) => {
      const on = args?.on ?? !d.state().tracks[i][key];
      d[key](i, on);
      return { ok: true, track: d.state().tracks[i].name, [key]: on };
    });
  };
  const trackSchema = { type: "object", properties: { track: { type: "integer", description: "A track's index from desk_state, from 0" } }, required: ["track"] } as const;
  const cmds: Command[] = [
    { name: "desk_state", title: "Read the desk", annotations: { readOnlyHint: true }, palette: false,
      description: "The desk as it stands: the editor view, the Grid and Strength quantize uses, whether input quantize is on, the selected track, playing and recording, each track (notes, mute, solo) and the selected track's notes (s start and l length in beats, m MIDI key, v velocity).",
      execute: () => desk().state() },
    { name: "desk_view", title: "Show a view", ask: `view (${VIEWS.join(", ")})`,
      description: "Switch the editor: pattern (the notes or drum grid), shape (EQ), amp, desk (the mixer) or engines (the engine race).",
      inputSchema: { type: "object", properties: { view: { type: "string", enum: VIEWS } }, required: ["view"] },
      execute: (a) => {
        const args = read(obj({ view: oneOf(VIEWS) }), a);
        if (!args) return no(`A view is one of ${VIEWS.join(", ")}`);
        desk().view(args.view);
        return { ok: true, view: args.view };
      } },
    { name: "desk_grid", title: "Set the quantize grid", ask: `grid (${GRID_LABELS.join(", ")})`,
      description: "The grid Quantize and input quantize snap to.",
      inputSchema: { type: "object", properties: { grid: { type: "string", enum: GRID_LABELS } }, required: ["grid"] },
      execute: (a) => {
        const args = read(obj({ grid: oneOf(GRID_LABELS) }), a);
        if (!args) return no(`A grid is one of ${GRID_LABELS.join(", ")}`);
        desk().grid(GRID_LABELS.indexOf(args.grid));
        return { ok: true, grid: args.grid };
      } },
    { name: "desk_strength", title: "Set the quantize strength", ask: "strength, 0 to 100 (%)",
      description: "How far Quantize pulls each note to the grid: 100 snaps, 50 keeps half the feel.",
      inputSchema: { type: "object", properties: { strength: { type: "number", minimum: 0, maximum: 100 } }, required: ["strength"] },
      execute: (a) => {
        const args = read(obj({ strength: num(0, 100) }), a);
        if (!args) return no("Strength is a number from 0 to 100");
        desk().strength(args.strength / 100);
        return { ok: true, strength: args.strength };
      } },
    { name: "desk_input_quantize", title: "Quantize input on or off", icon: "magnet",
      description: "Whether recorded MIDI snaps to the grid as it goes down. Leave `on` out to flip it.",
      inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
      execute: (a) => {
        const d = desk(), on = read(obj({ on: opt(bool()) }), a)?.on ?? !d.state().inputQuantize;
        d.inputQuantize(on);
        return { ok: true, inputQuantize: on };
      } },
    { name: "desk_quantize", title: "Quantize the track",
      description: "Pull the selected track's notes toward the grid at the strength set (desk_grid, desk_strength). desk_undo puts them back.",
      execute: edit((d) => d.quantize()) },
    { name: "desk_clear", title: "Clear the track", annotations: { destructiveHint: true },
      description: "Take every note off the selected track. desk_undo puts them back.",
      execute: edit((d) => d.clear()) },
    { name: "desk_undo", title: "Undo", keys: "Cmd+Z", description: "Undo the last change to the groove.", execute: edit((d) => d.undo()) },
    { name: "desk_redo", title: "Redo", keys: "Shift+Cmd+Z", description: "Redo what undo took back.", execute: edit((d) => d.redo()) },
    { name: "desk_select", title: "Select a track", ask: "track number, from 1",
      description: "Select a track: the editor, Quantize, Clear and recording work on it.",
      inputSchema: trackSchema,
      execute: (a, via) => track(a, via, (d, i) => { d.select(i); return { ok: true, selected: d.state().tracks[i].name }; }) },
    { name: "desk_play", title: "Play or stop", keys: "Space",
      description: "Start the groove playing, or stop it if it is. Leave `on` out to flip it.",
      inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
      execute: (a) => {
        const d = desk(), on = read(obj({ on: opt(bool()) }), a)?.on ?? !d.state().playing;
        if (on) d.play(); else d.stop();
        return { ok: true, playing: on };
      } },
    { name: "desk_record", title: "Record or stop recording", keys: "R",
      description: "Record onto the selected track (MIDI, or audio when an input is open), or stop the recording under way.",
      execute: () => { const d = desk(); d.record(); return { ok: true, recording: !d.state().recording }; } },
    { name: "desk_mute", title: "Mute a track", ask: "track number, from 1",
      description: "Mute or unmute a track. Leave `on` out to flip it.",
      inputSchema: { type: "object", properties: { track: trackSchema.properties.track, on: { type: "boolean" } }, required: ["track"] },
      execute: (a, via) => toggle(a, via, "mute") },
    { name: "desk_solo", title: "Solo a track", ask: "track number, from 1",
      description: "Solo or unsolo a track. Leave `on` out to flip it.",
      inputSchema: { type: "object", properties: { track: trackSchema.properties.track, on: { type: "boolean" } }, required: ["track"] },
      execute: (a, via) => toggle(a, via, "solo") },
  ];
  return cmds.map((c) => ({ group: "Desk", ...c }));
}
