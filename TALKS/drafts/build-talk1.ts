// `bun TALKS/drafts/build-talk1.ts`: writes TALKS/01-concept-to-dreams.html, talk 1 as a deck.
// Each slide is the option the owner picked on the slide picks page (drafts/talk1.html, published as
// https://claude.ai/artifact/9J1LWKbxnYYewFTxdPc6MM), drawn in style J, with the slide's brief as speaker notes.
// The picks are drafts/talk1-picks.json, a copy of that page's `content` collection (slide id -> option number).
// After the owner picks again: update the JSON from the collection, run this, commit both.
import { join } from "node:path";
import { int, rec } from "../../packages/util/src/guard.ts";
import { help } from "../../scripts/help.ts";

help(import.meta.path);

const here = import.meta.dir;
const page = await Bun.file(join(here, "talk1.html")).text();
const picks = rec(int(1, 10))(await Bun.file(join(here, "talk1-picks.json")).json());
const pickOf = (id: string): number => {
  const n = picks[id];
  if (n === undefined) throw new Error(`no pick for ${id} in talk1-picks.json`);
  return n;
};

// The page's slide data and picture code run without a page: everything from the icons to `draw`.
const script = page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>"));
const from = script.indexOf("  // Icons"), to = script.indexOf("  const picks = new Map()");
if (from < 0 || to < 0) throw new Error("talk1.html changed shape: could not find the slide data");
type Opt = { tag: string };
type Slide = { id: string; n: number; name: string; brief: string; opts: Opt[] };
const { SLIDES, draw, esc } = new Function(`${script.slice(from, to)}\nreturn { SLIDES, draw, esc };`)() as {
  SLIDES: Slide[]; draw: (o: Opt) => string; esc: (s: string) => string;
};

const sections = SLIDES.map((s) => {
  const k = pickOf(s.id), o = s.opts[k - 1];
  if (!o) throw new Error(`${s.id}: option ${k} does not exist`);
  return `<section class="slide j">\n  <div class="jf">${draw(o)}</div>\n  <div class="notes">Slide ${s.n}, ${esc(s.name)} (option ${k}). ${esc(s.brief)}</div>\n</section>`;
});

const out = join(here, "../01-concept-to-dreams.html");
await Bun.write(out, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>From Concept to Keyword to Dreams</title>
<meta name="description" content="Talk 1: write your app logic once, deploy manywhere. Server vs worker, storage vs memory, live connections and opt-in Rust, as experiments.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@600;700&display=swap">
<link rel="stylesheet" href="deck.css">
</head>
<body>
<!-- Built by TALKS/drafts/build-talk1.ts from the owner's picks. Edit the picks or the draft page, then rebuild. -->

${sections.join("\n\n")}

<script src="deck.js"></script>
</body>
</html>
`);
console.log(`${out}: ${sections.length} slides`);
