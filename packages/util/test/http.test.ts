import { expect, test } from "bun:test";
import { arr, int, obj, str, type Of } from "../src/guard.ts";
import { getJson, json, parseJson, privateJson, readBody, readJson } from "../src/http.ts";
import { b64url, hex, sha256 } from "../src/bytes.ts";

// One wire shape, used by a server to answer and by a page to read, the way the apps do.
const Owned = obj({ owned: arr(str(64), 10) });
type Owned = Of<typeof Owned>;

test("a server's json reply reads back typed through the same guard", async () => {
  const res = json({ owned: ["deck:gold"] } satisfies Owned);
  expect([res.status, res.headers.get("content-type")]).toEqual([200, "application/json; charset=utf-8"]);
  expect(await readJson(res, Owned)).toEqual({ owned: ["deck:gold"] });
  expect(privateJson({}, 201, { "x-extra": "1" }).headers.get("cache-control")).toBe("no-store");
  expect(privateJson({}, 201, { "x-extra": "1" }).headers.get("x-extra")).toBe("1");
});

test.each([
  ["a 500", new Response("boom", { status: 500 })],
  ["not JSON", new Response("<html>", { status: 200 })],
  ["the wrong shape", json({ owned: "deck:gold" })],
])("a reply that is %s reads as null", async (_, res) => {
  expect(await readJson(res, Owned)).toBeNull();
});

test("getJson swallows a network error and a request body reads through a guard too", async () => {
  expect(await getJson("http://127.0.0.1:1/api/owned", Owned)).toBeNull(); // nothing listens on port 1
  const Vote = obj({ code: str(4), n: int(0, 9) });
  expect(await readJson(new Request("https://x", { method: "POST", body: JSON.stringify({ code: "ZION", n: 3, junk: 1 }) }), Vote)).toEqual({ code: "ZION", n: 3 });
  expect(await readJson(new Request("https://x", { method: "POST", body: "{" }), Vote)).toBeNull();
});

test("readBody hands back the fields unchecked, and nothing for a bad or non-object body", async () => {
  const post = (body: string) => new Request("https://x", { method: "POST", body });
  expect((await readBody<"owner">(post(JSON.stringify({ owner: "me", extra: 1 })))).owner).toBe("me");
  expect(await readBody<"owner">(post("[1]"))).toEqual({});
  expect(await readBody<"owner">(post("nope"))).toEqual({});
  expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  expect(parseJson("{")).toBeUndefined();
  expect(parseJson(null)).toBeUndefined();
});

test("bytes: hex, url-safe base64 and sha256 give the known answers", async () => {
  const bytes = new Uint8Array([0, 15, 255, 62, 63]);
  expect(hex(bytes)).toBe("000fff3e3f");
  expect(b64url(bytes)).toBe("AA__Pj8");
  expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
