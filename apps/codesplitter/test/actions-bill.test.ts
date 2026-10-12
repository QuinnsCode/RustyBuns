import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

/** GitHub, answering /user and the billing usage report; everything else goes through. */
function github(usage: { status?: number; items?: unknown[] }) {
  const asked: string[] = [];
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u instanceof Request ? u.url : u);
    if (!url.startsWith("https://api.github.com/")) return real(u as string, init);
    asked.push(url);
    if (url.endsWith("/user")) return Response.json({ login: "boss-gh" });
    if (usage.status) return Response.json({ message: "nope" }, { status: usage.status });
    return Response.json({ usageItems: usage.items ?? [] });
  }) as typeof fetch;
  return asked;
}

async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss", GITHUB_TOKEN: "ghp_test" });
  opened.push(call);
  for (const u of ["boss", "mia"]) await call(u, "/api/login", { method: "POST", body: JSON.stringify({ name: u }) });
  return call;
}

describe("GET /api/admin/actions", () => {
  test("sums this month's Actions lines: free when public minutes are discounted to nothing, owed when not", async () => {
    const call = await app();
    const asked = github({ items: [
      { product: "actions", sku: "actions_linux", quantity: 120, unitType: "Minutes", grossAmount: 0.96, discountAmount: 0.96, netAmount: 0, repositoryName: "QuinnsCode/RustyBuns" },
      { product: "actions", sku: "actions_macos", quantity: 30, unitType: "Minutes", grossAmount: 1.8, discountAmount: 1.8, netAmount: 0, repositoryName: "QuinnsCode/RustyBuns" },
      { product: "actions", sku: "actions_linux", quantity: 50, unitType: "Minutes", grossAmount: 0.4, discountAmount: 0, netAmount: 0.4, repositoryName: "QuinnsCode/private-thing" },
      { product: "git_lfs", sku: "git_lfs_storage", quantity: 1, unitType: "GigabyteHours", grossAmount: 5, discountAmount: 0, netAmount: 5, repositoryName: "QuinnsCode/RustyBuns" },
    ] });
    const b = await (await call("boss", "/api/admin/actions")).json() as any;
    expect(asked[1]).toMatch(/\/users\/boss-gh\/settings\/billing\/usage\?year=\d{4}&month=\d{1,2}$/);
    expect(b).toMatchObject({ ok: true, login: "boss-gh", total: { minutes: 200, gross: 3.16, discount: 2.76, net: 0.4 } });
    expect(b.repos.map((r: any) => [r.repo, r.minutes, r.net])).toEqual([["QuinnsCode/private-thing", 50, 0.4], ["QuinnsCode/RustyBuns", 150, 0]]);
    expect(b.runners.map((r: any) => [r.sku, r.minutes])).toEqual([["actions_linux", 170], ["actions_macos", 30]]);
  });

  test("says when the token can't read billing, and is for admins only", async () => {
    const call = await app();
    github({ status: 403 });
    expect(await (await call("boss", "/api/admin/actions")).json()).toEqual({ ok: false, reason: "this token can't read billing (it needs the Plan permission, read)", link: "https://github.com/settings/billing" });
    expect((await call("mia", "/api/admin/actions")).status).toBe(403);
    expect((await call(null, "/api/admin/actions")).status).toBe(403);
  });
});
