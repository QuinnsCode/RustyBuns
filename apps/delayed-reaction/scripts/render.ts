// Render the music offline and judge what can be judged without ears.
//   bun scripts/render.ts [?level=5&bpm=140&delay=6&beat=0&setup=snap] [--bars 64] [--out dist/stems] [--check] [--all]
// A headless Chrome runs scripts/render-page.ts (the same Music the game plays, on an OfflineAudioContext),
// posts each stem back here, and this writes WAVs (mix, drums, bass, synth, dub) and prints levels, clipping,
// stereo width and how far the kicks sit from the tempo grid. --check exits 1 when a number is out of range.
// --all renders every setup in src/dub.ts, each into its own folder under --out, and prints one row per track.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kickCount, setupNamed, SETUPS } from "../src/dub.ts";
import { kicks, offGrid, row, wav, type Row, type Take } from "../src/stems.ts";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : dflt; };
const query = args.find((a) => a.startsWith("?")) ?? "";
const bars = flag("--bars", ""), out = flag("--out", "dist/stems"), check = args.includes("--check"), all = args.includes("--all");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const built = await Bun.build({ entrypoints: [new URL("./render-page.ts", import.meta.url).pathname], target: "browser" });
if (!built.success) throw new Error(built.logs.join("\n"));
const js = await built.outputs[0]!.text();

type Posted = Take & { bpm: number; delay: number; from: number; bars: number; setup: string };
const takes = new Map<string, Posted>();
let finish!: (err?: string) => void;
let done = new Promise<void>((ok, bad) => { finish = (err) => (err ? bad(new Error(err)) : ok()); });
const server = Bun.serve({
  port: 0,
  maxRequestBodySize: 1024 ** 3, // a 128-bar stem at 86 bpm is 130 MB of float32

  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/") return new Response(`<!doctype html><script type="module" src="/page.js"></script>`, { headers: { "content-type": "text/html" } });
    if (u.pathname === "/page.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
    if (u.pathname === "/stem") {
      const all = new Float32Array(await req.arrayBuffer()), n = all.length / 2, p = u.searchParams;
      takes.set(p.get("name")!, { l: all.slice(0, n), r: all.slice(n), rate: Number(p.get("rate")), bpm: Number(p.get("bpm")), delay: Number(p.get("delay")), from: Number(p.get("from")), bars: Number(p.get("bars")), setup: p.get("setup") ?? "" });
    } else if (u.pathname === "/done") finish();
    else if (u.pathname === "/fail") finish(await req.text());
    return new Response("ok");
  },
});

/** Render one query's stems into `dir`, print its report, and return what failed. */
async function render(q: string, dir: string): Promise<string[]> {
  takes.clear();
  done = new Promise<void>((ok, bad) => { finish = (err) => (err ? bad(new Error(err)) : ok()); });
  const profile = join(process.env.TMPDIR ?? "/tmp", `dr-render-${process.pid}`);
  const chrome = Bun.spawn([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
    "--autoplay-policy=no-user-gesture-required", `http://127.0.0.1:${server.port}/?${bars ? `bars=${bars}` : ""}${q.replace("?", "&")}`], { stdout: "ignore", stderr: "ignore" });
  const timer = setTimeout(() => finish("timed out after 20 minutes"), 1_200_000);
  try { await done; } finally { clearTimeout(timer); chrome.kill(); }

  mkdirSync(dir, { recursive: true });
  const rows: Row[] = [];
  for (const [name, take] of takes) { writeFileSync(join(dir, `${name}.wav`), wav(take)); rows.push(row(name, take)); }
  const fmt = (n: number) => (n <= -179 ? "  -inf" : n.toFixed(1).padStart(6));
  console.log("stem    peak dB  rms dB  clipped  width dB  <120Hz");
  for (const r of rows) console.log(`${r.stem.padEnd(7)} ${fmt(r.peakDb)}  ${fmt(r.rmsDb)}  ${String(r.clipped).padStart(7)}  ${fmt(r.widthDb)}   ${(r.lowShare * 100).toFixed(0).padStart(5)}%`);

  const drums = takes.get("drums")!, mix = takes.get("mix")!, setup = setupNamed(drums.setup);
  const hits = kicks(drums.l, drums.rate), spb = 60 / drums.bpm;
  const first = (drums.from ? 0 : 4) * spb; // the clock's zero is the count-in; a jump-in starts on its beat
  // A setup's pickup kick sits on the and of four, so its grid is eighths; the fixed loop kicks on beats.
  const grid = offGrid(hits, setup ? drums.bpm * 2 : drums.bpm, drums.from ? -drums.from * spb % spb : first);
  // The fixed loop kicks on every one and the four of every fourth bar; a setup's track kicks where its arrangement says.
  const want = setup ? kickCount(setup) : drums.bars + Math.floor(drums.bars / 4);
  console.log(`\nkicks: ${hits.length} found${drums.from ? "" : `, ${want} expected`}; worst ${grid.toFixed(2)} ms off the ${drums.bpm} bpm grid`);

  const fails: string[] = [];
  const m = rows.find((r) => r.stem === "mix")!, d = rows.find((r) => r.stem === "drums")!;
  if (m.peakDb > -1) fails.push(`mix peaks at ${m.peakDb.toFixed(1)} dBFS (limit -1)`);
  if (m.clipped) fails.push(`mix clips ${m.clipped} samples`);
  if (Math.abs(m.dc) > 0.01) fails.push(`mix DC offset ${m.dc.toFixed(4)}`);
  if (d.widthDb > -60) fails.push(`drums are not mono (${d.widthDb.toFixed(1)} dB side-to-mid)`);
  if (grid > 3) fails.push(`kicks are ${grid.toFixed(1)} ms off the tempo grid (limit 3)`);
  if (!drums.from && hits.length !== want) fails.push(`${hits.length} kicks, expected ${want}`);
  if (mix.l.length / mix.rate < (drums.bars * 4 - drums.from) * spb) fails.push("mix shorter than the song");
  console.log(fails.length ? `\nFAILED\n${fails.map((f) => `  ${f}`).join("\n")}` : "\nall numbers in range");
  console.log(`\nwrote ${[...takes.keys()].map((k) => `${dir}/${k}.wav`).join(", ")}\n`);
  return fails;
}

const failed: string[] = [];
try {
  if (all) {
    for (const s of SETUPS) {
      console.log(`== ${s.name}: ${s.bpm} bpm, ${s.bars} bars, ${s.back} on the three, delay on the ${s.echo} ==`);
      const fails = await render(`?setup=${s.name}${query.replace("?", "&")}`, join(out, s.name));
      if (fails.length) failed.push(`${s.name}: ${fails.join("; ")}`);
    }
    console.log(failed.length ? `${SETUPS.length - failed.length} of ${SETUPS.length} tracks in range\n${failed.map((f) => `  ${f}`).join("\n")}` : `all ${SETUPS.length} tracks in range`);
  } else failed.push(...await render(query, out));
} finally { server.stop(true); }
if (check && failed.length) process.exit(1);
