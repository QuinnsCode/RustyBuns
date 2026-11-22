// The story bible (content/story.json, shape in src/story/model.ts): checks it against the game, scores the story card
// and writes docs/STORY.md and docs/story.html, the map of every thread.
//
//   bun run story            check, print the card, write docs/STORY.md and docs/story.html
//   bun run story --check    the same, but change nothing: fail on a problem or on docs that are out of date (CI)
//   bun run story --serve    the map at http://localhost:4706 with every written beat editable; Save checks first
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkStory, resolve, type Report } from "../src/story/check.ts";
import { KINDS, WANTS } from "../src/story/model.ts";
import { regionOf, roadOrder } from "../src/story/infer.ts";
import { sectionLevel } from "../src/journey.ts";
import { storyPage } from "./story-page.ts";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const ROOT = join(import.meta.dir, ".."), JSON_PATH = join(ROOT, "content/story.json");
const MD = join(ROOT, "docs/STORY.md"), HTML = join(ROOT, "docs/story.html");

export function storyMarkdown(r: Report): string {
  const out: string[] = [];
  const beat = (id: string) => r.beats.find((b) => b.id === id);
  out.push("# The story bible", "",
    "<!-- Written by `bun run story` from content/story.json and the game's own files. Edit those, not this. -->", "",
    "Every storyline in Mythic Masters, region by region down the road. The words live in `content/story.json` (edit by hand,",
    "in `bun run cms`, or on the map with `bun run story --serve`); the shape is `src/story/model.ts`; beats the game already",
    "plays (each mythic, the faction quests, the sighting boards, the roads) are read from the game itself (`src/story/infer.ts`),",
    "so this page can't drift from it. `bun run story --check` runs in the app's tests: a beat that names a place, a beast or",
    "another beat that doesn't exist fails CI.", "",
    "Open `docs/story.html` for the map: regions as columns, the four kinds as rows, threads drawn between beats.", "",
    "- **main**: the Book's ledger, region to region. **sub**: a thread over several regions. **side**: one place, one evening.",
    "  **unlock**: what opens the next thing (a road, a line-up slot, a tool), at a level.",
    "- **idea** is written down, **approved** the owner said yes, **built** the game plays it. Beats marked *owner* are the",
    "  owner's to write (anything about what the Book is).", "");
  out.push("## Story card", "", "| | check | rate | points |", "| --- | --- | --- | --- |",
    ...r.card.map((c) => `| ${c.id} | ${c.what} | ${(c.rate * 100).toFixed(0)}% | ${c.points.toFixed(2)} |`), `| | **total** | | **${r.score.toFixed(2)} of 5** |`, "");
  if (r.problems.length) out.push("## Problems", "", ...r.problems.map((p) => `- ${p}`), "");
  if (r.clashes.length) out.push("## Where the game disagrees with itself", "", "Read from the game, not the JSON: each is an issue to fix in the game.", "", ...r.clashes.map((p) => `- ${p}`), "");
  out.push("## Threads", "", "| thread | kind | beats | built | pitch |", "| --- | --- | --- | --- | --- |",
    ...r.arcs.map((a) => { const bs = r.beats.filter((b) => b.arc === a.id);
      return `| ${a.title}${a.game ? " *(game)*" : ""} | ${a.kind} | ${bs.length} | ${bs.filter((b) => b.status === "built").length} | ${a.pitch.replace(/\|/g, "/")} |`; }), "");
  const areas = r.story?.areas ?? [];
  roadOrder().forEach(({ n }, i) => {
    const g = regionOf(n)!, here = r.beats.filter((b) => resolve(b.at)?.region === n);
    out.push(`## ${i + 1}. ${g.name}`, "", `Region ${n}, from level ${sectionLevel(n, 0)}.`, "");
    const a = areas.find((x) => x.region === g.id);
    if (a) out.push(`*${a.feel}*`, "");
    for (const k of KINDS) {
      const bs = here.filter((b) => b.kind === k).sort((x, y) => (resolve(x.at)?.level ?? 0) - (resolve(y.at)?.level ?? 0));
      if (!bs.length) continue;
      out.push(`**${k}**`, "");
      for (const b of bs) {
        const w = resolve(b.at)!, needs = (b.needs ?? []).map((id) => beat(id)?.title ?? id);
        out.push(`- **${b.title}** (${w.label}${w.level ? `, level ${w.level}` : ""}; ${b.status}${b.owner ? ", owner writes" : ""}${b.game ? ", from the game" : ""}). ${b.text}` +
          (b.opens ? ` *Opens: ${b.opens}.*` : "") + (needs.length ? ` *After: ${needs.join(", ")}.*` : ""));
      }
      out.push("");
    }
    if (a) {
      out.push("**world**", "");
      for (const k of WANTS) for (const w of a.world.filter((x) => x.kind === k)) out.push(`- [${w.status === "built" ? "x" : " "}] ${k}: ${w.what}`);
      out.push("");
    }
  });
  out.push("## Threads as a graph", "", "The written threads and what they wait on (game beats in square boxes).", "", "```mermaid", "flowchart LR");
  const written = r.beats.filter((b) => !b.game), shown = new Set(written.map((b) => b.id));
  for (const b of written) for (const n of b.needs ?? []) shown.add(n);
  const node = (id: string) => { const b = beat(id)!; const t = b.title.replace(/"/g, "'"); return b.game ? `${id.replace(/-/g, "_")}["${t}"]` : `${id.replace(/-/g, "_")}("${t}")`; };
  for (const a of r.arcs.filter((x) => !x.game)) {
    out.push(`  subgraph ${a.id.replace(/-/g, "_")}_arc ["${a.title.replace(/"/g, "'")}"]`);
    for (const b of written.filter((x) => x.arc === a.id)) out.push(`    ${node(b.id)}`);
    out.push("  end");
  }
  for (const id of shown) if (beat(id)?.game) out.push(`  ${node(id)}`);
  for (const b of written) for (const n of b.needs ?? []) out.push(`  ${n.replace(/-/g, "_")} --> ${b.id.replace(/-/g, "_")}`);
  out.push("```", "");
  return out.join("\n");
}

const read = () => JSON.parse(readFileSync(JSON_PATH, "utf8")) as unknown;
function report(r: Report) {
  for (const c of r.card) console.log(`${c.id}  ${c.points.toFixed(2)}  ${c.what} (${(c.rate * 100).toFixed(0)}%)`);
  console.log(`story card ${r.score.toFixed(2)} of 5, ${r.beats.length} beats in ${r.arcs.length} threads`);
  for (const c of r.clashes) console.log(`game: ${c}`);
  for (const p of r.problems) console.log(`PROBLEM ${p}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2), r = checkStory(read());
  report(r);
  if (args.includes("--serve")) {
    const server = Bun.serve({
      port: 4706,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/save") {
          let json: unknown;
          try { json = JSON.parse(await req.text()); } catch { return Response.json({ ok: false, problems: ["not JSON"] }); }
          const next = checkStory(json);
          if (next.problems.length) return Response.json({ ok: false, problems: next.problems });
          writeFileSync(JSON_PATH, JSON.stringify(json, null, 2) + "\n");
          writeFileSync(MD, storyMarkdown(next)); writeFileSync(HTML, storyPage(next));
          return Response.json({ ok: true });
        }
        return new Response(storyPage(checkStory(read())), { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    });
    console.log(`the story map, editable: http://localhost:${server.port}`);
  } else {
    const md = storyMarkdown(r), html = storyPage(r);
    if (args.includes("--check")) {
      const stale = [[MD, md], [HTML, html]].filter(([p, s]) => { try { return readFileSync(p!, "utf8") !== s; } catch { return true; } });
      for (const [p] of stale) console.log(`STALE ${p}: run \`bun run story\` in apps/mythic-masters`);
      if (r.problems.length || stale.length) process.exit(1);
    } else {
      writeFileSync(MD, md); writeFileSync(HTML, html);
      console.log(`wrote docs/STORY.md and docs/story.html`);
      if (r.problems.length) process.exit(1);
    }
  }
}
