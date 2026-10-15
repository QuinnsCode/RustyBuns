import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

test("an owner takes boxes off their profile; everything shows until they do", async () => {
  const call = await boot({ GH_CLI: "off" });
  const send = (user: string | null, url: string, body?: unknown, method = "POST") => call(user, url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  const profile = async (who: string | null) => ((await (await send(who, "/api/users/ryan", undefined, "GET")).json()) as any).user;

  expect((await profile(null)).hidden).toEqual([]);
  expect((await send("ryan", "/api/me", { hidden: ["pulse", "city", "pulse"] }, "PUT")).status).toBe(200);
  expect((await profile(null)).hidden).toEqual(["pulse", "city"]);

  // Only what's sent changes: a bio edit leaves the hidden boxes be; an unknown box is refused.
  await send("ryan", "/api/me", { bio: "hi" }, "PUT");
  expect((await profile(null)).hidden).toEqual(["pulse", "city"]);
  expect((await send("ryan", "/api/me", { hidden: ["secrets"] }, "PUT")).status).toBe(400);

  await send("ryan", "/api/me", { hidden: [] }, "PUT");
  expect((await profile(null)).hidden).toEqual([]);
});

test("Top 8: the people you follow until you pick, then your picks; strangers and yourself are refused", async () => {
  const call = await boot({ GH_CLI: "off" });
  const send = (user: string | null, url: string, body?: unknown, method = "POST") => call(user, url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const u of ["ryan", "ana", "bob"]) await send(u, "/api/login", { name: u });
  const top8 = async () => ((await (await send(null, "/api/users/ryan", undefined, "GET")).json()) as any).user.top8;

  expect(await top8()).toEqual([]);
  await send("ryan", "/api/follows", { name: "ana" });
  await send("ryan", "/api/follows", { name: "bob" });
  expect(await top8()).toEqual(["bob", "ana"]);

  expect((await send("ryan", "/api/me", { top8: ["ana", "bob"] }, "PUT")).status).toBe(200);
  expect(await top8()).toEqual(["ana", "bob"]);
  expect((await send("ryan", "/api/me", { top8: ["ryan"] }, "PUT")).status).toBe(400);
  expect((await send("ryan", "/api/me", { top8: ["nobody-here"] }, "PUT")).status).toBe(400);
  expect((await send("ryan", "/api/me", { top8: Array(8).fill("ana") }, "PUT")).status).toBe(400);
  await send("ryan", "/api/me", { top8: [] }, "PUT");
  expect(await top8()).toEqual([]);
});
