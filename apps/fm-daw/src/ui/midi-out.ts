// MIDI out: the desk's notes, yours and everyone's on the live line, sent to a
// MIDI port so the plugins (VST, AU, CLAP) in your own DAW play them. Track 1
// is channel 1, track 12 is channel 12; in the DAW, give each instrument track
// "IAC Driver" (macOS) or a loopMIDI port (Windows) as its input on that
// channel. The page never loads a plugin: the browser can't, the DAW already does.

/** Track index (0-based) -> MIDI channel (0-based). Twelve tracks fit in sixteen channels. */
export const channelOf = (track: number) => ((track % 16) + 16) % 16;

/** The bytes of a note on or off for `track`. Velocity 0..1; a note on never goes out as 0 (that reads as off). */
export function noteBytes(on: boolean, track: number, midi: number, vel = 0): number[] {
  const ch = channelOf(track), note = Math.min(Math.max(Math.round(midi), 0), 127);
  return on ? [0x90 | ch, note, Math.min(Math.max(Math.round(vel * 127), 1), 127)] : [0x80 | ch, note, 0];
}

/** All notes off on every channel: what the panic button sends. */
export const allOffBytes = (): number[][] => Array.from({ length: 16 }, (_, ch) => [0xb0 | ch, 123, 0]);

export interface MidiOut {
  /** The port names this machine has, for the picker. */
  ports(): string[];
  /** Send to this port, or nowhere (null). Remembered in this browser. */
  pick(name: string | null): void;
  picked(): string | null;
  on(track: number, midi: number, vel: number): void;
  off(track: number, midi: number): void;
  panic(): void;
  stop(): void;
}

const KEY = "fm-daw:midi-out";
const load = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const save = (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* private window */ } };

/** Opens Web MIDI's outputs. `changed` runs when a port comes or goes, or the pick changes. Null without Web MIDI. */
export async function startMidiOut(changed: () => void): Promise<MidiOut | null> {
  if (!("requestMIDIAccess" in navigator)) return null;
  let access: MIDIAccess;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch { return null; }
  let name = load();
  const port = () => { let hit: MIDIOutput | undefined; access.outputs.forEach((o) => { if (o.name === name) hit = o; }); return hit; };
  const out = (bytes: number[]) => { try { port()?.send(bytes); } catch { /* port went away mid-note */ } };
  access.onstatechange = changed;
  return {
    ports() { const n: string[] = []; access.outputs.forEach((o) => n.push(o.name ?? "MIDI output")); return n; },
    pick(v) { if (name && v !== name) allOffBytes().forEach(out); name = v; save(v); changed(); },
    picked: () => name,
    on: (track, midi, vel) => out(noteBytes(true, track, midi, vel)),
    off: (track, midi) => out(noteBytes(false, track, midi)),
    panic: () => allOffBytes().forEach(out),
    stop() { access.onstatechange = null; },
  };
}
