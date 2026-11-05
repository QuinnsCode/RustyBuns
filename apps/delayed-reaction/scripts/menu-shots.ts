// The menus at every screen size, for a UI round: `bun scripts/menu-shots.ts <out dir> [--url http://localhost:5173]`.
// Title, level select (the menu scrolled to its end), settings (the cog's dialog) and results (a finished run, through
// `delayedReaction.result`, so the shot shows a run with numbers rather than one left before the first call),
// each at a phone, a phone on its side and a desktop, through `bun run probe` (headless Chrome). Twelve PNGs.
import { $ } from "bun";

const out = process.argv[2] ?? "dist/shots";
const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1]! : "http://localhost:5173";
const wait = (ms: number) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const SCREENS: Record<string, string> = {
  title: "return 1",
  levels: `document.getElementById("menu").scrollTop = 1e5; ${wait(200)} return 1;`,
  settings: `document.querySelector("#controls-host button").click(); ${wait(500)} return 1;`,
  results: `delayedReaction.result({ level: 3, score: 4820, perfects: 31, hits: 44, misses: 5, maxCombo: 22, over: "won" }); ${wait(1800)} return 1;`,
};
const SIZES: Record<string, string[]> = { phone: ["--mobile"], "phone-side": ["--mobile", "--size", "844x390"], desktop: ["--size", "1280x720"] };

await $`mkdir -p ${out}`;
for (const [screen, js] of Object.entries(SCREENS))
  for (const [size, flags] of Object.entries(SIZES)) {
    const file = `${out}/${screen}-${size}.png`;
    await $`bun ../../scripts/probe.ts delayed-reaction --url ${url} ${flags} --settle 1500 --js ${js} --shot ${file}`.quiet().nothrow();
    console.log(file);
  }
