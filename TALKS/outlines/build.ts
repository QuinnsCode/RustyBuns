// `bun TALKS/outlines/build.ts`: reads every TALKS/outlines/NN-*.md (a talk's main points, each a list of slides) and
// writes dist/talks/outlines.html, the review page: Keep, Change or Cut each slide, with a note, saved for Claude to read.
// Publish it to the "Talk Outlines" artifact (https://claude.ai/artifact/AGoSAL3WF1FMXEFTey79zQ) with capabilities {db:{}, user:{}}.
//
// Outline format: "# Title", "> promise", then "## Point" headings, each followed by slide lines
// "- Slide title :: what it says :: what it shows". The shape rule: 3 to 10 points, fewer slides per point as the
// points go up (3x10 down to 10x5), 30 to 60 slides in all. A talk that breaks it stops the build.
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

type Slide = { id: string; t: string; say: string; show: string };
type Point = { title: string; slides: Slide[] };
type Outline = { n: number; file: string; title: string; promise: string; points: Point[] };

export function parseOutline(n: number, file: string, md: string): Outline {
  const o: Outline = { n, file, title: "", promise: "", points: [] };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("# ")) o.title = line.slice(2).trim();
    else if (line.startsWith("> ")) o.promise = line.slice(2).trim();
    else if (line.startsWith("## ")) o.points.push({ title: line.slice(3).trim(), slides: [] });
    else if (line.startsWith("- ")) {
      const point = o.points.at(-1);
      if (!point) throw new Error(`${file}: a slide before the first point: ${line}`);
      const [t, say, show, ...rest] = line.slice(2).split(" :: ").map((s) => s.trim());
      if (!t || !say || !show || rest.length) throw new Error(`${file}: a slide needs "title :: says :: shows": ${line}`);
      const p = o.points.length, s = point.slides.length + 1;
      point.slides.push({ id: `t${n}-p${p}-s${s}`, t, say, show });
    }
  }
  return o;
}

// The most slides one point may have, for a talk with this many points (3x10, 4x9, 5x8, 6x7, 7x6, 8+ x5),
// with one extra allowed so a point can carry the title or the closing slide.
export const maxPerPoint = (points: number) => Math.max(5, 13 - points) + 1;

export function shapeProblems(o: Outline): string[] {
  const out: string[] = [];
  const total = o.points.reduce((s, p) => s + p.slides.length, 0);
  if (!o.title) out.push("no # title");
  if (o.points.length < 3 || o.points.length > 10) out.push(`${o.points.length} points (3 to 10)`);
  if (total < 30 || total > 60) out.push(`${total} slides (30 to 60)`);
  for (const p of o.points) {
    if (p.slides.length < 3) out.push(`"${p.title}" has ${p.slides.length} slides (3 or more)`);
    if (p.slides.length > maxPerPoint(o.points.length)) out.push(`"${p.title}" has ${p.slides.length} slides (at most ${maxPerPoint(o.points.length)} with ${o.points.length} points)`);
  }
  return out;
}

if (import.meta.main) {
  const dir = import.meta.dir;
  const out = join(dir, "../../dist/talks/outlines.html");
  const files = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
  const outlines: Outline[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const o = parseOutline(Number(f.slice(0, 2)), f, await Bun.file(join(dir, f)).text());
    problems.push(...shapeProblems(o).map((p) => `${f}: ${p}`));
    outlines.push(o);
  }
  if (problems.length) throw new Error(`outline shape:\n  ${problems.join("\n  ")}`);
  const css = await Bun.file(join(dir, "../deck.css")).text();
  const shell = await Bun.file(join(dir, "page.html")).text();
  const json = JSON.stringify(outlines).replaceAll("</", "<\\/");
  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(out, shell.replace("/*DECK_CSS*/", () => css).replace("/*OUTLINES_JSON*/", () => json));
  for (const o of outlines) {
    const total = o.points.reduce((s, p) => s + p.slides.length, 0);
    console.log(`${String(o.n).padStart(2)} ${o.title}: ${o.points.length} points, ${total} slides`);
  }
  console.log(`${out}: ${outlines.length} talks, ${outlines.reduce((s, o) => s + o.points.reduce((a, p) => a + p.slides.length, 0), 0)} slides`);
}
