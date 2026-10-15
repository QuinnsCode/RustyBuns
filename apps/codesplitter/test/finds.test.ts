import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { SPOTS } from "../src/finds.ts";

// One journey: find the spots one by one, and the badge shows on the profile once all are found.
describe("finds", () => {
  test("finding every hidden spot earns the badge, and others only see the count", async () => {
    const call = await boot({ GH_CLI: "off" });
    const put = async (user: string | null, key: string) => {
      const res = await call(user, "/api/me/finds", { method: "PUT", body: JSON.stringify({ key }) });
      return { status: res.status, body: (await res.json()) as any };
    };
    const get = async (as: string | null, of: string) => (await (await call(as, `/api/users/${of}/finds`)).json()) as any;
    for (const u of ["ryan", "mia"]) await call(u, "/api/login", { method: "POST", body: JSON.stringify({ name: u }) });

    expect((await put("ryan", "secret-door")).status).toBe(400);
    expect((await put(null, "city")).status).toBe(401);
    for (const key of SPOTS.slice(0, -1)) await put("ryan", key);
    await put("ryan", "city"); // again: still one
    expect(await get("ryan", "ryan")).toMatchObject({ count: SPOTS.length - 1, all: false });

    const last = await put("ryan", SPOTS.at(-1)!);
    expect(last.body).toMatchObject({ count: SPOTS.length, total: SPOTS.length, all: true });

    const seenByMia = await get("mia", "ryan");
    expect(seenByMia).toMatchObject({ count: SPOTS.length, all: true });
    expect(seenByMia.found).toBeUndefined();
    expect(await get("mia", "mia")).toMatchObject({ count: 0, all: false, found: [] });
  });
});
