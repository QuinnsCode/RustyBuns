// MIDI's door into the control map (map.ts), and the message parsing the DJ decks share (dj/midi.ts).
import type { Signal } from "./map.ts";

/** A note or a CC off a controller: its channel (0 to 15), number and value (0 to 127; a note off is 0). */
export interface MidiMsg { type: "note" | "cc"; ch: number; n: number; v: number }
export function parseMidi(data: ArrayLike<number>): MidiMsg | null {
  if (data.length < 3) return null;
  const kind = data[0]! & 0xf0, ch = data[0]! & 0x0f, n = data[1]!, v = data[2]!;
  if (kind === 0x90 || kind === 0x80) return { type: "note", ch, n, v: kind === 0x80 ? 0 : v };
  if (kind === 0xb0) return { type: "cc", ch, n, v };
  return null;
}
/** The key a learned pairing is kept under ("cc:0:33"), and how a tag says it ("CC 33 ch1"). */
export const msgKey = (m: MidiMsg) => `${m.type}:${m.ch}:${m.n}`;
export function keyLabel(key: string): string {
  const [type, ch, n] = key.split(":");
  return `${type === "cc" ? "CC" : "Note"} ${n} ch${Number(ch) + 1}`;
}

export function midiSignal(device: string, data: ArrayLike<number>): Signal | null {
  const m = parseMidi(data);
  return m && { source: device, key: msgKey(m), value: m.v / 127, down: m.type === "note" ? m.v > 0 : m.v >= 64 };
}
