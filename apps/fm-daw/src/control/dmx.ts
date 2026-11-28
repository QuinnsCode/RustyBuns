// DMX (#6474): the show's fixtures on one universe of 512 bytes, and the three ways it leaves the page: Art-Net and
// sACN (E1.31) over UDP, sent by the local bridge (scripts/show-bridge.ts), and an Enttec DMX USB Pro style dongle
// over Web Serial. Each fixture takes six channels in a row, from address 1: dimmer, red, green, blue, pan, tilt.
// Pure: the page, the bridge and the tests share it.

export const CHANNELS = ["dimmer", "red", "green", "blue", "pan", "tilt"] as const;
export type Channel = (typeof CHANNELS)[number];
export const FOOTPRINT = CHANNELS.length;
export const UNIVERSE = 512;
export type Lit = Record<Channel, number>;

/** Where a fixture's channel sits in the universe, counting from 0 (DMX address = this + 1). */
export const slot = (fixture: number, channel: Channel) => fixture * FOOTPRINT + CHANNELS.indexOf(channel);

/** What the desk asks of fixture `i`, or null when it asks nothing (all six at 0): the room's own light then. */
export function litAt(universe: Uint8Array, i: number): Lit | null {
  const six = universe.subarray(i * FOOTPRINT, (i + 1) * FOOTPRINT);
  if (six.length < FOOTPRINT || six.every((v) => v === 0)) return null;
  return { dimmer: six[0]!, red: six[1]!, green: six[2]!, blue: six[3]!, pan: six[4]!, tilt: six[5]! };
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** The data a packet carries: an even count of channels, 2 to 512, as Art-Net asks. */
function padded(data: Uint8Array): Uint8Array {
  const n = Math.min(UNIVERSE, Math.max(2, data.length + (data.length % 2)));
  const out = new Uint8Array(n);
  out.set(data.subarray(0, n));
  return out;
}

// ---- Art-Net: ArtDmx (OpCode 0x5000) to UDP port 6454

export const ARTNET_PORT = 6454;
export function artDmx(universe: number, data: Uint8Array, sequence = 0): Uint8Array<ArrayBuffer> {
  const body = padded(data), out = new Uint8Array(18 + body.length);
  out.set(ascii("Art-Net\0"));
  // OpCode low byte first; protocol 14; sequence, physical; the 15-bit port address low byte first; length high byte first
  out.set([0x00, 0x50, 0, 14, sequence & 0xff, 0, universe & 0xff, (universe >> 8) & 0x7f, body.length >> 8, body.length & 0xff], 8);
  out.set(body, 18);
  return out;
}
export function parseArtDmx(p: Uint8Array): { universe: number; sequence: number; data: Uint8Array } | null {
  if (p.length < 20 || String.fromCharCode(...p.subarray(0, 8)) !== "Art-Net\0" || p[8] !== 0x00 || p[9] !== 0x50) return null;
  const n = (p[16]! << 8) | p[17]!;
  if (n < 2 || n > UNIVERSE || p.length < 18 + n) return null;
  return { universe: p[14]! | (p[15]! << 8), sequence: p[12]!, data: p.slice(18, 18 + n) };
}

// ---- sACN (ANSI E1.31): one data packet, to UDP port 5568 on the universe's own multicast group

export const SACN_PORT = 5568;
export const sacnGroup = (universe: number) => `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
export function sacnPacket(universe: number, data: Uint8Array, sequence: number, cid: Uint8Array, source = "Qollab Studio"): Uint8Array<ArrayBuffer> {
  const body = padded(data), out = new Uint8Array(126 + body.length), view = new DataView(out.buffer);
  const flags = (at: number) => view.setUint16(at, 0x7000 | (out.length - at));
  // root layer
  view.setUint16(0, 0x0010);
  out.set(ascii("ASC-E1.17\0\0\0"), 4);
  flags(16);
  view.setUint32(18, 0x00000004);
  out.set(cid.subarray(0, 16), 22);
  // framing layer: the source's name, priority 100, sequence, universe
  flags(38);
  view.setUint32(40, 0x00000002);
  out.set(ascii(source.slice(0, 63)), 44);
  out[108] = 100;
  out[111] = sequence & 0xff;
  view.setUint16(113, universe);
  // DMP layer: the start code 0, then the channels
  flags(115);
  out[117] = 0x02;
  out[118] = 0xa1;
  view.setUint16(121, 0x0001);
  view.setUint16(123, body.length + 1);
  out.set(body, 126);
  return out;
}

// ---- Enttec DMX USB Pro: "send DMX" (label 6), start and end bytes round a start code and the channels

export function enttecFrame(data: Uint8Array): Uint8Array<ArrayBuffer> {
  // the dongle wants at least 24 channels
  const n = Math.min(UNIVERSE, Math.max(24, data.length)), out = new Uint8Array(n + 6);
  out.set([0x7e, 6, (n + 1) & 0xff, (n + 1) >> 8, 0]);
  out.set(data.subarray(0, n), 5);
  out[n + 5] = 0xe7;
  return out;
}
