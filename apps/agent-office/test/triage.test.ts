import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hookCall, runTriageMcp } from "../triage/mcp.ts";
import { officeTriage } from "../triage/server.ts";
import { addCommands, listCommands, runCommand } from "@rustybuns/util/commands";
import { triageCommands } from "../triage/index.ts";
import { formatMem, runTriageTool, TRIAGE_READ_ONLY, TRIAGE_TOOLS, type TriageCall } from "../triage/tools.ts";

function office() {
  const dir = mkdtempSync(path.join(tmpdir(), "rb-triage-"));
  const floor = { id: "f1", dir: path.join(dir, "floor") };
  mkdirSync(path.join(floor.dir, ".agent-office", "heap"), { recursive: true });
  const routes = officeTriage(dir, () => [floor]);
  const call: TriageCall = async (method, p) => (await routes(method, new URL(p, "http://office"), true)) ?? { status: 404, body: {} };
  return { dir, floor, routes, call };
}

test("the routes: memory, a profile taken and read back, heap snapshots, and a POST from the page needs the header", async () => {
  const { dir, floor, routes, call } = office();
  expect(await routes("GET", new URL("http://o/somewhere"), true)).toBeNull();
  const mem = await call("GET", "/__rb/mem");
  expect(mem.body.office.rssMb).toBeGreaterThan(0);
  expect(mem.body.ptyHosts).toEqual([{ floor: "f1", mem: null }]);

  expect((await routes("POST", new URL("http://o/__rb/prof?s=1"), false))!.status).toBe(403);
  expect((await call("GET", "/__rb/prof")).body).toEqual({ running: false, profiles: [] });
  const taken = await call("POST", "/__rb/prof?s=1&top=3");
  expect(taken.status).toBe(200);
  expect(taken.body.id).toMatch(/^office-.*\.cpuprofile$/);
  expect(taken.body.seconds).toBe(1);
  expect(taken.body.summary.self.length).toBeLessThanOrEqual(3);
  expect((await call("GET", "/__rb/prof")).body.profiles.map((p: any) => p.id)).toEqual([taken.body.id]);
  expect((await call("GET", `/__rb/prof/${taken.body.id}`)).body.summary.samples).toBe(taken.body.summary.samples);
  expect((await call("GET", "/__rb/prof/..%2Fsecret.cpuprofile")).status).toBe(400);
  expect((await call("GET", "/__rb/prof/nope.cpuprofile")).status).toBe(404);

  writeFileSync(path.join(floor.dir, ".agent-office", "heap", "heap-1.heapsnapshot"), "{}");
  mkdirSync(path.join(dir, "heap"));
  writeFileSync(path.join(dir, "heap", "heap-2.heapsnapshot"), "{}");
  const heap = (await call("GET", "/__rb/heap")).body.snapshots;
  expect(heap.map((s: any) => s.process).sort()).toEqual(["office", "pty host (floor f1)"]);
});

test("the tools read as text, and the MCP server's go through the hook port with the worker's token", async () => {
  const { routes } = office();
  const seen: string[] = [];
  const fakeFetch = (async (u: string, init: RequestInit) => {
    const url = new URL(u);
    seen.push(`${init.method} ${url.pathname} ${url.searchParams.get("worker")} ${(init.headers as any).authorization}`);
    const a = await routes(init.method!, url, true);
    return new Response(JSON.stringify(a?.body ?? {}), { status: a?.status ?? 404 });
  }) as typeof fetch;
  const env = { AGENT_OFFICE_HOOK_URL: "http://127.0.0.1:1/", AGENT_OFFICE_WORKER_ID: "w1", AGENT_OFFICE_HOOK_TOKEN: "tok" };

  const mem = await runTriageMcp("mem_stats", {}, { env, fetch: fakeFetch });
  expect(mem.text).toMatch(/^office: rss [\d.]+ MB, heap [\d.]+ MB.*no ceiling/);
  expect(mem.text).toContain("pty host (floor f1): no sample yet");
  expect(seen).toEqual(["GET /__rb/mem w1 Bearer tok"]);

  await expect(runTriageTool("read_profile", {}, hookCall({ env, fetch: fakeFetch }))).rejects.toThrow("take_cpu_profile takes one");
  const taking = runTriageMcp("take_cpu_profile", { seconds: 1 }, { env, fetch: fakeFetch });
  // Bun only samples while JS runs, so give it something to see
  setTimeout(function spin() { const end = Date.now() + 100; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); }, 50);
  const prof = await taking;
  expect(prof.text).toContain("self time:");
  expect(prof.text).toContain("spin");
  expect(prof.text).toContain("speedscope");
  expect(await runTriageTool("list_profiles", {}, hookCall({ env, fetch: fakeFetch }))).toMatch(/^1 CPU profile\n  office-/);
  expect(await runTriageTool("read_profile", { top: 2 }, hookCall({ env, fetch: fakeFetch }))).toContain("total time:");
  expect(await runTriageTool("heap_snapshots", {}, hookCall({ env, fetch: fakeFetch }))).toContain("No heap snapshots");
  // This run's history: the profile just taken, beside the memory samples.
  const hist = await runTriageTool("mem_history", {}, hookCall({ env, fetch: fakeFetch }));
  expect(hist).toMatch(/^this run: /);
  expect(hist).toMatch(/profile office-.*\.cpuprofile \(asked, /);

  await expect(runTriageMcp("mem_stats", {}, { env: {}, fetch: fakeFetch })).rejects.toThrow("AGENT_OFFICE_HOOK_URL");
});

test("only the tools that look skip the permission prompt", () => {
  expect(TRIAGE_READ_ONLY).toEqual(["mem_stats", "list_profiles", "read_profile", "mem_history", "heap_snapshots"]);
  expect(TRIAGE_TOOLS.map((t) => t.name)).toContain("take_cpu_profile");
});

test("a slope and the hours left to the ceiling", () => {
  expect(formatMem("office", { rssMb: 400, heapMb: 120, peakRssMb: 410, uptimeS: 7200, slopeMbPerHour: 25, hoursToMax: 4, maxMb: 500, samples: 12 }))
    .toBe("office: rss 400 MB, heap 120 MB, peak 410 MB, +25 MB/h, ~4h to the 500 MB ceiling, up 120 min");
  expect(formatMem("office", { rssMb: 80, heapMb: 20, peakRssMb: 80, uptimeS: 60, slopeMbPerHour: null, hoursToMax: null, maxMb: null, samples: 1 }))
    .toContain("slope after 2 more samples, no ceiling");
});

test("on the page: each tool is a command, and a signed-out call says to sign in", async () => {
  const off = addCommands(triageCommands(async () => ({ status: 401, body: { error: "Sign in to the office first" } })));
  expect(listCommands().map((c) => c.name)).toEqual(TRIAGE_TOOLS.map((t) => t.name));
  await expect(runCommand("mem_stats")).rejects.toThrow("Sign in to the office first");
  off();
  await expect(runCommand("mem_stats")).rejects.toThrow('no command "mem_stats"');
});
