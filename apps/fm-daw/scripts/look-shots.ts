// The look climb's three camera spots (#5008), the same every round: `bun scripts/look-shots.ts <out dir> [--url http://localhost:5173]
// [--studio live-room] [--quality high|low]`. The corner by the front wall looking across the band, sitting at the keys, and sitting
// at the desk looking through the glass, each first person at 1280x720 through `bun run probe` (headless Chrome). Three PNGs.
import { $ } from "bun";

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : d);
const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "dist/look";
const url = arg("--url", "http://localhost:5173"), studio = arg("--studio", "live-room"), quality = arg("--quality", "high");
const settle = "await new Promise((r) => setTimeout(r, 1200)); return qjam.state().you;";
const firstPerson = "if (qjam.state().you.cam !== 'first') qjam.cam();";
const SPOTS: Record<string, string> = {
  corner: `qjam.start(); qjam.walkTo(4, 3.9); qjam.look(Math.PI / 4 - 0.05, -0.12); ${firstPerson} ${settle}`,
  keys: `qjam.start(); qjam.walkTo(2.6, 1.2); qjam.sit('keys'); qjam.look(0.35, -0.32); ${firstPerson} ${settle}`,
  // the desk sits behind the glass: in through the control room door at its right end
  desk: `qjam.start(); qjam.walkTo(3.6, -0.6); qjam.walkTo(3.6, -2.6); qjam.walkTo(0.2, -2.6); qjam.sit('desk'); qjam.look(Math.PI + 0.1, -0.12); ${firstPerson} ${settle}`,
};

await $`mkdir -p ${out}`;
for (const [spot, js] of Object.entries(SPOTS)) {
  const file = `${out}/${spot}.png`;
  const page = `/jam.html?room=look-climb&studio=${studio}&quality=${quality}${process.env.EXTRA ?? ""}`;
  const r = await $`bun ../../scripts/probe.ts fm-daw ${page} --url ${url} --size 1280x720 --settle 2500 --js ${js} --shot ${file}`.quiet().nothrow();
  console.log(r.exitCode ? `${file}: failed\n${r.stderr}` : file);
}
