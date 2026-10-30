// The Room for the iOS app's offline mode. scripts/offline.ts packs this file into one script that Swift runs in
// JavaScriptCore: the same Hunt and bots the page and the world run, answering to three calls instead of a socket.
// Only the zones bundled with the game (Yosemite and Yellowstone) are here, and the weather is whatever the
// lobby's time of day says, so nothing is fetched.

import { parseMsg, type BotLevel, type Look } from "./hunt/game.ts";
import { Room } from "./room.ts";
import { zoneNow } from "./edge/zone.ts";

const ME = "you";
let room: Room | null = null;

export interface Opts { name?: string; look?: Look; bots?: number; level?: BotLevel; zone?: string; tod?: "day" | "dusk" | "night" }

const view = (now: number) => JSON.stringify({ t: "view", view: room!.game.view(ME, now) });

/** A new game with you as host and `bots` AI players. Answers with your first view. */
function create(seed: number, opts: Opts, now: number): string {
  const r = (room = new Room(seed));
  r.game.join(ME, opts.name ?? "Camper", now, { host: true, look: opts.look });
  r.handle(ME, { t: "settings", zone: opts.zone, tod: opts.tod ?? "day", live: false }, now);
  for (let i = 0; i < (opts.bots ?? 3); i++) r.handle(ME, { t: "bot", level: opts.level ?? "normal" }, now);
  return view(now);
}

/** A message from the app, as it would arrive on the socket. Unreadable ones are dropped. */
function handle(json: string, now: number): void {
  let raw: unknown = null;
  try { raw = JSON.parse(json); } catch { /* not ours */ }
  const m = parseMsg(raw);
  if (m && room) room.handle(ME, m, now);
}

/** Steps the game to `now` and answers with your view. */
function tick(now: number): string {
  room!.tick(now);
  return view(now);
}

/** The ground of a bundled zone, as GET /api/zone sends it. */
const zone = (id: string): string | null => { const z = zoneNow(id); return z && JSON.stringify(z); };

(globalThis as { PhsRoom?: unknown }).PhsRoom = { create, handle, tick, zone };
