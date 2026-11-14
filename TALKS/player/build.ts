// `bun TALKS/player/build.ts`: reads the lineup from TALKS/index.html and the slides of every ready talk, and writes
// one self-contained dist/talks/player.html (a playlist beside a stage, with play, step, notes and full screen),
// ready to open or publish as an artifact. A new talk shows up once index.html links it.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const talks = join(import.meta.dir, "..");
const out = join(talks, "../dist/talks/player.html");

type Slide = { html: string; notes: string };
type Talk = { n: number; title: string; pitch: string; file: string | null; slides: Slide[] };

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// The lineup: each <li> in index.html is a number, a title, a pitch and, when it is ready, a link to its file.
const index = await Bun.file(join(talks, "index.html")).text();
const lineup: Talk[] = [];
for (const li of index.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
  const body = li[1];
  const n = /<span class="n">(\d+)<\/span>/.exec(body);
  const title = /<b>([\s\S]*?)<\/b>/.exec(body);
  const pitch = /<span class="p">([\s\S]*?)<\/span>/.exec(body);
  if (!n || !title || !pitch) continue;
  const file = /<a href="([^"]+\.html)"/.exec(body)?.[1] ?? null;
  lineup.push({ n: Number(n[1]), title: text(title[1]), pitch: text(pitch[1]), file, slides: [] });
}
if (!lineup.length) throw new Error("no talks found in TALKS/index.html");

// A link from one talk to another plays in the player instead of leaving it.
const byFile = new Map(lineup.flatMap((t) => (t.file ? [[t.file, t.n] as const] : [])));
const relink = (html: string) =>
  html.replace(/<a href="([^"#]+\.html)"/g, (whole, href: string) =>
    byFile.has(href) ? `<a href="#" data-talk="${byFile.get(href)}"` : href === "index.html" ? `<a href="#" data-talk="list"` : whole,
  );

for (const t of lineup) {
  if (!t.file) continue;
  const page = await Bun.file(join(talks, t.file)).text();
  for (const m of page.matchAll(/<section class="slide">([\s\S]*?)<\/section>/g)) {
    const notes = /<div class="notes">([\s\S]*?)<\/div>/.exec(m[1]);
    t.slides.push({ html: `<section class="slide">${relink(m[1])}</section>`, notes: notes ? text(notes[1]) : "" });
  }
}

const css = await Bun.file(join(talks, "deck.css")).text();
const shell = await Bun.file(join(import.meta.dir, "player.html")).text();
const json = JSON.stringify(lineup).replaceAll("</", "<\\/");
const html = shell.replace("/*DECK_CSS*/", () => css).replace("/*TALKS_JSON*/", () => json);
mkdirSync(dirname(out), { recursive: true });
await Bun.write(out, html);
const ready = lineup.filter((t) => t.slides.length);
console.log(`${out}: ${ready.length} of ${lineup.length} talks, ${ready.reduce((s, t) => s + t.slides.length, 0)} slides`);
