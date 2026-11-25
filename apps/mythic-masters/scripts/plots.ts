// The plot lines picks page: every thread in the story bible (content/story.json plus the beats the game already plays)
// as one card with its beats down the road, a lane chart of where each thread runs, and Keep / Maybe / Cut buttons with a
// note on each thread and each unbuilt beat. The page is scripts/plots-page.html; this writes its data beside it.
//
//   bun run plots <dir>      write <dir>/index.html and <dir>/plots.json (then publish <dir>/index.html as an artifact
//                            with plots.json beside it; picks live in the artifact's db under picks/t-<arc> and picks/b-<beat>)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkStory, resolve, type Report } from "../src/story/check.ts";
import { KINDS } from "../src/story/model.ts";
import { regionOf, roadOrder } from "../src/story/infer.ts";
import { help } from "../../../scripts/help.ts";

const BLURB: Record<(typeof KINDS)[number], string> = {
  main: "The Book's ledger, region to region. You can't finish the game without it.",
  sub: "Threads that run beside the main story over several regions: a faction, a person, a mystery.",
  side: "One place, one evening: a sighting board, a job for a believer, a night on a fire tower.",
  unlock: "What opens the next thing: a road, a line-up slot, a tool you carry. Each sits at a level.",
};

/** The page's data: regions in road order, the four kinds, and each thread with its beats placed on the road. */
export function plotsData(r: Report) {
  const road = roadOrder().map(({ n }) => n);
  const arcOf = new Map(r.beats.map((b) => [b.id, b.arc]));
  const items = r.arcs.map((a) => {
    const beats = r.beats.filter((b) => b.arc === a.id).map((b) => {
      const w = resolve(b.at);
      return {
        id: b.id, title: b.title, text: b.text, status: b.status, owner: !!b.owner, game: !!b.game,
        col: w ? road.indexOf(w.region) : -1, level: w?.level ?? null, where: w?.label ?? b.at,
        opens: b.opens ?? "", needs: b.needs ?? [], fights: b.fights ?? [],
      };
    }).sort((x, y) => x.col - y.col || (x.level ?? 0) - (y.level ?? 0));
    const ties = [...new Set(beats.flatMap((b) => b.needs.map((n) => arcOf.get(n)).filter((t): t is string => !!t && t !== a.id)))];
    return { id: a.id, g: a.kind, title: a.title, pitch: a.pitch, game: a.game, ties, beats };
  });
  return {
    score: r.score,
    regions: road.map((n) => regionOf(n)!.name),
    groups: KINDS.map((k) => ({ key: k, title: k, blurb: BLURB[k] })),
    items,
  };
}

if (import.meta.main) {
  help(import.meta.path);
  const out = process.argv[2];
  if (!out) { console.error("usage: bun run plots <dir>"); process.exit(1); }
  const root = join(import.meta.dir, "..");
  const r = checkStory(JSON.parse(readFileSync(join(root, "content/story.json"), "utf8")) as unknown);
  if (r.problems.length) { for (const p of r.problems) console.error(`PROBLEM ${p}`); process.exit(1); }
  mkdirSync(out, { recursive: true });
  const data = plotsData(r);
  writeFileSync(join(out, "plots.json"), JSON.stringify(data));
  copyFileSync(join(import.meta.dir, "plots-page.html"), join(out, "index.html"));
  console.log(`${data.items.length} threads, ${r.beats.length} beats -> ${out}/index.html + plots.json`);
}
