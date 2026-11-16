// The dev scripts' reply reader: a reply that isn't the shape, or a status the script didn't expect, stops it by name.
import { expect, test } from "bun:test";
import { int, obj } from "@rustybuns/util/guard";
import { got } from "../src/local.ts";

const Claim = obj({ id: int(0, 100) });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("got hands back the checked reply, and names the call when the shape or the status is wrong", async () => {
  expect(await got(reply({ id: 3, extra: true }), Claim, "claim")).toEqual({ id: 3 });
  await expect(got(reply({ id: "three" }), Claim, "claim")).rejects.toThrow(/^claim: not the reply it answers \(id: /);
  await expect(got(reply({ error: "held" }, 409), Claim, "claim")).rejects.toThrow("claim: 409");
  expect(await got(reply({ id: 4 }, 409), Claim, "claim", (s) => s === 409)).toEqual({ id: 4 });
});
