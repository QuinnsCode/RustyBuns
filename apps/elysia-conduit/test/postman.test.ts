// The RealWorld API suite (bedstack's own copy of the Postman collection, bin/api-tests) against the
// desktop host: build it, start it with no DATABASE_URL so it runs PGlite in a throwaway home with
// their migrations applied at boot, and run every request through newman. CONDUIT_BIN=<path> runs it
// against a compiled binary (rustybuns build desktop --outfile <path>) instead.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import newman, { type NewmanRunSummary } from "newman";

setDefaultTimeout(120_000);   // the first build and PGlite's initdb are slow
const app = join(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "elysia-conduit-"));
let host: Bun.Subprocess | undefined;

beforeAll(() => {
  const bin = process.env.CONDUIT_BIN;
  if (!bin) {
    const build = Bun.spawnSync(["bun", "../../packages/cli/src/index.ts", "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) throw new Error(`build desktop failed:\n${build.stdout}\n${build.stderr}`);
  }
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, RB_NO_BROWSER: "1" };
  delete env.DATABASE_URL;
  // stdout ignored: their Drizzle client logs every query
  host = Bun.spawn(bin ? [bin] : ["bun", ".rustybuns/dev/desktop.js"], { cwd: app, stdout: "ignore", stderr: "inherit", env });
});

afterAll(() => { host?.kill(); rmSync(home, { recursive: true, force: true }); });

test("the RealWorld Postman suite passes against the desktop on PGlite", async () => {
  const { url, token } = await serving();
  const collection = await Bun.file(join(app, "bin/api-tests/postman_collection.json")).json();
  // The host gates every request on its launch token; a browser gets it as a cookie, so newman sends one.
  const cookie = { key: "Cookie", value: `rb_token_${new URL(url).port}=${token}` };
  type Item = { item?: Item[]; request?: { header?: unknown[] } };
  const withCookie = (items: Item[]) => {
    for (const i of items) { if (i.item) withCookie(i.item); if (i.request) (i.request.header ??= []).push(cookie); }
  };
  withCookie(collection.item);
  const user = `u${Date.now()}`;
  const globals = { APIURL: new URL("/api", url).href, USERNAME: user, EMAIL: `${user}@mail.com`, PASSWORD: "Password123" };
  const summary = await new Promise<NewmanRunSummary>((done, fail) => newman.run({
    collection, reporters: [],
    globals: { values: Object.entries(globals).map(([key, value]) => ({ key, value, type: "string" })) },
  }, (err, s) => err ? fail(err) : done(s)));
  const { requests, assertions } = summary.run.stats;
  console.log(`[postman] ${requests.total} requests, ${assertions.total} assertions, ${assertions.failed} failed`);
  expect(summary.run.failures.map((f) => `${f.source?.name}: ${f.error.message}`)).toEqual([]);
  expect(assertions.total).toBeGreaterThan(300);
});

/** The URL and token the host leaves in <data>/desktop.json once it serves, as local tools find it. */
async function serving(): Promise<{ url: string; token: string }> {
  for (let i = 0; i < 600; i++) {
    if (host?.exitCode !== null) throw new Error(`host exited (${host?.exitCode}) before serving`);
    const file = Bun.file(join(home, ".elysia-conduit", "desktop.json"));   // fresh each time: a BunFile keeps its first size
    if (await file.exists()) {
      const d: unknown = await file.json().catch(() => null);
      if (d && typeof d === "object" && "url" in d && "token" in d && typeof d.url === "string" && typeof d.token === "string") return { url: d.url, token: d.token };
    }
    await Bun.sleep(100);
  }
  throw new Error("host never wrote desktop.json");
}
