// Measures the two numbers the Scale tab (src/scale.ts) prices servers and Durable Objects from (#3890): socket work
// one vCPU keeps up with a second (`perCore`), and the ms a room's handler spends on one message (`ms`).
// A relay room on `Sockets` (@rustybuns/util/room), the way the games write one, runs in a child process under the
// Bun shell (the same DO class code a Hetzner box would run); this process opens rooms of 4 players sending 20
// inputs a second, steps the room count up, and reads the child's CPU time against the messages it relayed.
//   bun apps/eqosys/scripts/room-stress.ts [rooms,rooms,...] [seconds]
import { durableObject, serve } from "@rustybuns/shell-bun";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { num, obj, check } from "@rustybuns/util/guard";

const ROOM = 4, RATE = 20;

if (process.argv[2] === "serve") {
  let msgs = 0, handlerMs = 0;
  class Relay {
    private s: Sockets<{ seat: number }>;
    constructor(ctx: RoomCtx) { this.s = new Sockets(ctx, { maxBytes: 1024, rate: 30, burst: 30 }); }
    fetch(req: Request) { return this.s.upgrade({ seat: Number(new URL(req.url).searchParams.get("seat")) }).response; }
    webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
      const t = performance.now();
      const f = this.s.frame(ws, raw);
      if (f) this.s.broadcast(f.value, ws);
      handlerMs += performance.now() - t;
      msgs++;
    }
  }
  const env = { ROOM: durableObject(Relay, {}) };
  const shell = serve({ port: 0, hostname: "127.0.0.1" });
  shell.mount({
    fetch(req, e: typeof env) {
      const u = new URL(req.url);
      if (u.pathname === "/stats") { const c = process.cpuUsage(); return Response.json({ cpuMs: (c.user + c.system) / 1000, msgs, handlerMs }); }
      return e.ROOM.getByName(u.searchParams.get("room") ?? "a").fetch(req);
    },
  }, env);
  console.log(shell.url);
} else {
  const levels = (process.argv[2] ?? "25,100,250").split(",").map(Number), secs = Number(process.argv[3] ?? 6);
  const child = Bun.spawn(["bun", import.meta.path, "serve"], { stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const url = new TextDecoder().decode((await reader.read()).value).trim();
  const n = num(0, Number.MAX_SAFE_INTEGER), Stats = obj({ cpuMs: n, msgs: n, handlerMs: n });
  const stats = async () => {
    const v = check(Stats, await (await fetch(`${url}/stats`)).json());
    if (!v) throw new Error("the room process answered /stats with something else");
    return v;
  };
  const pad = "x".repeat(60);
  const socks: WebSocket[] = [];
  let got = 0, timers: ReturnType<typeof setInterval>[] = [];
  const ws = url.replace(/^http/, "ws");

  console.log(`rooms of ${ROOM}, ${RATE} inputs a second each, ${secs} s a step; the room runs in its own process`);
  console.log("rooms  sockets  msgs/s in  sends/s  server cores  perCore (msg x room / core-s)  handler ms/msg  delivered");
  for (const rooms of levels) {
    while (socks.length < rooms * ROOM) {
      const i = socks.length, s = new WebSocket(`${ws}/?room=r${Math.floor(i / ROOM)}&seat=${i % ROOM}`);
      s.onmessage = () => { got++; };
      await new Promise((r) => { s.onopen = r; });
      socks.push(s);
      let seq = 0;
      timers.push(setInterval(() => s.send(JSON.stringify({ t: "in", seq: seq++, x: Math.random(), y: Math.random(), pad })), 1000 / RATE));
    }
    await Bun.sleep(1000); // let the new sockets settle
    const a = await stats(), g0 = got, t0 = performance.now();
    await Bun.sleep(secs * 1000);
    const b = await stats(), wall = (performance.now() - t0) / 1000;
    const msgs = (b.msgs - a.msgs) / wall, cores = (b.cpuMs - a.cpuMs) / 1000 / wall;
    const sends = msgs * (ROOM - 1), delivered = (got - g0) / wall / sends;
    console.log([rooms, socks.length, Math.round(msgs), Math.round(sends), cores.toFixed(2), Math.round((msgs * ROOM) / cores),
      ((b.handlerMs - a.handlerMs) / (b.msgs - a.msgs)).toFixed(3), `${Math.round(delivered * 100)}%`].join("  "));
  }
  for (const t of timers) clearInterval(t);
  for (const s of socks) s.close();
  child.kill();
}
