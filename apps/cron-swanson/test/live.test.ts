import { afterAll, expect, test } from "bun:test";
import { b64url } from "@rustybuns/util/bytes";
import { parseJson } from "@rustybuns/util/http";
import { Job, Live } from "../src/api.ts";
import { PROTOCOL, serve } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { delivery, tick } from "../src/ticker.ts";

// A stand-in ntfy server: keeps every publish, and refuses the topic "full".
const pings: { path: string; auth: string | null; body: unknown }[] = [];
const ntfy = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const body = parseJson(await req.text());
    pings.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body });
    return new Response("{}", { status: JSON.stringify(body).includes('"topic":"full"') ? 429 : 200 });
  },
});
const store = new Store();
const ring = delivery({ url: `${ntfy.url}swanson-alarms`, token: "tk" });
const server = serve(store, { token: "s3cret", send: ring });
afterAll(() => { server.stop(true); ntfy.stop(true); });

const bearer = (t: string) => `bearer.${b64url(new TextEncoder().encode(t))}`;

/** A page on one device: its socket, and every message it got. */
async function device(token: string) {
  const ws = new WebSocket(`${server.url.href.replace("http", "ws")}api/live`, [PROTOCOL, bearer(token)]);
  const got: Live[] = [];
  ws.onmessage = (e) => got.push(Live(parseJson(String(e.data))));
  const opened = await new Promise<boolean>((done) => { ws.onopen = () => done(true); ws.onerror = () => done(false); });
  return { ws, got, opened };
}
const until = async (what: string, ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(20);
  if (!ok()) throw new Error(`waited for ${what}`);
};

test("the laptop and the phone see a new job and its run as they happen, and the reminder pings the phone", async () => {
  const laptop = await device("s3cret"), phone = await device("s3cret");
  expect([laptop.opened, phone.opened, laptop.ws.protocol]).toEqual([true, true, PROTOCOL]);
  expect((await device("wrong")).opened).toBe(false);

  // Made on the laptop: both pages hear of it once.
  const res = await fetch(`${server.url}api/jobs`, {
    method: "POST", headers: { authorization: "Bearer s3cret" },
    body: JSON.stringify({ app: "home", name: "Take the bins out ☺", why: "Collection is at 7", tags: ["chores"], cadence: { kind: "daily", time: "19:00" }, tz: "UTC", action: { kind: "remind" } }),
  });
  const job = Job(parseJson(await res.text()));
  expect(job.action).toEqual({ kind: "remind", ping: true });
  await until("both pages to hear of the new job", () => laptop.got.length === 1 && phone.got.length === 1);

  // Its minute: the run is logged, the phone's ntfy gets the reminder, and one message reaches each page for the lot.
  const [run] = await tick(store, job.nextAt!, ring);
  expect(run).toMatchObject({ status: "reminded", code: 200 });
  expect(pings).toEqual([{ path: "/", auth: "Bearer tk", body: expect.objectContaining({ topic: "swanson-alarms", title: "home: Take the bins out ☺", message: "Collection is at 7" }) }]);
  await until("both pages to hear of the run", () => laptop.got.length === 2 && phone.got.length === 2);
  await Bun.sleep(100);
  expect(phone.got.length).toBe(2);

  // A reminder with its ping off stays in the feed; one ntfy refuses shows up as a failed run that says why.
  const send = delivery({ url: `${ntfy.url}full` });
  expect(await send({ ...job, action: { kind: "remind", ping: false } }, 0, 0)).toMatchObject({ status: "reminded", code: null });
  expect(await send(job, 0, 0)).toMatchObject({ status: "failed", code: 429, error: expect.stringContaining("phone ping") });

  laptop.ws.close(); phone.ws.close();
});
