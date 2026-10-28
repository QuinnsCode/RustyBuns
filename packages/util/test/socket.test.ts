import { expect, test } from "bun:test";
import { connectSocket } from "../src/socket.ts";

type Msg = { t: "echo"; m: string } | { t: "hi" };
const decode = (v: unknown): Msg | null => {
  if (typeof v !== "object" || v === null || !("t" in v)) return null;
  if (v.t === "hi") return { t: "hi" };
  return v.t === "echo" && "m" in v && typeof v.m === "string" ? { t: "echo", m: v.m } : null;
};
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(5); expect(ok()).toBe(true); };

// A world that says hi, echoes text, and closes a socket when told to.
function world() {
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws only", { status: 400 })),
    websocket: {
      open(ws) { ws.send(JSON.stringify({ t: "hi" })); },
      message(ws, m) {
        if (m === "bye") ws.close(4001, "replaced");
        else if (m === "junk") ws.send("{not json");
        else if (m === "nope") ws.send(JSON.stringify({ t: "nope" }));
        else ws.send(JSON.stringify({ t: "echo", m: String(m) }));
      },
    },
  });
  return { url: `ws://localhost:${server.port}/ws`, stop: () => server.stop(true) };
}

test("a link: what was sent before it opened goes on open; frames come through the decoder; a close can be retried", async () => {
  const w = world();
  const got: Msg[] = [], closes: { code: number; seen: boolean; tries: number }[] = [], opens: number[] = [];
  const link = connectSocket<Msg, string>(w.url, {
    decode, queue: 1, encode: (m) => m,
    onMessage: (m) => got.push(m),
    onOpen: (tries) => opens.push(tries),
    onClose: (e) => { closes.push({ code: e.code, seen: e.seen, tries: e.tries }); return e.code === 4001 ? 10 : null; },
  });
  expect(link.open).toBe(false);
  expect(link.send("early")).toBe(true);     // queued
  expect(link.send("dropped")).toBe(false);  // the queue holds one
  await until(() => got.length === 2);
  expect(got).toEqual([{ t: "hi" }, { t: "echo", m: "early" }]);
  expect(link.open).toBe(true);
  link.send("junk");                          // the world answers with something that isn't JSON: dropped on the way in
  link.send("nope");                          // and with JSON the decoder refuses: dropped too
  link.send("bye");                           // the world closes us with 4001: one retry
  await until(() => opens.length === 2);
  expect(closes).toEqual([{ code: 4001, seen: true, tries: 1 }]);
  expect(opens).toEqual([0, 1]);
  await until(() => got.length === 3);        // the new socket's hi, and nothing from the two bad frames
  expect(got[2]).toEqual({ t: "hi" });
  link.close();
  expect(link.open).toBe(false);
  expect(link.send("after")).toBe(false);
  await Bun.sleep(20);
  expect(closes.length).toBe(1);              // our own close is not reported
  w.stop();
});

test("no world behind the address: the close is reported with nothing seen, and no retry stays closed", async () => {
  const closes: number[] = [];
  const link = connectSocket<Msg, string>("ws://localhost:1/ws", { decode, onMessage: () => {}, onClose: (e) => { closes.push(e.tries); expect(e.seen).toBe(false); } });
  await until(() => closes.length === 1);
  await Bun.sleep(30);
  expect(closes).toEqual([1]);
  link.close();
});
