// Recorded rides for a feel judge: `bun scripts/feel-rides.ts <out dir> [--url http://...] [--park half-dome]`.
// Each ride loads a park at a spawn the way a player does (the page settles, nobody touches anything for 4 s), then
// rides a fixed line through the agent tools (push, carve, ollie, a flick, jets), with a frame every second and the
// board's numbers every quarter second. Frames are `<ride>-<nn>.jpg`; `trace.json` has the numbers. A judge reads
// BEFORE (main) next to NOW (the branch).
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const out = resolve(process.argv[2] ?? "dist/feel");
const parks = (arg("--park") ?? "half-dome,yosemite-falls").split(",");
mkdirSync(out, { recursive: true });

const LINE = [
  { seconds: 2.5, push: 1 },
  { seconds: 1.5, push: 1, steer: 0.5 },
  { seconds: 0.9, push: 1, ollie: true },
  { seconds: 1.5, push: 1, steer: -0.4 },
  { seconds: 0.9, ollie: true, trick: "kickflip" },
  { seconds: 2, push: 1, jets: true },
  { seconds: 1.5, push: 0, steer: 0.6 },
  { seconds: 1, push: -1 },
];

const server = arg("--url") ? { url: arg("--url")!.replace(/\/?$/, "/"), stop: () => {} } : await startVite(resolve(import.meta.dir, ".."));
const chrome = await launchChrome();
const trace: Record<string, unknown[]> = {};
try {
  const tab = await openTab(chrome.cdp, { w: 960, h: 540 });
  for (const park of parks) {
    await load(chrome.cdp, tab, `${server.url}?level=${park}`, 5000);
    const spawns = await tab.eval<string[]>(`__commands.run("skate_parks", {}).then((r) => (r.starts ?? []).filter((s) => !["rail", "balance", "vert"].includes(s)))`).catch(() => [] as string[]);
    for (const spawn of spawns.slice(0, 3)) {
      const id = `${park}-${spawn.replace(/\W+/g, "-")}`, rows: unknown[] = (trace[id] = []);
      await tab.eval(`__commands.run("skate_start", { at: ${JSON.stringify(spawn)} })`);
      const riding = tab.eval(`new Promise((ok) => setTimeout(ok, 4000)).then(() => __commands.run("skate_line", { moves: ${JSON.stringify(LINE)} }))`);
      let done = false;
      riding.finally(() => { done = true; });
      for (let i = 0; !done && i < 120; i++) {
        if (i % 4 === 0) {
          const { data } = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 70 });
          await Bun.write(join(out, `${id}-${String(i / 4).padStart(2, "0")}.jpg`), Buffer.from(data, "base64"));
        }
        rows.push(await tab.eval(`__commands.run("skate_look", {}).then((r) => ({ kmh: r.kmh, doing: r.doing, at: r.at, last: r.last?.name ?? null }))`).catch(() => null));
        await Bun.sleep(250);
      }
      await riding;
      console.log(`${id}: ${rows.length} samples`);
    }
  }
  await Bun.write(join(out, "trace.json"), JSON.stringify(trace));
  if (tab.noise.length) console.log(tab.noise.slice(0, 10).join("\n"));
} finally {
  chrome.stop();
  server.stop();
}
