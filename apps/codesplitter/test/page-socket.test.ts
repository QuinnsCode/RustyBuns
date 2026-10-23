import { expect, test } from "bun:test";
import { liveSocket, netBanner, type Net } from "../src/page-socket.ts";

const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(10); expect(ok()).toBe(true); };

// A deploy restarts the file's Durable Object: the socket drops, and the server is back a moment later with the same data.
test("a page's socket rides out a restart: banner up, then down, resynced, a waiting edit sent", async () => {
  let rev = 1;
  const serve = (port = 0) => Bun.serve<undefined>({
    port,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no", { status: 400 })),
    websocket: { open: (ws) => { ws.send(JSON.stringify({ type: "hello", rev })); }, message: (ws, m) => { ws.send(String(m)); } },
  });
  let server = serve();
  const port = server.port;

  const nets: Net[] = [], got: string[] = [], resyncs: number[] = [], sent: string[] = [];
  let drops = 0, at = 1_000_000;
  const live = liveSocket({
    open: () => new WebSocket(`ws://127.0.0.1:${port}/`),
    onMessage: (d) => got.push(String(d)),
    onNet: (n) => nets.push(n),
    onDrop: () => drops++,
    resync: () => { resyncs.push(rev); },
    now: () => at,
    delay: () => 20,
  });
  await until(() => live.state === "online");
  await until(() => got.length === 1);
  expect(nets.at(-1)).toEqual({ kind: "ok" });
  expect(netBanner(nets.at(-1)!)).toBeNull();

  expect(live.send("ping")).toBe(true);
  await until(() => got.includes("ping"));

  // The deploy: every socket drops, and an edit made meanwhile waits for the file to be back.
  await server.stop(true);
  await until(() => live.state === "reconnecting");
  expect(drops).toBe(1);
  expect(netBanner(nets.at(-1)!)).toEqual({ icon: "refresh-cw", text: "Updating, back in a moment" });
  expect(live.send("lost")).toBe(false);
  live.later(() => { sent.push(`edit@${resyncs.length}`); });
  rev = 2;
  server = serve(port);
  await until(() => live.state === "online");
  await until(() => sent.length === 1);
  // Resynced from the new rev first, then the waiting edit went.
  expect(resyncs).toEqual([2]);
  expect(sent).toEqual(["edit@1"]);
  expect(nets.at(-1)).toEqual({ kind: "ok" });
  expect(got.filter((g) => g.includes("hello")).length).toBe(2);

  live.close();
  await server.stop(true);
});

test("deploy-soon counts down without reaching the page, and draining is remembered till the socket is back", async () => {
  let ws0: { send(s: string): void } | null = null;
  const server = Bun.serve<undefined>({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no", { status: 400 })),
    websocket: { open: (ws) => { ws0 = ws; }, message() {} },
  });
  const nets: Net[] = [], got: string[] = [];
  let at = 5_000;
  const live = liveSocket({ open: () => new WebSocket(`ws://127.0.0.1:${server.port}/`), onMessage: (d) => got.push(String(d)), onNet: (n) => nets.push(n), now: () => at });
  await until(() => live.state === "online" && ws0 !== null);
  ws0!.send(JSON.stringify({ t: "deploy-soon", at: 5_000 + 12_000 }));
  await until(() => nets.at(-1)?.kind === "deploy");
  expect(nets.at(-1)).toEqual({ kind: "deploy", secs: 12 });
  expect(netBanner(nets.at(-1)!)).toEqual({ icon: "timer", text: "Update coming in 12 s, finish your edit" });
  at += 4_000;
  await until(() => (nets.at(-1) as { secs: number }).secs === 8);
  ws0!.send(JSON.stringify({ t: "draining" }));
  await until(() => live.draining);
  ws0!.send(JSON.stringify({ type: "ops" }));
  await until(() => got.length === 1);
  expect(got).toEqual([JSON.stringify({ type: "ops" })]);
  // The deploy is called off: the hold clears and the banner goes.
  ws0!.send(JSON.stringify({ t: "drain-over" }));
  await until(() => !live.draining && nets.at(-1)?.kind === "ok");
  live.close();
  await server.stop(true);
});

test("offline after the tries run out", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port;
  await server.stop(true);
  const nets: Net[] = [];
  const live = liveSocket({ open: () => new WebSocket(`ws://127.0.0.1:${port}/`), onMessage() {}, onNet: (n) => nets.push(n), delay: () => 5 });
  await until(() => nets.some((n) => n.kind === "offline"));
  expect(netBanner({ kind: "offline" })).toEqual({ icon: "cloud-off", text: "Offline" });
  live.close();
});
