// The cable feel test played end to end in headless Chrome, the way a player does it: every roll picked up, its end
// plugged in, the feeder bowled, the rest carried and plugged, 48 V switched on. It passes when the wedge is live.
//
//   bun apps/load-in/scripts/feel-journey.ts                 play it, print each run and the patch list
//   bun apps/load-in/scripts/feel-journey.ts --shot out.png  and a picture of the finished room
//
// Run it after a change to src/cables/roll.ts, src/feel/main.ts or the feel room's layout. It starts the app's dev
// server through `bun run probe`, so with the builder's valve shut it still runs here (it is not a test or a build).
import { join } from "node:path";

if (process.argv.includes("--help")) {
  console.log((await Bun.file(import.meta.path).text()).split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}
const JOURNEY = [
  "feel.start(); const log = []; const st = () => feel.state(); const go = (...pts) => { for (const [x, z] of pts) feel.walkTo(x, z); };",
  "const end = (k) => { const c = st().cables.find((c) => c.key === k); return `${k}: ${c.a} -> ${c.b} (${c.state}, ${c.leftM.toFixed(1)} m left)`; };",
  "go([-4.4, 4.6]); feel.look(Math.PI, -0.5); feel.use(); go([0, 5.2], [6.6, 2]); feel.use(); feel.look(Math.atan2(1.6, 4.58)); feel.bowl(1);",
  "let c = st().cables[0]; go([c.x + 0.5, c.z + 0.8]); feel.use(); go([5.0, -1.5]); feel.look(0, -0.6); feel.use(); feel.run(1); log.push(end(\"feeder\"));",
  "go([3, 2], [3, 5.0], [-2.0, 5.0], [-3.0, 4.6]); feel.look(Math.PI, -0.5); feel.use(); go([-2.5, 2.0], [0.35, 2.0]); feel.look(Math.PI, -0.3); feel.use();",
  "go([3, 1.0], [5.2, -1.6]); feel.look(0, -0.4); feel.use(); feel.run(1); log.push(end(\"desk-cable\"));",
  "go([3, 2], [3, 5.0], [-2.3, 4.6]); feel.look(Math.PI, -0.5); feel.use(); go([3, 5.0], [3, 2], [5.4, -1.6]); feel.look(0, -0.4); feel.use();",
  "go([3.5, -2.5], [-0.4, -4.4]); feel.look(Math.atan2(0.46, 0.6), -0.9); feel.use(); feel.run(1); log.push(end(\"speaker-cable\"));",
  "go([-5, -3.5], [-5, 4.6], [-3.7, 4.6]); feel.look(Math.PI, -0.5); feel.use(); go([-5, 4.6], [-5, -3.5], [0.8, -4.4]); feel.look(0, 0.2); feel.use();",
  "go([-1.5, -3.5], [-1.5, 2.0], [-0.35, 2.0]); feel.look(Math.PI, -0.3); feel.use(); feel.run(1); log.push(end(\"mic-cable\"));",
  "feel.phantom(); feel.run(1); go([2.5, 1.0]); feel.look(-0.5, -0.45); await new Promise((r) => setTimeout(r, 600));",
  "return { log, links: st().links.map((l) => `${l.ok ? \"ok\" : \"NO\"} ${l.text}`), phantom: st().phantom, done: st().done, said: st().said, holding: st().holding };"
].join(" ");
const shot = process.argv.indexOf("--shot"), args = ["bun", "scripts/probe.ts", "load-in", "/feel.html", "--size", "1280x800", "--js", JOURNEY];
if (shot >= 0 && process.argv[shot + 1]) args.push("--shot", process.argv[shot + 1]!);
const p = Bun.spawnSync(args, { cwd: join(import.meta.dir, "..", "..", ".."), stdout: "pipe", stderr: "pipe" });
const out = p.stdout.toString();
console.log(out.slice(out.indexOf("{")).trim() || p.stderr.toString().trim());
if (!/"done": true/.test(out)) { console.error("the wedge is not live: the feel room did not complete"); process.exit(1); }
