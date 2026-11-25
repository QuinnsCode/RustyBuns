// Speaker plans (/speakers.html): someone picks a plan, sees its cabinet stand from the cut list, swaps the walls to
// aluminium and hears them ring longer, braces them, pulls the pieces apart, and plays the loop through the box. The
// Rust box (native/crates/fm_daw/src/enclosure.rs) plays what the TypeScript one plays (skipped, with a note, when the
// wasm isn't built or predates the box).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxFilter, PLANS, curveOf, design, encodePlan, logFreqs } from "@rustybuns/gear";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { instantiateFm, type Exports } from "../src/engine/wasm.ts";
import { RustBox, rustCurve } from "../src/speakers/rust.ts";

setDefaultTimeout(120_000); // draws and plays every plan's cabinet, in Rust and in headless Chrome
const app = join(import.meta.dir, "..");
const wasmPath = join(app, "public", "fm_daw.wasm");
const rust: Exports | null = existsSync(wasmPath) ? await instantiateFm(readFileSync(wasmPath)) : null;
const hasBox = !!rust && typeof rust.fm_box_curve === "function";
if (!hasBox) console.log("enclosure: no fm_daw.wasm with the box in public/ (bun run test:rust builds it); the Rust side is skipped");

test.skipIf(!hasBox)("the Rust box draws and plays what the TypeScript box does, on every plan", () => {
  const freqs = logFreqs(10, 2000, 200);
  for (const p of PLANS) {
    const d = design(p), e = encodePlan(p), ts = curveOf(d, freqs), rs = rustCurve(rust!, e, freqs);
    for (let i = 0; i < freqs.length; i++) expect([p.id, freqs[i], Math.abs(ts[i] - rs[i]) < 1e-6]).toEqual([p.id, freqs[i], true]);
    const a = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i * 0.013) * Math.sin(i * 0.0007));
    const b = a.slice();
    new BoxFilter(d, 48000).process(a);
    const r = new RustBox(rust!, e, 48000);
    r.process(b);
    r.free();
    let gap = 0;
    for (let i = 0; i < a.length; i++) gap = Math.max(gap, Math.abs(a[i] - b[i]));
    expect([p.id, gap < 1e-5]).toEqual([p.id, true]);
  }
  // A plan cut short is refused, not read past its end.
  expect(() => new RustBox(rust!, encodePlan(PLANS[0]).slice(0, 9))).toThrow();
});

let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output", "--autoplay-policy=no-user-gesture-required"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

type Wall = { id: string; hz: number; db: number; ringMs: number };
type State = { frontZ: number; plan: string; material: string; braces: number; explode: number; tune: number; q: number; down3: number; walls: Wall[]; parts: string[]; cuts: { part: string }[] };

test.skipIf(!hasChrome)("pick a plan, swap the walls, brace them, pull it apart and listen", async () => {
  for (const [size, phone] of [[{ w: 1280, h: 800 }, false], [{ w: 390, h: 844 }, true]] as const) {
    const tab = await openTab(chrome.cdp, size, phone);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    await load(chrome.cdp, tab, `${vite.url}/speakers.html`, 0);
    for (const end = Date.now() + 30_000; Date.now() < end && !(await page<boolean>("!!window.qspeakers").catch(() => false)); ) await Bun.sleep(50);
    const state = () => page<State>("qspeakers.state()");

    // The sealed sub: its six walls, a brace and the woofer stand in 3D, and it lands near Qtc 0.72.
    expect(await page<boolean>("qspeakers.pick('sub-sealed-12')")).toBe(true);
    let s = await state();
    expect(s.parts).toEqual(expect.arrayContaining(["side-left", "side-right", "top", "bottom", "front", "back", "brace-1", "driver-0"]));
    expect(s.q).toBeGreaterThan(0.69);
    expect(s.q).toBeLessThan(0.76);
    expect(await page<boolean>("document.documentElement.scrollWidth <= innerWidth")).toBe(true);

    // The vented bookshelf: aluminium walls ring longer than MDF, and a brace lifts the side's mode.
    await page("qspeakers.pick('bookshelf-vented')");
    s = await state();
    expect(s.parts).toContain("port-0");
    const mdf = s.walls.find((w) => w.id === "left")!;
    await page("qspeakers.material('aluminium')");
    const alu = (await state()).walls.find((w) => w.id === "left")!;
    expect(alu.ringMs).toBeGreaterThan(mdf.ringMs * 10);
    expect(await page<number>("qspeakers.braces(1)")).toBe(1);
    expect((await state()).walls.find((w) => w.id === "left")!.hz).toBeGreaterThan(alu.hz * 1.5);

    // Apart, the baffle stands well out in front of where it sits assembled.
    const z0 = (await state()).frontZ;
    expect(await page<number>("qspeakers.explode(1)")).toBe(1);
    expect((await state()).frontZ).toBeGreaterThan(z0 + 0.03);

    // The pipe: a fold and its lining inside, and the loop through the box comes out quieter in the deep bass than with none.
    await page("qspeakers.pick('pipe-fullrange-8')");
    s = await state();
    expect(s.parts).toEqual(expect.arrayContaining(["fold", "lining"]));
    expect(s.cuts.map((c) => c.part)).toContain("fold divider");
    const boxed = await page<{ rms: number; engine: string }>("qspeakers.render('box')"), flat = await page<{ rms: number }>("qspeakers.render('flat')");
    expect(boxed.rms).toBeLessThan(flat.rms);
    expect(["rust", "ts"]).toContain(boxed.engine);
    // Knocked at the same level, aluminium walls keep ringing where birch dies away.
    const knock = () => page<{ peak: number; rms: number }>("qspeakers.render('knock')");
    const birch = await knock();
    await page("qspeakers.material('aluminium')");
    const metal = await knock();
    expect(metal.peak).toBeCloseTo(birch.peak, 1);
    expect(metal.rms).toBeGreaterThan(birch.rms * 2);
    // The cabinet leaves as a GLB, for Blender or any 3D tool.
    const file = await page<{ bytes: number; glb: string }>("qspeakers.glb()");
    expect(file.glb).toBe("glTF");
    expect(file.bytes).toBeGreaterThan(10_000);
    expect(tab.noise.filter((n) => !n.includes("fm_daw.wasm"))).toEqual([]);
    await tab.close();
  }
});
