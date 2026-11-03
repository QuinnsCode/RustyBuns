// Records the stadium crowd: `bun run crowd [--seed n] [--cast n]`. Casts people with codeSplitter's avatar maker
// (@rustybuns/util/avatar, the same parts a profile picks from) and samples each cheer below into keyframes, then
// writes both to src/crowd.json. The game only reads that file: it plays the frames on the GPU and never runs these
// functions, so an approved take stays exactly as it was looked at. Edit a cast member or a clip there by hand, or
// change a take here and re-record; `?crowd=<clip>` in the game shows the stands doing it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mulberry32 } from "@rustybuns/util";
import { randomAvatar, type Avatar } from "@rustybuns/util/avatar";

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SEED = arg("--seed", 7), CAST = arg("--cast", 32);
/** Keyframes per loop of a clip. The GPU blends between neighbours, so this only has to catch each turn. */
export const FRAMES = 24;

/** One pose: how far the body bobs up (m, model scale) and leans toward the ring (rad), and each arm's raise out to the
 * side (`lat`, 0 hanging, ~2.9 straight up) and forward toward the ring (`fwd`). */
type Pose = { bob: number; lean: number; latL: number; fwdL: number; latR: number; fwdR: number };
const TAU = Math.PI * 2, up = (x: number) => Math.max(0, x);

/** The takes: what a person does over one loop (`p` 0..1), how long a loop is, and how many in the stands do it. */
const TAKES: { name: string; seconds: number; weight: number; pose: (p: number) => Pose }[] = [
  { name: "arms-up", seconds: 0.9, weight: 4, pose: (p) => { const s = Math.sin(TAU * p); return { bob: 0.03 * Math.abs(s), lean: 0.05, latL: 2.6 + 0.25 * s, fwdL: 0.25, latR: 2.6 - 0.25 * s, fwdR: 0.25 }; } },
  { name: "clap", seconds: 0.8, weight: 3, pose: (p) => { const s = Math.sin(TAU * 2 * p); return { bob: 0.01 * s, lean: 0.12, latL: -0.2 + 0.28 * s, fwdL: 1.25, latR: -0.2 + 0.28 * s, fwdR: 1.25 }; } },
  { name: "wave", seconds: 1.1, weight: 2, pose: (p) => ({ bob: 0, lean: 0, latL: 0.12, fwdL: 0, latR: 2.35 + 0.45 * Math.sin(TAU * p), fwdR: 0.15 }) },
  { name: "fist-pump", seconds: 0.6, weight: 2, pose: (p) => { const k = up(Math.sin(TAU * p)); return { bob: 0.03 * k, lean: 0.08, latL: 0.3, fwdL: 0.4, latR: 1.7 + 1.1 * k, fwdR: 0.3 }; } },
  { name: "jump", seconds: 0.7, weight: 1, pose: (p) => { const k = up(Math.sin(TAU * p)); return { bob: 0.16 * k, lean: 0, latL: 2.2 + 0.5 * k, fwdL: 0.1, latR: 2.2 + 0.5 * k, fwdR: 0.1 }; } },
];

const round = (x: number) => Math.round(x * 1000) / 1000;
const clips = TAKES.map((t) => ({
  name: t.name, seconds: t.seconds, weight: t.weight,
  frames: Array.from({ length: FRAMES }, (_, i) => { const q = t.pose(i / FRAMES); return [q.bob, q.lean, q.latL, q.fwdL, q.latR, q.fwdR].map(round); }),
}));

// The cast: shapes and faces (hair, hat, build, top, eyes, mouth, glasses). Each seat recolours its person from the
// same palettes, so 32 cast members fill a thousand seats without two neighbours matching.
const rnd = mulberry32(SEED), cast: Avatar[] = [];
const seen = new Set<string>();
while (cast.length < CAST) {
  const a = randomAvatar(rnd), key = `${a.hair}/${a.hat}/${a.build}/${a.top}`;
  if (seen.has(key)) continue;
  seen.add(key); cast.push(a);
}

const out = join(import.meta.dir, "..", "src", "crowd.json");
writeFileSync(out, JSON.stringify({ seed: SEED, frames: FRAMES, clips, cast }, null, 1) + "\n");
console.log(`crowd: ${cast.length} cast, ${clips.length} clips (${clips.map((c) => c.name).join(", ")}) -> src/crowd.json`);
