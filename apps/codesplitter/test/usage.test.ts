import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { extOf, noteConflict } from "../src/usage.ts";

setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const put = (call: any, user: string, body: unknown) => call(user, "/api/me", { method: "PUT", body: JSON.stringify(body) });

async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss" });
  opened.push(call);
  for (const u of ["boss", "ryan", "mia"]) await call(u, "/api/login", { method: "POST", body: JSON.stringify({ name: u }) });
  return call;
}
const count = async (call: any) => Number(((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM conflict_outcomes").first()) as any).n);

describe("extOf", () => {
  test("keeps the extension and nothing else of the path", () => {
    expect(extOf("src/secret/payments.TS")).toBe(".ts");
    expect(extOf("bun.lock")).toBe("lock");
    expect(extOf("Makefile")).toBe("");
  });
});

describe("help improve your git experience", () => {
  test("only a private-repo owner who hasn't answered is asked", async () => {
    const call = await app();
    const ask = async (u: string) => (await (await call(u, "/api/me")).json() as any).ask_usage;
    expect(await ask("ryan")).toBe(false);
    await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "vault", visibility: "private" }) });
    await call("mia", "/api/repos", { method: "POST", body: JSON.stringify({ name: "open" }) });
    expect(await ask("ryan")).toBe(true);
    expect(await ask("mia")).toBe(false);
    expect((await put(call, "ryan", { share_usage: "yes" })).status).toBe(400);
    await put(call, "ryan", { share_usage: false });
    expect(await ask("ryan")).toBe(false);
  });

  test("nothing is kept until they say yes, and no is a delete", async () => {
    const call = await app();
    await noteConflict(call.env, "ryan", "src/a.ts", { round: 1, who: "ask", ok: true, tests: "passed" });
    expect(await count(call)).toBe(0);
    await put(call, "ryan", { share_usage: true });
    await noteConflict(call.env, "ryan", "src/a.ts", { round: 1, who: "ask", harness: "claude", ok: true, tests: "passed" });
    await noteConflict(call.env, "ryan", "bun.lock", { round: 3, who: "escalate" });
    expect(await count(call)).toBe(2);
    const row = (await call.env.DB.prepare("SELECT * FROM conflict_outcomes WHERE ext = '.ts'").first()) as any;
    expect(Object.values(row).join(" ")).not.toContain("src/");

    const exported = await (await call("ryan", "/api/me/export")).json() as any;
    expect(exported.shared_usage.opted_in).toBe(1);
    expect(exported.shared_usage.conflicts).toHaveLength(2);

    const stats = await (await call("boss", "/api/admin/insights")).json() as any;
    expect(stats.conflicts.people).toBe(1);
    expect(stats.conflicts.by_ext.find((e: any) => e.ext === ".ts")).toMatchObject({ n: 1, held: 1 });

    await put(call, "ryan", { share_usage: false });
    expect(await count(call)).toBe(0);
  });
});
