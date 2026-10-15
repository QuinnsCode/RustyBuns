import { expect, test } from "bun:test";
import { readBody } from "../src/env.ts";

const post = (body: string) => new Request("https://x/", { method: "POST", body, headers: { "content-type": "application/json" } });

test("readBody gives a route an object to read fields from, whatever the client sent", async () => {
  expect(await readBody<"on">(post(`{"on": true}`))).toEqual({ on: true });
  // Bad JSON, no body, or JSON that isn't an object: an empty object, never a throw and never a string or array wearing the Body type.
  expect(await readBody(post(`{"on": `))).toEqual({});
  expect(await readBody(new Request("https://x/", { method: "POST" }))).toEqual({});
  expect(await readBody<"length">(post(`[1, 2, 3]`))).toEqual({});
  expect(await readBody<"length">(post(`"a string"`))).toEqual({});
  expect(await readBody(post(`null`))).toEqual({});
  expect(await readBody(post(`42`))).toEqual({});
});
