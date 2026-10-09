// Evicts a room mid-round and watches the players come back. Two players join
// a fresh room through the game's own NetSocket (its backoff reconnects, not a
// copy), start a round, and then the room's Durable Object is killed: by the
// command you pass, or by you (redeploy, restart `wrangler dev`) when it says so.
// It passes when both sockets reconnect, each player gets back the seat they
// held, and the round restarts from its countdown (Match.restore: proof the
// object really was rebuilt from storage, not just a dropped socket) and plays.
//   bun scripts/smoke-evict.ts http://127.0.0.1:8787
//   bun scripts/smoke-evict.ts https://hippo-tycoon.example.workers.dev --evict "bunx wrangler deploy --minify" --wait 1200
// A deploy only evicts when the code changed (a new var is not enough), and it
// reaches each object eventually, not at once: give it --wait (seconds, default 300).
import { NetSocket, type NetState } from "../src/client/net.ts";
import type { ServerMsg } from "../src/engine/wire.ts";

const args = process.argv.slice(2);
const flag = args.indexOf("--evict");
const evictCmd = flag >= 0 ? args.splice(flag, 2)[1] : undefined;
const wf = args.indexOf("--wait");
/** How long to wait for the drop. A deploy reaches each object eventually, not at once. */
const waitS = wf >= 0 ? Number(args.splice(wf, 2)[1]) : 300;
const base = (args[0] ?? "http://127.0.0.1:8787").replace(/\/$/, "").replace(/^http/, "ws");
const room = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

(globalThis as any).window ??= { addEventListener() {}, removeEventListener() {} };   // NetSocket listens for pagehide

class Player {
  msgs: ServerMsg[] = [];
  states: NetState[] = [];
  net: NetSocket;
  constructor(readonly uid: string, readonly name: string) {
    this.net = new NetSocket(() => new WebSocket(`${base}/ws?room=${room}&uid=${uid}&name=${name}`), {
      onMessage: (m) => this.msgs.push(m),
      onState: (s, why) => { if (s !== this.states.at(-1)) console.log(`${at()}  ${name} ${s}${why ? `: ${why}` : ""}`); this.states.push(s); },
      onPing: () => {},
      onOpen: () => {},
    });
  }
  of<T extends ServerMsg["t"]>(t: T) { return this.msgs.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
  room() { return this.of("room").at(-1); }
}
const until = async (what: string, f: () => unknown, ms = 10000) => {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) { console.error(`FAIL: timed out waiting for ${what}`); process.exit(1); } await Bun.sleep(25); }
  console.log(`${at()}  ok   ${what}`);
};

console.log(`room ${room} on ${base}`);
const a = new Player(`evict-${room}-aaaa`, "Ada");
await until("Ada seated", () => a.of("hello")[0]?.you === 0);
const b = new Player(`evict-${room}-bbbb`, "Bo");
await until("Bo seated", () => b.of("hello")[0]?.you === 1);
a.net.send({ t: "cfg", secs: 90 });
a.net.send({ t: "start" });
await until("round playing", () => a.room()?.ph === "playing", 12000);
await Bun.sleep(1500);
const before = { a: a.msgs.length, b: b.msgs.length, helloA: a.of("hello").length, helloB: b.of("hello").length };

if (evictCmd) {
  console.log(`${at()}  evicting: ${evictCmd}`);
  const p = Bun.spawn(["sh", "-c", evictCmd], { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) { console.error("FAIL: the evict command failed"); process.exit(1); }
} else {
  console.log(`${at()}  EVICT NOW: redeploy the Worker or restart \`wrangler dev\`. Waiting up to ${waitS} s.`);
}

await until("both sockets dropped", () => a.states.includes("offline") && b.states.includes("offline"), waitS * 1000);
await until("both reconnected and said hello again", () => a.of("hello").length > before.helloA && b.of("hello").length > before.helloB, 120_000);
const ha = a.of("hello").at(-1)!, hb = b.of("hello").at(-1)!;
if (ha.you !== 0 || hb.you !== 1) { console.error(`FAIL: seats not given back (Ada ${ha.you}, Bo ${hb.you})`); process.exit(1); }
console.log(`${at()}  ok   seats given back (Ada 0, Bo 1)`);
const after = () => a.msgs.slice(before.a).filter((m) => m.t === "room") as Extract<ServerMsg, { t: "room" }>[];
await until("round restarted from its countdown (restored from storage)", () => after().some((m) => m.ph === "countdown"), 10000);
await until("both seats human again", () => a.room()?.seats.filter((s) => s.h).length === 2);
await until("round playing again", () => a.room()?.ph === "playing", 12000);
const n0 = a.of("snap").length;
await Bun.sleep(1500);
const rate = (a.of("snap").length - n0) / 1.5;
console.log(`${at()}       snapshots ${rate.toFixed(1)}/s`);
if (rate < 8 || rate > 20) { console.error("FAIL: expected about 15 snapshots a second"); process.exit(1); }
b.net.send({ t: "in", m: 100, g: 0, h: 0 });
await until("input crosses after the restore (Bo slid right)", () => (a.of("snap").at(-1)?.hp[1]?.[0] ?? 0) > 0);
a.net.close(); b.net.close();
console.log("PASS");
process.exit(0);
