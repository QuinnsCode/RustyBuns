import { afterEach, expect, test } from "bun:test";
import { engineKey, forgetLease, seal, unseal } from "../src/index.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const conf = { ARTSTEW_URL: "https://stew.example", license: "buddy" };
const answer = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as never;
afterEach(forgetLease);

test("the sealed engine opens with the key and not without it", async () => {
  const wasm = new Uint8Array(await new Blob([crypto.getRandomValues(new Uint8Array(4096))]).arrayBuffer());
  const sealed = await seal(wasm, KEY);
  expect(Buffer.from(sealed).includes(Buffer.from(wasm.slice(0, 16)))).toBe(false);
  expect(Buffer.compare(Buffer.from(await unseal(sealed, KEY)), Buffer.from(wasm))).toBe(0);
  await expect(unseal(sealed, btoa(String.fromCharCode(...new Uint8Array(32).fill(8))))).rejects.toThrow();
});

test("paid gets the key; revoked is locked at once; an outage rides the last lease", async () => {
  const paid = answer(200, { ok: true, key: KEY, seconds: 60 });
  const t0 = 1_000_000;
  expect(await engineKey(conf, paid, t0)).toBe(KEY);
  const down = (async () => { throw new Error("offline"); }) as never;
  expect(await engineKey(conf, down, t0 + 3_600_000)).toBe(KEY); // lease over, artstewengine down: grace
  expect(await engineKey(conf, down, t0 + 3 * 86_400_000)).toBeNull(); // grace over
  expect(await engineKey(conf, answer(402, { ok: false }), t0 + 3_600_000)).toBeNull();
  expect(await engineKey(conf, down, t0 + 3_700_000)).toBeNull(); // revoked: no riding the old lease
  expect(await engineKey({}, paid)).toBeNull(); // no license set
});
