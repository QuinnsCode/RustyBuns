// OSC 1.0 (#6474): read and write messages, and OSC's door into the control map (map.ts). Every control answers to
// its id as an address under /qollab/ ("light.1.dimmer" is /qollab/light/1/dimmer, 0 to 1); any other address can be
// learned like a MIDI fader. Pure: the page, the bridge and the tests share it.
import type { Signal } from "./map.ts";

/** A number is sent as a float32; `{ int }` as an int32, for a receiver that insists. */
export type OscArg = number | string | boolean | { int: number };
export interface OscMessage { address: string; args: OscArg[] }

const pad4 = (n: number) => (n + 3) & ~3;
function oscString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s), out = new Uint8Array(pad4(bytes.length + 1));
  out.set(bytes);
  return out;
}
function word(write: (v: DataView) => void): Uint8Array {
  const out = new Uint8Array(4);
  write(new DataView(out.buffer));
  return out;
}
export function encodeOsc({ address, args }: OscMessage): Uint8Array<ArrayBuffer> {
  let tags = ",";
  const data: Uint8Array[] = [];
  for (const a of args) {
    if (typeof a === "number") { tags += "f"; data.push(word((v) => v.setFloat32(0, a))); }
    else if (typeof a === "string") { tags += "s"; data.push(oscString(a)); }
    else if (typeof a === "boolean") tags += a ? "T" : "F";
    else { tags += "i"; data.push(word((v) => v.setInt32(0, a.int))); }
  }
  const parts = [oscString(address), oscString(tags), ...data];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The messages in a packet: one, or a bundle's (timetags ignored: they are played as they come). Malformed: none. */
export function decodeOsc(packet: Uint8Array, depth = 0): OscMessage[] {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let at = 0;
  const string = (): string | null => {
    const end = packet.indexOf(0, at);
    if (end < 0) return null;
    const s = new TextDecoder().decode(packet.subarray(at, end));
    at = pad4(end + 1);
    return s;
  };
  const address = string();
  if (address === "#bundle") {
    const out: OscMessage[] = [];
    for (at = 16; depth < 4 && at + 4 <= packet.length;) {
      const n = view.getInt32(at);
      at += 4;
      if (n <= 0 || at + n > packet.length) break;
      out.push(...decodeOsc(packet.subarray(at, at + n), depth + 1));
      at += n;
    }
    return out;
  }
  if (!address?.startsWith("/")) return [];
  const tags = at < packet.length ? string() : ",";
  if (!tags?.startsWith(",")) return [];
  const args: OscArg[] = [];
  for (const t of tags.slice(1)) {
    if (t === "T" || t === "F") args.push(t === "T");
    else if (t === "s") { const s = string(); if (s === null) return []; args.push(s); }
    else if (t === "i" || t === "f") {
      if (at + 4 > packet.length) return [];
      args.push(t === "i" ? { int: view.getInt32(at) } : view.getFloat32(at));
      at += 4;
    } else return []; // a type this doesn't read: its length is unknown, so nothing after it can be trusted
  }
  return [{ address, args }];
}

const PREFIX = "/qollab/";
export const oscAddress = (id: string) => PREFIX + id.replaceAll(".", "/");

export function oscSignal({ address, args }: OscMessage): Signal {
  const a = args[0];
  const n = a === undefined ? 1 : typeof a === "object" ? a.int : Number(a);
  const value = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  return {
    source: "osc", key: address, value, down: value >= 0.5, momentary: a === undefined,
    ...(address.startsWith(PREFIX) ? { to: address.slice(PREFIX.length).replaceAll("/", ".") } : {}),
  };
}
