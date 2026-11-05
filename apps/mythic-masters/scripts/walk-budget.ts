// The open world's frame budget, measured the same way every round of the climb (#3664):
//   bun scripts/walk-budget.ts [--seconds 90] [--json out.json] [--only desktop|phone]
// Builds the game, serves the build, and per viewport (desktop 1280x720, phone 390x844 at 2x with touch) opens a cold tab:
// the time and bytes until the first walkable frame (the world shown, its ground loaded, all three patches built), then a
// fixed walk at 11:00 in calm weather from region 1's arena toward region 5's, across the border into region 3, at RUN m/s.
// It prints the 95th-percentile and worst frame, the frames over 50 ms (and how far along each came), draw calls and JS heap
// at the start and end of the walk, the most triangles in a frame, and the shader programs compiled before and during it (a compile mid-walk is a hitch). Real GPU numbers: chrome.ts runs headless Chrome on Metal on a Mac.
// test/budget.test.ts holds the limits and runs this with MM_BUDGET=1.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { freePort, launchChrome, openTab } from "../../../scripts/chrome.ts";
import { arr, bool, check, num, nul, obj, type Of } from "@rustybuns/util/guard";

// Region 1's arena toward region 5's: the line runs on open ground into region 3 at about 5.7 km, a border that is
// open from the start (beat 1 to 3). The walk starts half its length short of that border.
const AIM = 5, TO = 3;
const RUN = 12; // metres a second: a running walker, so 90 s crosses the near patch's 64 m snap ~17 times and the mid's twice
const app = resolve(import.meta.dir, "..");

