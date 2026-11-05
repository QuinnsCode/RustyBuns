// A full party walking one region for a minute (#3663): six bots, each a page's own client (src/net/together.ts)
// ticked at 60 frames a second, walking laps round a meadow, against the real Worker and room in this process
// (test/app-kit.ts). Prints what the room was sent and sent back, bytes a second per player each way, how long the
// room was awake, what the page spends a frame on the party, and the price (scripts/cost.ts).
//   bun scripts/stress.ts [--seconds 60] [--bots 6]
import { local } from "../test/app-kit.ts";
import { MAX_PARTY } from "../src/net/wire.ts";
import { report, type Run } from "./cost.ts";

/** A hibernating room is billed only while a handler runs (Cloudflare's pricing page: "duration charges stop once
 * event handlers finish"). Handlers here take microseconds; each is billed as at least this long, to stay on the safe side. */
export const HANDLER_FLOOR_MS = 1;

/** Seconds the room was billed as awake: every handler, at least HANDLER_FLOOR_MS each. */
export const wakeSeconds = (handlerMs: readonly number[]) => handlerMs.reduce((s, ms) => s + Math.max(ms, HANDLER_FLOOR_MS), 0) / 1000;

export async function stress({ seconds = 60, bots = MAX_PARTY } = {}): Promise<Run & { frameUs: number; bytesDown: number; bytesUp: number; perSecondIn: number; perSecondOut: number }> {
  const app = await local();
  const leads = ["hodag", "squonk", "jackalope", "wampus-cat", "mothman", "jersey-devil"];
  const walkers = await Promise.all(Array.from({ length: bots }, (_, i) =>
    app.walker(`Bot${i + 1}`, "STRESS", { x: 3000 + i * 4, z: 2000, yaw: 0, region: 1 }, leads[i % leads.length])));
  const t0 = performance.now(), start = Date.now();
  let frames = 0, spent = 0;
  await new Promise<void>((done) => {
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) { clearInterval(timer); done(); return; }
      walkers.forEach((w, i) => {
        // a lap of 30 m at a walk (8 m/s), each bot a little behind the last; one of them stops now and then to look round
        const a = t * (8 / 30) - i * 0.4, resting = i === bots - 1 && Math.floor(t / 7) % 2 === 1;
        if (!resting) { w.at.x = 3000 + Math.cos(a) * 30; w.at.z = 2000 + Math.sin(a) * 30; w.at.yaw = a + Math.PI / 2; }
        const c0 = performance.now();
        w.t.tick(); w.t.friends();
        spent += performance.now() - c0;
      });
      frames++;
    }, 1000 / 60);
  });
  const end = Date.now(), took = (end - start) / 1000;
  const got = walkers.reduce((s, w) => s + w.t.state().got, 0), down = walkers.reduce((s, w) => s + w.t.state().bytesIn, 0);
  const up = walkers.reduce((s, w) => s + w.t.state().bytesOut, 0);
  for (const w of walkers) w.t.close();
  await app.stop();
  return {
    seconds: took, players: bots, rooms: app.billed.rooms, joins: bots,
    messagesIn: app.billed.messages, wakeSeconds: wakeSeconds(app.billed.handlerMs), storageOps: app.billed.storage,
    perSecondIn: app.billed.messages / took, perSecondOut: got / took,
    bytesUp: up / took / bots, bytesDown: down / took / bots,
    frameUs: (spent / Math.max(1, frames * bots)) * 1000,
  };
}

if (import.meta.main) {
  const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) || d : d; };
  console.log(report(await stress({ seconds: arg("seconds", 60), bots: arg("bots", MAX_PARTY) })));
}
