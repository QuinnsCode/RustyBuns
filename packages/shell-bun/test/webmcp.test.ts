import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "../src/serve.ts";
import { profRoute } from "../src/cpuprof.ts";
import { history } from "../src/history.ts";
import { webMcpRoute, webMcpScript, WEBMCP_PATH, WEBMCP_TAG } from "../src/webmcp.ts";

const SECRET = "a-long-enough-secret";
const MEM = { rssMb: 120, heapMb: 40, peakRssMb: 130, uptimeS: 3600, slopeMbPerHour: 2.5, hoursToMax: null, maxMb: null, samples: 12, boots: 3 };

/** A box: a page, /__rb/mem, the prof and history routes (when `secret`), the script, and an app that answers the rest. */
function box(secret?: string) {
  const dir = mkdtempSync(join(tmpdir(), "rb-webmcp-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><head><title>app</title></head><body>hi</body></html>");
  const hist = history({ file: join(dir, "history.jsonl") });
  hist.boot("v1");
  const prof = profRoute({ secret, dir: join(dir, "prof"), history: hist, log: () => {} });
  const script = webMcpRoute();
  const shell = serve({ assets: dir, head: WEBMCP_TAG });
  shell.mount({
    fetch: async (req: Request) => new URL(req.url).pathname === "/__rb/mem" ? Response.json(MEM)
      : (await prof(req)) ?? script(req) ?? new Response("<html><head></head><body>app 404</body></html>", { status: 404, headers: { "Content-Type": "text/html" } }),
  } as any, {});
  return shell;
}

/** Runs the page's script against `base` with a fake model context; returns the tools and the page's storage. */
function page(base: string, hash = "", withMc = true) {
  const tools = new Map<string, { execute(a: object): Promise<{ content: { text: string }[]; isError?: boolean }> }>();
  const store = new Map<string, string>();
  const loc = { pathname: "/play", search: "?x=1", hash };
  const replaced: string[] = [];
  const env = {
    navigator: withMc ? { modelContext: { registerTool: (t: any) => tools.set(t.name, t) } } : {},
    location: loc,
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    fetch: (p: string, init?: RequestInit) => fetch(base + p, init),
  };
  new Function(...Object.keys(env), webMcpScript())(...Object.values(env));
  const call = async (name: string, args: object = {}) => {
    const r = await tools.get(name)!.execute(args);
    return { text: r.content[0]!.text, error: !!r.isError };
  };
  return { tools, store, replaced, call };
}

test("serve: head goes into every HTML page, assets and the handler's, and nothing else", async () => {
  const shell = box(SECRET);
  const index = await fetch(shell.url + "/");
  expect(await index.text()).toBe(`<!doctype html><html><head><title>app</title>${WEBMCP_TAG}</head><body>hi</body></html>`);
  expect(await (await fetch(shell.url + "/nope")).text()).toContain(`<head>${WEBMCP_TAG}</head>`);
  expect(await (await fetch(shell.url + "/__rb/mem")).json()).toEqual(MEM);
  const js = await fetch(shell.url + WEBMCP_PATH);
  expect(js.headers.get("content-type")).toStartWith("text/javascript");
  expect(await js.text()).toBe(webMcpScript());
  await shell.stop();
});

test("webmcp: the secret comes off the URL into this tab; tools read memory, profile and history", async () => {
  const shell = box(SECRET);
  const p = page(shell.url, `#tab=2&rb_prof=${SECRET}`);
  expect([...p.tools.keys()]).toEqual(["mem_stats", "take_cpu_profile", "mem_history"]);
  expect(p.store.get("rb_prof_secret")).toBe(SECRET);
  expect(p.replaced).toEqual(["/play?x=1#tab=2"]);

  expect(await p.call("mem_stats")).toEqual({ text: "rss 120 MB, heap 40 MB, peak 130 MB, +2.5 MB/h, no ceiling, up 60 min, start 3 on this data", error: false });
  const prof = await p.call("take_cpu_profile", { seconds: 1, top: 3 });
  expect(prof.error).toBe(false);
  expect(prof.text).toMatch(/^cpu-.*\.cpuprofile \(sampled 1s\)/);
  expect(prof.text).toContain("saved on the box at ");      // the summary sits between: an idle test box may have no samples
  const hist = await p.call("mem_history", { runs: 2 });
  expect(hist.error).toBe(false);
  expect(hist.text).toContain("this run:");
  expect(hist.text).toContain("v1");
  expect(hist.text).toContain("profile cpu-");
  await shell.stop();
});

test("webmcp: without the secret, with a wrong one, or on a box with none, the tools say why", async () => {
  const shell = box(SECRET);
  const none = page(shell.url);
  expect(none.replaced).toEqual([]);
  const need = await none.call("take_cpu_profile");
  expect(need.error).toBe(true);
  expect(need.text).toContain("#rb_prof=");
  expect(need.text).toContain("Don't ask them to tell you the secret");
  expect((await none.call("mem_stats")).error).toBe(false);

  const wrong = page(shell.url, "#rb_prof=not-the-secret-at-all");
  const bad = await wrong.call("mem_history");
  expect(bad).toMatchObject({ error: true });
  expect(bad.text).toContain("turned down the secret");
  expect(wrong.store.has("rb_prof_secret")).toBe(false);
  await shell.stop();

  const open = box();
  const off = await page(open.url, `#rb_prof=${SECRET}`).call("take_cpu_profile");
  expect(off.error).toBe(true);
  expect(off.text).toContain("has no RB_PROF_SECRET");
  await open.stop();
});

test("webmcp: a browser without WebMCP still takes the secret off the URL, and registers nothing", () => {
  const p = page("http://unused", `#rb_prof=${SECRET}`, false);
  expect(p.tools.size).toBe(0);
  expect(p.store.get("rb_prof_secret")).toBe(SECRET);
  expect(p.replaced).toEqual(["/play?x=1"]);
});