/** Runs in the page from its first script: marks the first frame the world can be walked in. */
const WATCH = `(() => {
  const tick = () => {
    const s = window.mythicMasters?.world?.state?.();
    const p = s?.ground?.patches;
    if (s && s.ground.loaded && p && !p.dirty.some(Boolean)) { window.__walkable = performance.now(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

/** Runs in the page: the walk itself. Each frame puts you RUN m/s further along the line, and the frame's length is kept. */
const WALK = (secs: number) => `(() => {
  const w = mythicMasters.world;
  for (const n of [1, 2, 3]) w.beat(n);
  w.setHour(11); w.setWeather({ rain: 0, snow: 0, mist: 0 });
  // the wild ones roam and are drawn, but walking into one starts no fight: the walk measures the world, not an arena
  w.peace(true);
  const at = () => { const s = w.state(); return { x: s.x, z: s.z }; };
  w.travel(${AIM}); const b = at();
  w.travel(1); mythicMasters.director.cut();
  const arena = at();
  if (Math.hypot(b.x - arena.x, b.z - arena.z) < 100) throw new Error('region ${AIM} is not open from region 1');
  const len = Math.hypot(b.x - arena.x, b.z - arena.z), ux = (b.x - arena.x) / len, uz = (b.z - arena.z) / len;
  // the first metre along the line that is region ${TO}'s ground, then start half a walk short of it
  let hi = 0;
  while (hi < len) { hi += 25; w.teleport(arena.x + ux * hi, arena.z + uz * hi); if (w.state().region === ${TO}) break; }
  const back = Math.max(0, hi - ${(RUN * secs) / 2});
  const a = { x: arena.x + ux * back, z: arena.z + uz * back };
  w.teleport(a.x, a.z);
  const out = window.__walk = { border: Math.round(hi - back), frames: [], long: [], worst: 0, worstAt: 0, samples: [], regions: [w.state().region], metres: 0, fought: false, done: false };
  const heap = () => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  let t0 = 0, last = 0, d = 0, waited = 0;
  const step = (now) => {
    // the pieces the beats opened rise first, under their camera shot; the walk starts on settled ground
    if (!t0) { const s = waited++ % 30 === 0 ? w.state() : null; if (s && !s.rising.length && !s.shot && s.ground.patches.dirty.every((x) => !x)) t0 = last = now; else if (waited > 60 * 60) throw new Error('the ground never settled'); requestAnimationFrame(step); return; }
    const dt = now - last; last = now; out.frames.push(dt);
    if (dt > 50 && out.frames.length > 10) out.long.push(Math.round(d));
    if (dt > out.worst && out.frames.length > 10) { out.worst = dt; out.worstAt = Math.round(d); }
    d += ${RUN / 1000} * dt;
    w.teleport(a.x + ux * d, a.z + uz * d);
    if (out.frames.length % 120 === 0) { const r = w.state().region; if (r !== out.regions[out.regions.length - 1]) out.regions.push(r); }
    if (out.frames.length % 30 === 0) out.samples.push({ heap: heap(), ...mythicMasters.perf() });
    if (now - t0 < ${secs * 1000}) requestAnimationFrame(step); else { out.metres = Math.round(d); out.fought = !!mythicMasters.state(); w.peace(false); out.done = true; }
  };
  requestAnimationFrame(step);
  return true;
})()`;

const n = () => num(-1e15, 1e15);
const Sample = obj({ heap: nul(n()), calls: n(), triangles: n(), geometries: n(), programs: n() });
const Walk = obj({ border: n(), frames: arr(n(), 1e6), long: arr(n(), 1e5), worstAt: n(), samples: arr(Sample, 1e5), regions: arr(n(), 100), metres: n(), fought: bool(), done: bool() });

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN; };
const r1 = (x: number) => +x.toFixed(1);

/** One viewport's walk, in numbers. */
export interface Row {
  view: "desktop" | "phone";
  /** Seconds and MB from navigation to the first walkable frame, cache off. */
  loadS: number; loadMB: number;
  frames: number; metres: number; regions: number[];
  p50: number; p95: number; max: number; /** metres along the walk of the worst frame */ maxAt: number; over50: number; longAt: number[];
  callsMin: number; callsMax: number; trianglesMax: number; programsStart: number; programsEnd: number; heapStart: number; heapEnd: number; geometriesStart: number; geometriesEnd: number;
  noise: string[];
}

export async function walkBudget({ seconds = 90, only }: { seconds?: number; only?: Row["view"] } = {}): Promise<Row[]> {
  const dist = mkdtempSync(join(tmpdir(), "mm-budget-"));
  const build = Bun.spawnSync(["bun", "--bun", "x", "vite", "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "error"], { cwd: app, stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const port = await freePort();
  const server = Bun.spawn(["bun", "--bun", "x", "vite", "preview", "--outDir", dist, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: app, stdout: "ignore", stderr: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60 && !(await fetch(url).then((r) => r.ok, () => false)); i++) await Bun.sleep(250);

  const { cdp, stop } = await launchChrome();
  const rows: Row[] = [];
  try {
    for (const [view, size, mobile] of [["desktop", { w: 1280, h: 720 }, false], ["phone", { w: 390, h: 844 }, true]] as const) {
      if (only && only !== view) continue;
      const tab = await openTab(cdp, size, mobile);
      await tab.call("Network.setCacheDisabled", { cacheDisabled: true });
      let bytes = 0, walkableAt = 0;
      cdp.on((m) => { if (m.sessionId === tab.sessionId && m.method === "Network.loadingFinished" && !walkableAt) bytes += m.params.encodedDataLength ?? 0; });
      await tab.call("Page.addScriptToEvaluateOnNewDocument", { source: WATCH });
      await tab.call("Page.navigate", { url: `${url}?world=1&a=jackalope` });
      for (let i = 0; i < 120 && !walkableAt; i++) { await Bun.sleep(250); walkableAt = check(n(), await tab.eval<unknown>("window.__walkable ?? null").catch(() => null)) ?? 0; }
      await Bun.sleep(1500);
      await tab.eval(WALK(seconds));
      let walk: Of<typeof Walk> | null = null;
      for (let i = 0; i < seconds + 60 && !walk?.done; i++) { await Bun.sleep(1000); walk = check(Walk, await tab.eval<unknown>("window.__walk")); }
      if (!walk?.done) throw new Error(`${view}: the walk didn't finish`);
      if (walk.fought) throw new Error(`${view}: a fight started during the walk, so it measured an arena`);
      const f = walk.frames.slice(10), first = walk.samples[0]!, end = walk.samples[walk.samples.length - 1]!, calls = walk.samples.map((s) => s.calls);
      const row: Row = {
        view, loadS: walkableAt ? +(walkableAt / 1000).toFixed(2) : Infinity, loadMB: r1(bytes / 1048576), frames: f.length, metres: walk.metres, regions: walk.regions,
        p50: r1(pct(f, 0.5)), p95: r1(pct(f, 0.95)), max: r1(Math.max(...f)), maxAt: walk.worstAt, over50: f.filter((x) => x > 50).length, longAt: walk.long,
        callsMin: Math.min(...calls), callsMax: Math.max(...calls), trianglesMax: Math.max(...walk.samples.map((s) => s.triangles)), programsStart: first.programs, programsEnd: end.programs, heapStart: first.heap ?? 0, heapEnd: end.heap ?? 0, geometriesStart: first.geometries, geometriesEnd: end.geometries,
        noise: tab.noise.slice(0, 3),
      };
      rows.push(row);
      await tab.close();
    }
  } finally { stop(); server.kill(); }
  return rows;
}

if (import.meta.main) {
  const argv = process.argv.slice(2), opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const only = opt("--only"), rows = await walkBudget({ seconds: Number(opt("--seconds") ?? 90), only: only === "desktop" || only === "phone" ? only : undefined });
  for (const r of rows) console.log(JSON.stringify(r));
  const json = opt("--json");
  if (json) writeFileSync(json, JSON.stringify(rows, null, 2));
}
