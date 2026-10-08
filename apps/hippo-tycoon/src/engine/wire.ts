// The wire. JSON, because there are four hippos and at most forty drops, with
// positions quantised to integers. Bump PROTO_VERSION on any change to a
// message: `hello` carries it and both sides refuse a mismatch before anything
// else is decoded. Control frames carry `seq` (the client keeps the highest);
// snapshots carry `tick`.
import type { Cfg, Phase, Snapshot } from "./match.ts";
import { DIFFICULTIES, ROUND_SECS, SEATS, type Difficulty } from "../sim/rules.ts";
import type { Event, Hippo } from "../sim/types.ts";

export const PROTO_VERSION = 2;
/** The `v=` a LAN guest sends, and the host requires (see rustybuns.config.ts). */
export const LAN_VERSION = `hippo-tycoon-p${PROTO_VERSION}`;
export const MAX_CLIENT_MESSAGE = 512;

/**
 * Close codes the client treats as final (no reconnect). CLOSE_FULL is kept
 * for old builds: a fifth human now watches instead (hello with no seats).
 */
export const CLOSE_VERSION = 4000, CLOSE_REPLACED = 4001, CLOSE_FULL = 4003, CLOSE_FLOOD = 4008;

// v2: `hello.k` asks for k seats on one socket (couch players over the network);
// `in.s` and `seat.s` say which of them; `cfg.n` sets one seat's bot; the room
// frame says which seats are yours (`you`), every bot's difficulty (`bd`) and how
// many are watching (`sp`). A hello reply with `you: -1` means you are watching.
export type ClientMsg =
  | { t: "hello"; v: number; k?: number }
  | { t: "in"; m: number; g: 0 | 1; h: 0 | 1; s?: number }
  | { t: "start" } | { t: "rematch" } | { t: "lobby" }
  | { t: "cfg"; secs?: number; diff?: Difficulty; n?: number }
  | { t: "seat"; n: number; s?: number }
  | { t: "ping"; n: number };

export interface RoomSeat { n: string; h: 0 | 1; r: 0 | 1 }
export type ServerMsg =
  | { t: "hello"; v: number; seq: number; you: number; room: string }
  | { t: "room"; seq: number; ph: Phase; seats: RoomSeat[]; secs: number; diff: Difficulty; bd: Difficulty[]; host: number; you: number[]; sp: number }
  | { t: "snap"; tick: number; round: number; ph: Phase; cd: number; left: number; hp: number[][]; dr: number[][]; sl: number[][]; ev: Event[] }
  | { t: "pong"; n: number }
  | { t: "err"; msg: string };

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const PHASES: readonly string[] = ["lobby", "countdown", "playing", "podium"];

/** Parse and validate one client message; anything off-shape is null. */
export function decodeClient(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_CLIENT_MESSAGE) return null;
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  switch (m.t) {
    case "hello":
      if (!isInt(m.v, 0, 1e6) || (m.k !== undefined && !isInt(m.k, 1, SEATS))) return null;
      return m.k !== undefined ? { t: "hello", v: m.v, k: m.k } : { t: "hello", v: m.v };
    case "in":
      if (!isInt(m.m, -100, 100) || !(m.g === 0 || m.g === 1) || !(m.h === 0 || m.h === 1) || (m.s !== undefined && !isInt(m.s, 0, SEATS - 1))) return null;
      return m.s !== undefined ? { t: "in", m: m.m, g: m.g, h: m.h, s: m.s } : { t: "in", m: m.m, g: m.g, h: m.h };
    case "start": case "rematch": case "lobby": return { t: m.t };
    case "cfg": {
      const out: ClientMsg = { t: "cfg" };
      if (m.secs !== undefined) { if (!(ROUND_SECS as readonly unknown[]).includes(m.secs)) return null; out.secs = m.secs as number; }
      if (m.diff !== undefined) { if (!(DIFFICULTIES as readonly unknown[]).includes(m.diff)) return null; out.diff = m.diff as Difficulty; }
      if (m.n !== undefined) { if (!isInt(m.n, 0, SEATS - 1) || out.diff === undefined || out.secs !== undefined) return null; out.n = m.n; }
      return out;
    }
    case "seat":
      if (!isInt(m.n, 0, SEATS - 1) || (m.s !== undefined && !isInt(m.s, 0, SEATS - 1))) return null;
      return m.s !== undefined ? { t: "seat", n: m.n, s: m.s } : { t: "seat", n: m.n };
    case "ping": return isInt(m.n, 0, 2 ** 31) ? { t: "ping", n: m.n } : null;
    default: return null;
  }
}

/** Parse one server message on the client (shape-checked, not trusted blindly). */
export function decodeServer(raw: unknown): ServerMsg | null {
  if (typeof raw !== "string") return null;
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m.t !== "string") return null;
    if (m.t === "snap" && (!Array.isArray(m.hp) || !Array.isArray(m.dr) || !PHASES.includes(m.ph))) return null;
    if (m.t === "room" && (!Array.isArray(m.seats) || !PHASES.includes(m.ph) || !Array.isArray(m.you))) return null;
    return m as ServerMsg;
  } catch { return null; }
}

// ---- snapshots -------------------------------------------------------------
const Q = 100, QS = 1000;   // positions to 1/100 unit, slide to 1/1000
const q = (v: number, k: number) => Math.round(v * k);

export function encodeSnapshot(s: Snapshot): ServerMsg {
  return {
    t: "snap", tick: s.tick, round: s.round, ph: s.phase, cd: s.countdown, left: s.left,
    hp: s.hippos.map((h) => [q(h.slide, QS), h.gulp, h.cooldown, h.sputter, h.sore, (h.flooded ? 1 : 0) | (h.dud ? 2 : 0), h.score, h.bellow]),
    dr: s.drops.map((d) => [d.id, d.kind, q(d.x, Q), q(d.y, Q)]),
    sl: s.slicks.map((k) => [k.id, q(k.x, Q), q(k.y, Q), k.life]),
    ev: s.events.map((e) => ("x" in e ? { ...e, x: q(e.x, Q), y: q(e.y, Q) } : e)),
  };
}

type Snap = Extract<ServerMsg, { t: "snap" }>;
export function decodeSnapshot(m: Snap): Snapshot {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const hippos: Hippo[] = Array.from({ length: SEATS }, (_, seat) => {
    const r = m.hp[seat] ?? [];
    return { seat, slide: num(r[0]) / QS, gulp: num(r[1]), cooldown: num(r[2]), sputter: num(r[3]), sore: num(r[4]), flooded: (num(r[5]) & 1) === 1, dud: (num(r[5]) & 2) === 2, score: num(r[6]), bellow: num(r[7]) };
  });
  return {
    tick: num(m.tick), round: num(m.round), phase: m.ph, countdown: num(m.cd), left: num(m.left), hippos,
    drops: m.dr.map((r) => ({ id: num(r[0]), kind: num(r[1]), x: num(r[2]) / Q, y: num(r[3]) / Q })),
    slicks: m.sl.map((r) => ({ id: num(r[0]), x: num(r[1]) / Q, y: num(r[2]) / Q, life: num(r[3]) })),
    events: (Array.isArray(m.ev) ? m.ev : []).map((e) => ("x" in e ? { ...e, x: num(e.x) / Q, y: num(e.y) / Q } : e)),
  };
}

export const roomCfg = (m: Extract<ServerMsg, { t: "room" }>): Cfg => ({
  secs: m.secs, difficulty: m.diff,
  bots: Array.from({ length: SEATS }, (_, i) => (DIFFICULTIES.includes(m.bd?.[i]!) ? m.bd[i]! : m.diff)),
});
