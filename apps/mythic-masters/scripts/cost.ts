// What walking together costs (#3663): six bots walk one region for a minute through the page's own net module, the
// real Worker and the real Region (scripts/party.ts), and the meter turns what they did into Cloudflare's bill.
//
//   bun scripts/cost.ts            six players, 60 s
//   bun scripts/cost.ts 4 30       four players, 30 s
//
// The bots walk like people on a hunting trip: a heading for a few seconds, a turn, and now and then a stop (a campfire,
// a look at the map) where they send nothing. Free allowances are left out, so this is the price past them.
import { Online } from "../src/net/online.ts";
import { serveParty, IDLE_MS } from "./party.ts";

/** Durable Objects on Workers Paid, as Cloudflare publishes them (developers.cloudflare.com/durable-objects/platform/pricing). */
export const RATES = {
  /** $ per million requests; an upgrade is one, and incoming WebSocket messages count 20 to a request. Outgoing ones are free. */
  request: 0.15, wsPerRequest: 20,
  /** $ per million GB-s of wall time awake; every object is billed at 128 MB. Hibernated, it costs nothing. */
  gbSecond: 12.5, gb: 0.128,
  /** $ per million Worker requests (the /ws upgrade passes through the Worker first). */
  worker: 0.3,
} as const;

export interface Usage { players: number; seconds: number; joins: number; inbound: number; outbound: number; inBytes: number; outBytes: number; awakeMs: number }

/** Dollars for one run, and per player-hour. */
export function price(u: Usage) {
  const requests = u.joins + u.inbound / RATES.wsPerRequest;
  const dollars = (requests * RATES.request + (u.awakeMs / 1000) * RATES.gb * RATES.gbSecond + u.joins * RATES.worker) / 1e6;
  return { dollars, perPlayerHour: dollars / (u.players * (u.seconds / 3600)) };
}

export async function stress(players = 6, seconds = 60, seed = 7) {
  const edge = serveParty();
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const bots = Array.from({ length: players }, (_, i) => ({
    o: new Online("STRESS", { base: edge.url, guest: { uid: `stress-bot-${i}`, name: `Bot ${i + 1}` } }),
    x: 30_000 + i * 4, z: 20_000, yaw: rnd() * 2 * Math.PI, turnIn: 0, stopFor: 0,
  }));
  const t0 = performance.now(), dt = 1 / 60;
  await new Promise<void>((done) => {
    const frame = setInterval(() => {
      const now = performance.now();
      for (const b of bots) {
        if (b.stopFor > 0) b.stopFor -= dt;
        else {
          if ((b.turnIn -= dt) <= 0) { b.yaw += (rnd() - 0.5) * 1.5; b.turnIn = 2 + rnd() * 4; if (rnd() < 0.15) b.stopFor = 3 + rnd() * 8; }
          b.x += Math.cos(b.yaw) * 9.6 * dt; b.z += Math.sin(b.yaw) * 9.6 * dt; // a walk at a fighter's pace and a bit
        }
        b.o.update(12, b.x, b.z, b.yaw, "hodag", now);
      }
      if (now - t0 >= seconds * 1000) { clearInterval(frame); done(); }
    }, 1000 / 60);
  });
  const seen = Math.min(...bots.map((b) => b.o.ghosts.size));
  for (const b of bots) b.o.close();
  await Bun.sleep(50);
  const room = edge.rooms().find((r) => r.name === "STRESS:12")!;
  edge.stop();
  // The meter stops at the last event; the object stays up IDLE_MS more before it sleeps.
  const u: Usage = { players, seconds, joins: room.m.joins, inbound: room.m.inbound, outbound: room.m.outbound, inBytes: room.m.inBytes, outBytes: room.m.outBytes, awakeMs: room.m.awakeMs + IDLE_MS };
  return { u, seen, ...price(u) };
}

if (import.meta.main) {
  const players = Number(process.argv[2]) || 6, seconds = Number(process.argv[3]) || 60;
  const { u, seen, dollars, perPlayerHour } = await stress(players, seconds);
  const perS = (n: number) => (n / u.seconds).toFixed(1);
  console.log(`${players} players walking one region for ${seconds} s (each saw ${seen} of the other ${players - 1})`);
  console.log(`  in  ${perS(u.inbound)} msg/s, ${perS(u.inBytes / players)} B/s up per player`);
  console.log(`  out ${perS(u.outbound)} msg/s, ${perS(u.outBytes / players)} B/s down per player`);
  console.log(`  awake ${(u.awakeMs / 1000).toFixed(0)} s (the ${seconds} s walk and the ${IDLE_MS / 1000} s before it sleeps), ${u.joins} joins`);
  console.log(`  $${dollars.toFixed(6)} this run, $${perPlayerHour.toFixed(5)} per player-hour (target under $0.005)`);
}
