// QWERTY as a keyboard (Ableton's layout) and Web MIDI. Chrome gives the page
// MIDI directly; no plugin, no native code.

/** e.code -> semitones above the keyboard's C. Physical keys, so any layout works. */
export const QWERTY: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
export const KEY_LABEL: Record<number, string> = Object.fromEntries(
  Object.entries(QWERTY).map(([code, semi]) => [semi, code === "Semicolon" ? ";" : code === "Quote" ? "'" : code.slice(3)]),
);

export interface MidiHandlers {
  on(note: number, vel: number): void;
  off(note: number): void;
  panic(): void;
  devices(names: string[]): void;
}

export async function startMidi(h: MidiHandlers): Promise<(() => void) | null> {
  if (!("requestMIDIAccess" in navigator)) return null;
  let access: MIDIAccess;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); } catch { return null; }
  const onMsg = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 2) return;
    const kind = d[0] & 0xf0;
    if (kind === 0x90 && d[2] > 0) h.on(d[1], d[2] / 127);
    else if (kind === 0x80 || (kind === 0x90 && d[2] === 0)) h.off(d[1]);
    else if (kind === 0xb0 && (d[1] === 120 || d[1] === 123)) h.panic(); // all sound / all notes off
  };
  const wire = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => { input.onmidimessage = onMsg; names.push(input.name ?? "MIDI input"); });
    h.devices(names);
  };
  wire();
  access.onstatechange = wire; // hot-plug
  return () => { access.onstatechange = null; access.inputs.forEach((i) => { i.onmidimessage = null; }); };
}
