import { afterAll, beforeAll, expect, test } from "bun:test";
import type { RoomSocket } from "@rustybuns/util/room";
import { parseJson } from "@rustybuns/util/http";
import { Job, JobsReply } from "../src/api.ts";
import { LiveMsg, PROTOCOL, relay } from "../src/live.ts";
import worker, { Relay, type Env } from "../src/relay.ts";
import { api } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { deliver, tick, withPush } from "../src/ticker.ts";

// workerd's socket pair, just enough of it: what each page was sent.
class Sock implements RoomSocket {
  readyState = 1;
  sent: string[] = [];
  private att: unknown;
  send(s: string | ArrayBuffer | Uint8Array) { if (typeof s === "string") this.sent.push(s); }
  close() { this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
let last: Sock | null = null;
class FakePair { 0 = new Sock(); 1 = (last = new Sock()); }
let real: unknown;
beforeAll(() => { real = Reflect.get(globalThis, "WebSocketPair"); Reflect.set(globalThis, "WebSocketPair", FakePair); });
afterAll(() => { Reflect.set(globalThis, "WebSocketPair", real); });

// The relay Worker in front of its one Durable Object, served on a port the Bun server can POST to.
const socks: RoomSocket[] = [];
const room = new Relay({ acceptWebSocket: (s) => { socks.push(s); }, getWebSockets: () => socks }, {});
const env: Env = { TOKEN: "s3cret", RELAY: { idFromName: (n) => n, get: () => room } };
const edge = Bun.serve({ port: 0, fetch: (req) => worker.fetch(req, env) });
// ntfy: keeps every push it gets.
const pushed: { title: string; body: string }[] = [];
const ntfy = Bun.serve({ port: 0, fetch: async (req) => { pushed.push({ title: req.headers.get("title") ?? "", body: await req.text() }); return new Response("ok"); } });
afterAll(() => { edge.stop(true); ntfy.stop(true); });

const page = (token: string) => worker.fetch(new Request(`${edge.url}live`, { headers: { upgrade: "websocket", "sec-websocket-protocol": `${PROTOCOL}, ${token}` } }), env);
const heard = (s: Sock) => s.sent.map((m) => LiveMsg(parseJson(m)).t);
const word = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(/^=\?UTF-8\?B\?(.*)\?=$/.exec(s)![1]!), (c) => c.charCodeAt(0)));

test("the laptop and the phone hear every change the server makes, and a reminder reaches the phone", async () => {
  // Two devices open the page; a stranger's token is turned away.
  const laptop = await page("s3cret"), lap = last!;
  const phone = await page("s3cret"), ph = last!;
  expect([laptop.status, phone.status, laptop.headers.get("sec-websocket-protocol")]).toEqual([101, 101, PROTOCOL]);
  expect((await page("nope")).status).toBe(401);
  expect((await worker.fetch(new Request(`${edge.url}publish`, { method: "POST" }), env)).status).toBe(401);

  const store = new Store();
  const live = relay(edge.url.href, "s3cret");
  const send = withPush(deliver, `${ntfy.url}cron-swanson-test`);
  let now = Date.parse("2026-11-14T08:59:30Z");
  const call = api(store, { now: () => now, send, live: "wss://relay.test/live", changed: live.poke });
  const ask = async (method: string, path: string, body?: unknown) =>
    parseJson(await (await call(new Request(`http://cron.test${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }))).text());

  // The page learns where the relay is from the list it already fetches; reading it changes nothing.
  expect(JobsReply(await ask("GET", "/api/jobs")).live).toBe("wss://relay.test/live");
  await live.idle();
  expect(heard(lap)).toEqual([]);

  // A job made on the laptop: both pages hear it.
  const job = Job(await ask("POST", "/api/jobs", {
    app: "home", name: "Water the plants", why: "Before they wilt", tags: [], cadence: { kind: "daily", time: "09:00" }, tz: "UTC", action: { kind: "remind" },
  }));
  await live.idle();
  expect([heard(lap), heard(ph)]).toEqual([["changed"], ["changed"]]);

  // At 09:00 the reminder fires: the phone gets a push, the run says nothing went wrong.
  now = Date.parse("2026-11-14T09:00:00.250Z");
  const [run] = await tick(store, now, send);
  expect(run).toMatchObject({ jobId: job.id, status: "reminded", error: "" });
  expect(pushed.map((p) => [word(p.title), p.body])).toEqual([["home: Water the plants", "Before they wilt"]]);

  // Run by hand from the phone: the laptop hears it too.
  await ask("POST", `/api/jobs/${job.id}/run`);
  await live.idle();
  expect(heard(lap)).toEqual(["changed", "changed"]);
});

test("a push that fails is written on the run; the reminder still counts", async () => {
  const store = new Store();
  const call = api(store, { send: withPush(deliver, "http://127.0.0.1:1/nowhere") });
  const job = Job(parseJson(await (await call(new Request("http://cron.test/api/jobs", { method: "POST", body: JSON.stringify({
    app: "home", name: "Bins out", tags: [], cadence: { kind: "weekly", time: "19:00", days: [2] }, tz: "UTC", action: { kind: "remind" },
  }) }))).text()));
  const run = parseJson(await (await call(new Request(`http://cron.test/api/jobs/${job.id}/run`, { method: "POST" }))).text());
  expect(run).toMatchObject({ status: "reminded", error: expect.stringContaining("push:") });
});
