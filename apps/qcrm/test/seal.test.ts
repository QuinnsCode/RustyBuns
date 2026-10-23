import { expect, test } from "bun:test";
import { local } from "./app-kit.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const conf = { ARTSTEW_URL: "https://stew.example", QCRM_LICENSE: "buddy" };

test("GET /api/engine/key is 402 until the license is paid", async () => {
  const c = await local();
  expect((await c("", "/api/engine/key")).status).toBe(402);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, key: KEY, seconds: 60 }))) as never;
  try {
    Object.assign(c.env, conf);
    expect(await (await c("", "/api/engine/key")).json()).toEqual({ key: KEY });
  } finally { globalThis.fetch = realFetch; c.close(); }
});
