import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

test("an owner takes boxes off their profile; everything shows until they do", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
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
