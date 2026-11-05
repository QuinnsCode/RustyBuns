// What walking together costs (#3663): runs the stress script (a full party walking one region, scripts/stress.ts),
// counts what Cloudflare bills a Durable Object for, and prices it from the published Workers Paid rates. Target:
// under $0.005 a player-hour at a full party, printed in every round's comment. The free allowances (a million
// requests, 400,000 GB-s a month) are left out, so this is the price past them.
//   bun scripts/cost.ts [--seconds 60] [--bots 6]
import { stress } from "./stress.ts";

/** https://developers.cloudflare.com/durable-objects/platform/pricing/ (read 2026-11-05) and Workers' own request price. */
export const RATES = {
  /** $ a million Durable Object requests; incoming WebSocket messages count WS_RATIO to one, outgoing ones are free. */
  request: 0.15, wsRatio: 20,
  /** $ a million GB-s of duration, billed on the whole 128 MB of an object while a handler runs (not while hibernating). */
  gbSecond: 12.5, gb: 0.128,
  /** $ a million SQLite rows written, read. */
  rowWritten: 1.0, rowRead: 0.001,
  /** $ a million Worker requests: the one that opens each socket. */
  workerRequest: 0.3,
};
export const TARGET = 0.005;

/** What a run counted. */
export interface Run {
  seconds: number; players: number; rooms: number;
  /** Sockets opened (a Worker request and a room request each). */
  joins: number;
  messagesIn: number;
  /** Seconds the rooms were billed as awake. */
  wakeSeconds: number;
  /** Storage reads and writes, each priced as a row written. */
  storageOps: number;
}

/** The price of a run, scaled to an hour of the same play. Joins are a trip's, once an hour. */
export function priceOf(r: Run) {
  const hour = 3600 / r.seconds, M = 1e6;
  const parts = {
    messages: (r.messagesIn * hour / RATES.wsRatio) * RATES.request / M,
    duration: r.wakeSeconds * hour * RATES.gb * RATES.gbSecond / M,
    storage: r.storageOps * hour * RATES.rowWritten / M,
    joins: r.joins * (RATES.request + RATES.workerRequest) / M,
  };
  const total = parts.messages + parts.duration + parts.storage + parts.joins;
  return { parts, perRoomHour: total / Math.max(1, r.rooms), perPlayerHour: total / r.players };
}

const $ = (n: number) => `$${n.toFixed(6)}`;
export function report(r: Run & { frameUs: number; bytesDown: number; bytesUp: number; perSecondIn: number; perSecondOut: number }): string {
  const p = priceOf(r), never = priceOf({ ...r, wakeSeconds: r.seconds * r.rooms });
  return [
    `${r.players} walkers, ${r.seconds.toFixed(0)} s, ${r.rooms} room${r.rooms === 1 ? "" : "s"}`,
    `messages: ${r.perSecondIn.toFixed(1)}/s into the room, ${r.perSecondOut.toFixed(1)}/s out to the walkers (free)`,
    `per player: ${r.bytesUp.toFixed(0)} B/s up, ${r.bytesDown.toFixed(0)} B/s down; the party costs a page ${r.frameUs.toFixed(1)} µs a frame`,
    `room billed awake ${r.wakeSeconds.toFixed(2)} of ${r.seconds.toFixed(0)} s, storage ops ${r.storageOps}`,
    `an hour: messages ${$(p.parts.messages)}, duration ${$(p.parts.duration)}, storage ${$(p.parts.storage)}, joins ${$(p.parts.joins)}`,
    `price: ${$(p.perPlayerHour)} a player-hour (${$(p.perRoomHour)} a room-hour); a room that never slept: ${$(never.perPlayerHour)}; target under $${TARGET} ${p.perPlayerHour < TARGET ? "(met)" : "(MISSED)"}`,
  ].join("\n");
}

if (import.meta.main) {
  const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) || d : d; };
  const r = await stress({ seconds: arg("seconds", 60), bots: arg("bots", 6) });
  console.log(report(r));
  if (priceOf(r).perPlayerHour >= TARGET) process.exitCode = 1;
}
