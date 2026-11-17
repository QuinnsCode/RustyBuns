// The DJ booth wired and playing, photographed: each shot loads the level in headless Chrome (bun run probe), lays every
// cable the way a player would through the harness (to the case, take one, carry it, plug it in), switches it all on,
// starts both decks, and shoots from the DJ's spot or out in the room. Prints the booth's state after wiring.
//
//   bun apps/load-in/scripts/booth-shots.ts                   into apps/load-in/docs/shots-2026-11-17-decks/
//   bun apps/load-in/scripts/booth-shots.ts --out /tmp/x      somewhere else
//   bun apps/load-in/scripts/booth-shots.ts --only dj-vinyl   one shot
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const argv = process.argv.slice(2), flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const out = resolve(flag("--out") ?? join(import.meta.dir, "..", "docs", "shots-2026-11-17-decks")), only = flag("--only");
mkdirSync(out, { recursive: true });

// The wiring itself is the app's own (src/venues/dj-booth-wire.ts, `loadIn.wireBooth()`): the same steps `?wired=1` runs.
const WIRE = `
const L = loadIn;
L.start();
const fail = L.wireBooth();
L.decks.play(1); L.decks.play(2); L.decks.fader(2, 0.9); L.decks.fader(3, 0.7); L.decks.cross(-0.3); L.decks.pitch(2, -3.1);
await new Promise((r) => setTimeout(r, 2500));
`;

const shots = [
  { name: "dj-vinyl", level: "dj-booth", size: "1280x800", at: "L.walkTo(0, 0.75); L.look(180, -42);" },
  { name: "dj-media", level: "dj-booth-media", size: "1280x800", at: "L.walkTo(0, 0.75); L.look(180, -42);" },
  { name: "room-vinyl", level: "dj-booth", size: "1280x800", at: "L.walkTo(-2.1, 2.6); L.walkTo(0.3, 5.6); L.look(0, -8);" },
  { name: "dj-vinyl-phone", level: "dj-booth", size: "390x844", at: "L.walkTo(0, 0.75); L.look(180, -48);" },
  { name: "room-media-phone", level: "dj-booth-media", size: "390x844", at: "L.walkTo(-2.1, 2.6); L.walkTo(0.3, 5.6); L.look(0, -8);" },
];

for (const s of shots.filter((s) => !only || s.name === only)) {
  const js = `${WIRE.replaceAll("IN-", s.level === "dj-booth" ? "phono-in-" : "rca-in-")}\n${s.at}\nawait new Promise((r) => setTimeout(r, 600));\nconst d = L.state().decks;\nreturn { fail, decks: d.decks.map((k) => [k.playing, k.channel]), mix: d.mix, live: d.live, problems: d.problems, fed: L.state().sound.speakers.filter((x) => x.fed).map((x) => x.key) };`;
  const file = join(out, `${s.name}.png`);
  const p = Bun.spawnSync(["bun", "scripts/probe.ts", "load-in", `/?level=${s.level}`, "--size", s.size, "--js", js, "--shot", file], { cwd: join(import.meta.dir, "..", "..", ".."), stdout: "pipe", stderr: "pipe" });
  console.log(`${s.name}: ${file}\n${p.stdout.toString().trim()}${p.exitCode ? `\n${p.stderr.toString().trim()}` : ""}`);
}
