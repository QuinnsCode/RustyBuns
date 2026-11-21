// A Thanksgiving pie for mpl (github.com/ivarvong/mpl): the chart types in its own code, drawn with its own
// brand-new `ax.pie` (ivarvong/mpl#85). Each slice is how many of mpl's pixel-exact reference fixtures
// (`fixtures/ref/*.json`) call that chart type.
//
//   bun notes/mpl-pie/pie.ts [out.png]   clones mpl at PIN into a temp folder, counts, draws (default notes/mpl-pie/pie.png)
//
// mpl isn't on npm (the `mpl` package there is someone else's), so this reads its source straight from a clone.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../scripts/help.ts";

help(import.meta.path);

/** mpl's main right after #85 (pie) merged. */
const PIN = "689ebd4383c0f55b4219e73303f0b1dea6660bbf";
/** The plotting calls in mpl's Axes API that draw a chart (docs/api.md), not lines or text laid on one. */
const CHARTS = ["plot", "step", "errorbar", "hist", "boxplot", "pie", "bar", "barh", "fill_between", "imshow", "scatter"];
/** tab10 for the other ten chart types; pie gets pumpkin. */
const TAB10 = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
const PUMPKIN = "#C8601A";

const out = process.argv[2] ?? join(import.meta.dir, "pie.png");
const dir = mkdtempSync(join(tmpdir(), "mpl-pie-"));
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: dir, stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
};
git("init", "-q");
git("fetch", "-q", "--depth", "1", "https://github.com/ivarvong/mpl.git", PIN);
git("checkout", "-q", "FETCH_HEAD");

/** Every chart type a fixture's spec calls, at any depth (a spec nests calls per axes). */
function called(v: unknown, hit: Set<string>): Set<string> {
  if (Array.isArray(v)) {
    if (typeof v[0] === "string" && CHARTS.includes(v[0])) hit.add(v[0]);
    for (const x of v) called(x, hit);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) called(x, hit);
  return hit;
}

const refs = join(dir, "fixtures/ref");
const fixtures = readdirSync(refs).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const tally = new Map<string, number>();
for (const f of fixtures) {
  const fixture: unknown = JSON.parse(readFileSync(join(refs, f), "utf8"));
  const spec = fixture && typeof fixture === "object" && "spec" in fixture ? fixture.spec : null;
  for (const c of called(spec, new Set())) tally.set(c, (tally.get(c) ?? 0) + 1);
}
const counts = [...tally].sort((a, b) => b[1] - a[1]);

const { subplots, registerFonts } = await import(join(dir, "src/index.ts"));
const { dejavuSansBold } = await import(join(dir, "src/fonts/dejavu-sans-bold.ts"));
registerFonts(dejavuSansBold);

let next = 0;
const colors = counts.map(([k]) => (k === "pie" ? PUMPKIN : TAB10[next++ % TAB10.length]));
const [fig, ax] = subplots({ figsize: [12, 7], dpi: 120, rc: { "figure.subplot.left": 0.02, "figure.subplot.right": 0.6 } });
ax.pie(counts.map(([, n]) => n), {
  colors,
  startangle: 90,
  labels: counts.map(([k]) => (k === "pie" ? "pie (new!)" : "")),
  explode: counts.map(([k]) => (k === "pie" ? 0.18 : 0)),
  wedgeprops: { edgecolor: "white", linewidth: 1.5 },
});
fig.suptitle("Happy Thanksgiving, mpl: a pie of your own chart types", { fontsize: 18, fontweight: "bold" });
fig.text(0.5, 0.03, `Slice = how many of mpl's ${fixtures.length} pixel-exact fixtures use each chart type. Drawn with ax.pie from mpl #85.`, {
  ha: "center",
  fontsize: 11,
  color: "#555555",
});

// The legend sits in its own empty axes to the right: one zero-height bar per slice carries the label and colour.
const key = fig.addAxesAt([0.62, 0.15, 0.98, 0.85]);
counts.forEach(([k, n], i) => key.bar([0], [0], { color: colors[i], label: `${k}  (${n})` }));
key.legend({ loc: "center", frameon: false, fontsize: 13 });
key.set_xticks([]);
key.set_yticks([]);
for (const s of Object.values(key.spines)) (s as { set_visible(b: boolean): void }).set_visible(false);

await Bun.write(out, await fig.toPNG());
console.log(`${out}: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")} (${fixtures.length} fixtures)`);
