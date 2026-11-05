// The menu hill climb's shots (#3543): the front, the lobby, the Controls panel and a results card, at a phone, a tablet
// and a laptop, by day and after dark. Start the dev server first (`bunx vite --port 5391`), then
//   bun scripts/menu-shots.ts docs/shots-2026-11-04/before [--url http://127.0.0.1:5391]
// Each shot is one `bun run probe` call against that server; the results card is filled with a made-up round,
// because reaching a real one takes three minutes of play.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith("--")) ?? "docs/shots");
const url = args.includes("--url") ? args[args.indexOf("--url") + 1]! : "http://127.0.0.1:5391";
const root = resolve(import.meta.dir, "../../..");
mkdirSync(out, { recursive: true });

const wait = "await new Promise((r) => setTimeout(r, 900));";
const RESULTS = `<h3>Round 2: Tunnel View</h3><table><tr><td>Juniper (you)</td><td>camped out!</td><td>+180</td></tr><tr><td>Osprey</td><td>ranger · 2 caught</td><td>+100</td></tr><tr><td>Marmot</td><td>caught after 74 s</td><td>+74</td></tr><tr><td>Pika</td><td>caught after 31 s</td><td>+31</td></tr></table><p class="note">Next round in a few seconds…</p>`;
const tod = (t: string) => `window.parkHideSeek?.poster?.(${JSON.stringify(t)});`;

const SCREENS: Record<string, string> = {
  front: "",
  lobby: `document.getElementById("custom").click(); ${wait}`,
  settings: `document.querySelector(".gc-cog")?.click(); ${wait}`,
  results: `document.getElementById("menu").hidden = true; const r = document.getElementById("results"); r.hidden = false; const m = await import("/src/ui/poster.ts"); document.getElementById("results-body").innerHTML = m.permitHead("tunnel:1") + ${JSON.stringify(RESULTS)} + m.stampHtml("Camped out");`,
};
const SIZES: [string, string[]][] = [["phone", ["--mobile"]], ["tablet", ["--size", "820x1180"]], ["laptop", ["--size", "1280x800"]]];

for (const t of ["day", "night"]) {
  for (const [screen, js] of Object.entries(SCREENS)) {
    for (const [size, flags] of SIZES) {
      if (t === "night" && size === "tablet") continue;
      const file = `${out}/${screen}-${size}-${t}.jpg`;
      const p = Bun.spawnSync(["bun", "scripts/probe.ts", "park-hide-seek", "/", "--url", url, ...flags, "--settle", "2500",
        "--js", `${tod(t)} ${js} await new Promise((r) => setTimeout(r, 400)); return "ok";`, "--shot", file], { cwd: root });
      const said = p.stdout.toString().trim().split("\n").slice(-2).join(" ");
      console.log(`${p.exitCode === 0 ? "shot" : "FAIL"} ${screen}-${size}-${t}${p.exitCode === 0 ? "" : `: ${said}`}`);
    }
  }
}
