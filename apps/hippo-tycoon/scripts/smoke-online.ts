// Plays a short online round against a running Hippo Tycoon edge: `wrangler dev`,
// `rustybuns dev`, or the deployed site. It joins two players to a fresh room,
// starts a round, and checks snapshots tick, input crosses, and a leaver hands
// their seat to a bot. Exit code 0 = healthy.
//   bun scripts/smoke-online.ts http://127.0.0.1:8799
import { PROTO_VERSION, type ServerMsg } from "../src/engine/wire.ts";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "").replace(/^http/, "ws");
const room = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

class Player {
  msgs: ServerMsg[] = [];
  closed: number | null = null;
  ws: WebSocket;
  constructor(readonly uid: string, readonly name: string) {
    this.ws = new WebSocket(`${base}/ws?room=${room}&uid=${uid}&name=${name}`);
    this.ws.onopen = () => this.send({ t: "hello", v: PROTO_VERSION });
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(String(e.data)));
    this.ws.onclose = (e) => { this.closed = e.code; };
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  of<T extends ServerMsg["t"]>(t: T) { return this.msgs.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
}
const until = async (what: string, f: () => unknown, ms = 10000) => {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) { console.error(`FAIL: timed out waiting for ${what}`); process.exit(1); } await Bun.sleep(25); }
  console.log(`ok   ${what}`);
};

console.log(`room ${room} on ${base}`);
const a = new Player(`smoke-${room}-aaaa`, "Ada");
await until("Ada seated, and host", () => a.of("hello")[0]?.you === 0);
const b = new Player(`smoke-${room}-bbbb`, "Bo");           // after Ada: the first human steers the room
await until("both players seated", () => b.of("hello").length && a.of("room").at(-1)?.seats.filter((s) => s.h).length === 2);
a.send({ t: "cfg", secs: 30 });
a.send({ t: "start" });
await until("countdown then playing", () => a.of("room").at(-1)?.ph === "playing", 12000);
const n0 = a.of("snap").length;
b.send({ t: "in", m: 100, g: 1, h: 0 });
await Bun.sleep(1500);
const rate = (a.of("snap").length - n0) / 1.5;
console.log(`     snapshots ${rate.toFixed(1)}/s`);
if (rate < 8 || rate > 20) { console.error("FAIL: expected about 15 snapshots a second"); process.exit(1); }
await until("input crossed (Bo slid right)", () => (a.of("snap").at(-1)?.hp[1]?.[0] ?? 0) > 0);
await until("drops are dripping", () => (a.of("snap").at(-1)?.dr.length ?? 0) > 0);
b.ws.close();
await until("Bo leaves, a bot takes the seat", () => a.of("room").at(-1)?.seats.filter((s) => s.h).length === 1);
a.ws.close();
console.log("PASS");
process.exit(0);
