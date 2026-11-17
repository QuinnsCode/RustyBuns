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

// Where to stand for each jack's owner: a lane behind the booth (z 0.75), the case, the tops' stands, by the sub.
const WIRE = `
const L = loadIn, LANE = 0.75, fail = [];
L.start();
const STAND = { case: [2.45, 1.2], "deck-1": [0.4, LANE], "deck-2": [-0.4, LANE], mixer: [0, LANE], distro: [0.6, LANE], "wall-1": [-1.2, LANE],
  "wall-2": [1.2, LANE], rack: [-2.2, LANE], "mon-l": [0.9, LANE], "mon-r": [-0.9, LANE], "top-l": [2.45, 1.2], "top-r": [-2.1, 1.0], sub: [-0.7, 2.6] };
const go = (to) => {
  const [x, z] = STAND[to], you = L.state().you, out = you.z > 2;
  // The room side goes round the left end of the booth, past the rack's stand-off.
  if (out) L.walkTo(-2.1, 2.6), L.walkTo(-2.1, LANE);
  L.walkTo(you.x > 2.2 && !out ? 2.3 : L.state().you.x, LANE);
  if (to === "sub") return L.walkTo(-2.1, LANE), L.walkTo(-2.1, 2.6), L.walkTo(x, z);
  L.walkTo(Math.min(x, 2.3), LANE);
  L.walkTo(x, z);
};
const run = (kind, a, b) => {
  const [ao, aj] = a.split(" "), [bo, bj] = b.split(" ");
  go("case");
  // The case hands out the first coiled cable of a kind.
  const key = L.state().cables.find((c) => c.kind === kind && c.coiled)?.key;
  let r = L.takeCable(kind);
  if (!r.ok) return fail.push(kind + ": " + r.why);
  go(ao); r = L.plug(ao, aj);
  if (!r.ok) return fail.push(a + ": " + r.why), L.dropEnd();
  go("case"); r = L.grabEnd(key, "b");
  if (!r.ok) return fail.push(key + " b: " + r.why);
  go(bo); r = L.plug(bo, bj);
  if (!r.ok) fail.push(b + ": " + r.why), L.dropEnd();
};
run("power", "wall-2 power-out-1", "distro power-in");
for (const [i, k] of ["deck-1", "deck-2", "mixer", "mon-l", "mon-r"].entries()) run("power", "distro power-out-" + (i + 1), k + " power-in");
run("power", "wall-2 power-out-2", "top-l power-in");
run("power", "wall-1 power-out-1", "rack power-in");
run("power", "wall-1 power-out-2", "top-r power-in");
run("rca", "deck-1 rca-out", "mixer IN-2");
run("rca", "deck-2 rca-out", "mixer IN-3");
if (L.state().decks.kind === "vinyl") run("ground", "deck-1 ground-out", "mixer ground-in-1"), run("ground", "deck-2 ground-out", "mixer ground-in-2");
run("xlr", "mixer xlr-out-3", "mon-l xlr-in");
run("xlr", "mixer xlr-out-4", "mon-r xlr-in");
run("xlr", "mixer xlr-out-1", "top-l xlr-in");
run("xlr", "top-l xlr-out", "rack xlr-in-1");
run("xlr", "mixer xlr-out-2", "top-r xlr-in");
run("speaker", "rack speaker-out-1", "sub speaker-in");
for (const k of ["deck-1", "deck-2", "mixer", "mon-l", "mon-r", "top-l", "top-r", "rack", "sub"]) L.power(k, true);
// Back round the left end of the booth to the DJ's spot.
L.walkTo(-2.1, 2.6); L.walkTo(-2.1, LANE);
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
