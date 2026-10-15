import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { LAST_SEEN } from "../src/seen.ts";

// End to end (in-process D1), like follows.test.ts.

async function app() {
  const call = await boot({ GH_CLI: "off" });
  const send = async (user: string, url: string, body?: unknown, method = "PUT") => {
    const res = await call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const get = async (user: string, key: string) => (await send(user, `/api/me/seen?key=${encodeURIComponent(key)}`, undefined, "GET")).body.rev;
  for (const u of ["ryan", "mia"]) await send(u, "/api/login", { name: u }, "POST");
  return { call, send, get };
}

// The file page's last-seen rev follows the account, not just the browser (#779).
describe("last seen", () => {
  test("a file's rev is kept per account and key, and the latest write wins", async () => {
    const { send, get } = await app();
    expect(await get("ryan", "ryan/app::a.ts")).toBeNull();
    expect((await send("ryan", "/api/me/seen", { key: "ryan/app::a.ts", rev: 4 })).status).toBe(200);
    await send("ryan", "/api/me/seen", { key: "ryan/app:fix:a.ts", rev: 2 });
    await send("ryan", "/api/me/seen", { key: "ryan/app::a.ts", rev: 9 });
    expect([await get("ryan", "ryan/app::a.ts"), await get("ryan", "ryan/app:fix:a.ts")]).toEqual([9, 2]);
    // mia has her own.
    expect(await get("mia", "ryan/app::a.ts")).toBeNull();
  });

  test("bad input, and signed out", async () => {
    const { call, send } = await app();
    expect((await send("ryan", "/api/me/seen", { key: "", rev: 1 })).status).toBe(400);
    expect((await send("ryan", "/api/me/seen", { key: "x".repeat(1025), rev: 1 })).status).toBe(400);
    expect((await send("ryan", "/api/me/seen", { key: "k", rev: 1.5 })).status).toBe(400);
    expect((await send("ryan", "/api/me/seen", { key: "k", rev: -1 })).status).toBe(400);
    expect((await call(null, "/api/me/seen?key=k")).status).toBe(401);
  });

  test("only the newest files are kept", async () => {
    const { send, get } = await app();
    for (let i = 0; i <= LAST_SEEN; i++) await send("ryan", "/api/me/seen", { key: `f${i}`, rev: i });
    expect(await get("ryan", "f0")).toBeNull();
    expect(await get("ryan", "f1")).toBe(1);
    expect(await get("ryan", `f${LAST_SEEN}`)).toBe(LAST_SEEN);
  });
});
