import { expect, test } from "bun:test";
import { protectRoute } from "../src/protect.ts";

/** An env whose DB has the repo's main files and branch files, and whose file DOs record the revokes they get. */
function fakeEnv() {
  const revoked: string[] = [];
  const sql: string[] = [];
  const stmt = (q: string) => ({ bind: () => ({
    run: async () => ({}),
    all: async () => (sql.push(q), { results: [{ path: "a.ts", branch: null }] }),
  }) });
  const env = {
    DB: { prepare: stmt },
    FILES: { idFromName: (n: string) => n, get: (n: string) => ({ fetch: async (r: Request) => { revoked.push(`${n} ${new URL(r.url).search}`); return new Response("{}"); } }) },
  };
  return { env: env as any, revoked, sql };
}

const put = (on: boolean) => new Request("http://x/protect", { method: "PUT", body: JSON.stringify({ on }) });

test("turning protect-main on closes everyone else's sockets on main's files, and only those", async () => {
  const t = fakeEnv();
  expect(await (await protectRoute(put(true), t.env, "ana", "r", "ana")).json()).toEqual({ on: true });
  expect(t.revoked).toEqual(["ana/r/a.ts ?keep=ana"]);
  expect(t.sql.join()).not.toContain("branch_files");
});

test("turning it off closes nothing", async () => {
  const t = fakeEnv();
  await protectRoute(put(false), t.env, "ana", "r", "ana");
  expect(t.revoked).toEqual([]);
});
