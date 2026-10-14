import { expect, setDefaultTimeout, test } from "bun:test";
import { local } from "../src/local.ts";
import { locationHint } from "../src/settings.ts";

setDefaultTimeout(30_000);

test("your settings live in a Durable Object of your own and nobody else sees them", async () => {
  const app = await local();
  expect(await (await app("quinn", "/api/me/settings")).json()).toEqual({});
  const put = (user: string, body: unknown) => app(user, "/api/me/settings", { method: "PUT", body: JSON.stringify(body) });
  expect(await (await put("quinn", { theme: "dark" })).json()).toEqual({ theme: "dark" });
  expect(await (await app("quinn", "/api/me/settings")).json()).toEqual({ theme: "dark" });
  expect(await (await app("sam", "/api/me/settings")).json()).toEqual({});
  expect(await (await put("quinn", { theme: null })).json()).toEqual({});
});

test("settings refuse what isn't one, and need a sign-in", async () => {
  const app = await local();
  const put = (user: string | null, body: unknown) => app(user, "/api/me/settings", { method: "PUT", body: JSON.stringify(body) });
  expect((await put("quinn", { theme: "purple" })).status).toBe(400);
  expect((await put("quinn", { nope: 1 })).status).toBe(400);
  expect((await put("quinn", [1])).status).toBe(400);
  expect((await put(null, { theme: "dark" })).status).toBe(401);
  expect((await app(null, "/api/me/settings")).status).toBe(401);
});

test("the export carries your settings", async () => {
  const app = await local();
  await app("quinn", "/api/me/settings", { method: "PUT", body: JSON.stringify({ theme: "light" }) });
  const out = await (await app("quinn", "/api/me/export")).json() as { settings: unknown };
  expect(out.settings).toEqual({ theme: "light" });
});

test("a location hint is coarse and comes only from the continent", () => {
  const at = (cf: object) => Object.assign(new Request("https://x/"), { cf });
  expect(locationHint(at({ continent: "EU" }))).toBe("weur");
  expect(locationHint(at({ continent: "NA", longitude: "-122.4" }))).toBe("wnam");
  expect(locationHint(at({ continent: "NA", longitude: "-74" }))).toBe("enam");
  expect(locationHint(new Request("https://x/"))).toBeUndefined();
});
