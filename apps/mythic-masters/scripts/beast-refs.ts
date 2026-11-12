// The reference kit: a beast's model is built and judged beside real pictures of it, not from memory (#4249).
//
//   bun scripts/beast-refs.ts --refs <id> [--category "Commons category"] [--query "text"] [--skip c4.jpg,c5.jpg] [--max 6] [--draft]
//       Pictures of the beast into refs/<id>/ and their credits plus a traits stub into refs/<id>.json. Ranked: any
//       picture you drop into refs/<id>/ yourself (an owner's photo; any name but c<n>.jpg or card-*.jpg) first, then
//       the bestiary card's own Commons picks (src/art.ts), then the beast's Commons category (the one named for it,
//       or --category) and its art subcategories, then a Commons search for the sheet's name (or --query); both are
//       kept in the JSON for the next run. Freely licensed only, one per artist, up to --max Commons pictures (default 6).
//       --skip drops pictures of the last run (a sign or a shop named for it) for good: they go in the JSON's `skip`.
//       --draft has a fresh `claude -p` write the traits from the pictures when they are still empty: a draft to correct.
//       A rerun fetches the Commons ones again and keeps the traits you wrote. The pictures are not committed
//       (refs/.gitignore): the JSON says where each came from, and --refs fetches them again.
//   bun scripts/beast-refs.ts --closeups <id> [--main]
//       blender/out/refs/<id>.now.png: front, side, three-quarter and head close-ups of public/models/<id>.glb, through an
//       orthographic camera (blender/closeups.py). --main also draws git main's GLB to <id>.main.png at the same scale,
//       so a change in size shows. One Blender at a time.
//   bun scripts/beast-refs.ts --compare <id> [--out file.html]
//       One self-contained page (blender/out/refs/<id>.compare.html): the references with their credits, the model
//       before (git main) and now as close-up strips, and the traits with a tick or a cross each from the last judge
//       run (blender/out/refs/<id>.judge.json; "not judged" until there is one). Draws the close-ups first. This is the
//       page the owner picks from.
//   bun scripts/beast-refs.ts --candidates <id> <a.json> <b.json> ...
//       Prototypes to pick from: each candidate sheet (an id matching <id>, and an optional `candidate` line saying what
//       it is) is built in turn through scripts/beasts.ts, its GLB kept in blender/out/refs/<id>.cand/<name>.glb, and the
//       working tree's sheet, GLB and rig put back after. They and git main are drawn in one Blender run at one scale,
//       and the page (blender/out/refs/<id>.compare.html) shows a strip per candidate under the references.
//   bun scripts/beast-refs.ts --judge <id>
//       Draws the close-ups, shows them with the references and traits to a fresh `claude -p` judge (judge-loop.ts
//       judgeTraits), writes its verdict per trait and a score to blender/out/refs/<id>.judge.json, then the page.
//       Agent judges score about 2 points above the owner: read the ticks for direction, not the number.
//
// The traits are what the model is judged on: fill refs/<id>.json's `traits` from the pictures (silhouette, head, limbs,
// hide, colours, and the three things a child would draw) before building.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { runBlender } from "@rustybuns/cli/blender";
import { esc } from "@rustybuns/util";
import { arr, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { PICKS } from "../src/art.ts";
import { help } from "../../../scripts/help.ts";
import { categoryFiles, fetchFile, findCategory, searchFiles, type Credit, type Hit } from "./commons.ts";
import { draftTraits, judgeTraits, OUT } from "./judge-loop.ts";

const APP = join(import.meta.dir, "..");
export const REFS = join(APP, "refs");
export const refsOut = join(OUT, "refs");
/** The close-up strip's tiles, left to right (blender/closeups.py VIEWS). */
export const VIEWS = ["front", "side", "three-quarter", "head"] as const;

const text = (max: number) => str(max, { min: 0, dflt: "" });
/** What a model of the beast must get right, read off the references. Empty strings are not written yet. */
export const Traits = obj({
  silhouette: text(300), head: text(300), limbs: text(300), hide: text(300), colours: text(300),
  child: arr(text(200), 3),
});
export const Ref = obj({
  file: str(120, { re: /^[\w.-]+$/ }), from: oneOf(["owner", "card", "search"] as const),
  page: opt(str(400)), artist: opt(str(200)), license: opt(str(100)), licenseUrl: opt(str(300)),
});
export const Refs = obj({ id: str(40, { re: /^[a-z0-9-]+$/ }), name: str(60), category: opt(str(200)), query: str(200), skip: opt(arr(str(400), 100)), images: arr(Ref, 20), traits: Traits });
export type Refs = Of<typeof Refs>;
export type Traits = Of<typeof Traits>;

const Sheet = obj({ id: str(40), name: str(60) });
const sheetOf = async (id: string) => {
  const f = Bun.file(join(APP, "beasts", `${id}.json`));
  if (!(await f.exists())) throw new Error(`no beast sheet beasts/${id}.json`);
  return Sheet(await f.json());
};
const blankTraits = (): Traits => ({ silhouette: "", head: "", limbs: "", hide: "", colours: "", child: ["", "", ""] });
/** A file a person dropped in: a picture that isn't one --refs fetched. */
const ownerFile = (f: string) => /\.(jpe?g|png|webp)$/i.test(f) && !/^(c\d+\.jpg|card-(bw|color)\.jpg)$/.test(f) && !f.startsWith(".");

/** The saved refs/<id>.json, or null when there is none yet. */
export async function readRefs(id: string): Promise<Refs | null> {
  const f = Bun.file(join(REFS, `${id}.json`));
  return (await f.exists()) ? Refs(await f.json()) : null;
}

/** Fetches the beast's references and writes refs/<id>.json; answers it. */
export async function fetchRefs(id: string, o: { query?: string; category?: string; max?: number; skip?: string[]; draft?: boolean } = {}): Promise<Refs> {
  const sheet = await sheetOf(id), old = await readRefs(id);
  // --skip c4.jpg names a picture from the last run; it is kept as its Commons page, which is never fetched again
  const skip = new Set([...(old?.skip ?? []), ...(o.skip ?? []).map((f) => old?.images.find((i) => i.file === f)?.page ?? f)]);
  const dir = join(REFS, id), max = o.max ?? 6;
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (!ownerFile(f)) rmSync(join(dir, f));
  const images: Of<typeof Ref>[] = readdirSync(dir).filter(ownerFile).sort().map((file) => ({ file, from: "owner" as const }));
  const credit = (file: string, from: "card" | "search", c: Credit) => ({ file, from, page: c.page, artist: c.artist, license: c.license, ...(c.licenseUrl ? { licenseUrl: c.licenseUrl } : {}) });
  const pages = new Set<string>();
  for (const side of ["color", "bw"] as const) {
    const title = PICKS[id]?.[side];
    if (!title) continue;
    try {
      const c = await fetchFile(title, join(dir, `card-${side}.jpg`), { width: 800 });
      images.push(credit(`card-${side}.jpg`, "card", c));
      pages.add(c.page);
    } catch (e) { console.warn(`card ${side}: ${e instanceof Error ? e.message : e}`); }
  }
  const query = o.query ?? old?.query ?? sheet.name;
  const category = o.category ?? old?.category ?? (await findCategory(query)) ?? undefined;
  let n = images.filter((i) => i.from !== "owner").length;
  // The beast's own Commons category is curated, so it goes first; a text search for the name brings in rides, ships
  // and pubs named after it, so it only tops up. One picture per artist, so three photos of one statue don't crowd out the rest.
  const hits: Hit[] = n < max ? [...(category ? await categoryFiles(category) : []), ...(await searchFiles(query))] : [];
  const artists = new Set(images.map((i) => i.artist).filter((a) => a && a !== "Unknown"));
  for (const hit of hits) {
    if (n >= max) break;
    if (skip.has(hit.title) || (hit.artist && hit.artist !== "Unknown" && artists.has(hit.artist))) continue;
    artists.add(hit.artist);
    const file = `c${n + 1}.jpg`;
    const c = await hit.save(join(dir, file));
    if (pages.has(c.page) || skip.has(c.page)) { rmSync(join(dir, file)); continue; }
    pages.add(c.page);
    images.push(credit(file, "search", c));
    n++;
  }
  const refs: Refs = { id, name: sheet.name, ...(category ? { category } : {}), query, ...(skip.size ? { skip: [...skip] } : {}), images, traits: old?.traits ?? blankTraits() };
  if (o.draft && !traitRows(refs.traits).length) refs.traits = Traits(await draftTraits({ name: sheet.name, refs: images.map((i) => join(dir, i.file)) }));
  await Bun.write(join(REFS, `${id}.json`), JSON.stringify(refs, null, 2) + "\n");
  return refs;
}

/** git main's GLB of the beast in a temporary file, or null when main has none (a new beast). */
async function mainGlb(id: string): Promise<string | null> {
  const root = (await $`git rev-parse --show-toplevel`.cwd(APP).text()).trim();
  const rel = `${join(APP, "public", "models", `${id}.glb`).slice(root.length + 1)}`;
  await $`git fetch -q origin main`.cwd(root).nothrow();
  const blob = await $`git show origin/main:${rel}`.cwd(root).quiet().nothrow();
  if (blob.exitCode !== 0) return null;
  const tmp = join(tmpdir(), `${id}-main-${Date.now()}.glb`);
  await Bun.write(tmp, blob.stdout);
  return tmp;
}

/** Renders the close-up strips; answers the PNG paths: { now, main? }. */
export async function closeups(id: string, o: { main?: boolean } = {}): Promise<{ now: string; main?: string }> {
  const now = join(APP, "public", "models", `${id}.glb`);
  if (!existsSync(now)) throw new Error(`no public/models/${id}.glb: build it first (bun scripts/beasts.ts ${id})`);
  mkdirSync(refsOut, { recursive: true });
  const before = o.main ? await mainGlb(id) : null;
  if (o.main && !before) console.warn(`git main has no ${id}.glb: drawing only the working tree's`);
  const res: { now: string; main?: string } = { now: join(refsOut, `${id}.now.png`), ...(before ? { main: join(refsOut, `${id}.main.png`) } : {}) };
  // one Blender for both builds, so they share one framing (the larger's)
  try {
    await runBlender({ script: "blender/closeups.py", args: [now, res.now, ...(before ? [before, res.main!] : [])], cwd: APP });
  } finally { if (before) rmSync(before, { force: true }); }
  for (const out of Object.values(res)) for (const v of VIEWS) rmSync(`${out.slice(0, -4)}.${v}.png`, { force: true }); // the single views each strip was made from
  return res;
}

const TRAIT_KEYS = ["silhouette", "head", "limbs", "hide", "colours"] as const;
/** One row a judge scores: a trait's key (a TRAITS key, or child1..child3) and what the references show. */
export const traitRows = (t: Traits) => [...TRAIT_KEYS.map((k) => ({ key: k as string, want: t[k] })), ...t.child.map((c, i) => ({ key: `child${i + 1}`, want: c }))].filter((r) => r.want);

/** A judge's verdict on one model against its references, trait by trait (scripts/beast-refs.ts --judge writes it). */
export const Judged = obj({
  id: str(40), at: str(40), score: int(1, 10),
  traits: arr(obj({ key: str(20), verdict: oneOf(["yes", "partly", "no"] as const), note: str(300, { min: 0, dflt: "" }) }), 20),
  fix: str(600, { min: 0, dflt: "" }),
});
export type Judged = Of<typeof Judged>;
export const judgedPath = (id: string) => join(refsOut, `${id}.judge.json`);

/** A picture as a data: URL, scaled to at most `width` wide as a JPEG, so the page carries everything it shows. */
async function inline(file: string, width: number): Promise<string> {
  const out = join(tmpdir(), `inline-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  await $`ffmpeg -loglevel error -y -i ${file} -vf ${`scale='min(${width},iw)':-2`} -q:v 5 ${out}`;
  const b64 = Buffer.from(await Bun.file(out).arrayBuffer()).toString("base64");
  rmSync(out, { force: true });
  return `data:image/jpeg;base64,${b64}`;
}

const MARK = {
  yes: `<svg viewBox="0 0 24 24" aria-label="yes"><path d="M20 6 9 17l-5-5"/></svg>`,
  partly: `<svg viewBox="0 0 24 24" aria-label="partly"><path d="M5 12h14"/></svg>`,
  no: `<svg viewBox="0 0 24 24" aria-label="no"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
};

const Candidate = obj({ id: str(40), candidate: opt(str(300)) });
/** A prototype built for the owner to pick from: its name, what it is, its close-up strip and its rig row. */
export type Built = { name: string; note: string; glb: string; strip: string; row: string; ok: boolean };

/** Builds each candidate sheet as the beast in turn, keeps its GLB, puts the working tree back, then draws git main and
 *  every candidate in one Blender run so they share one scale. Answers them in the order given. */
export async function candidates(id: string, files: string[]): Promise<Built[]> {
  const models = join(APP, "public", "models"), dir = join(refsOut, `${id}.cand`);
  const kept = [join(APP, "beasts", `${id}.json`), join(models, `${id}.glb`), join(models, `${id}.rig.json`)];
  const saved = await Promise.all(kept.map(async (f) => (existsSync(f) ? await Bun.file(f).arrayBuffer() : null)));
  mkdirSync(dir, { recursive: true });
  const built: Built[] = [];
  try {
    for (const file of files) {
      const text = await Bun.file(file).text(), c = Candidate(JSON.parse(text));
      if (c.id !== id) throw new Error(`${file} is a sheet for ${c.id}, not ${id}`);
      const name = basename(file, ".json"), glb = join(dir, `${name}.glb`);
      await Bun.write(kept[0]!, text);
      const p = await $`bun scripts/beasts.ts ${id}`.cwd(APP).quiet().nothrow();
      const row = (p.stdout.toString() + p.stderr.toString()).split("\n").find((l) => l.includes(" tris ")) ?? "no rig row";
      await Bun.write(glb, Bun.file(kept[1]!));
      built.push({ name, note: c.candidate ?? "", glb, strip: join(dir, `${name}.png`), row: row.trim(), ok: p.exitCode === 0 });
      console.log(`${name.padEnd(12)} ${row.trim()}`);
    }
  } finally {
    await Promise.all(kept.map((f, i) => (saved[i] ? Bun.write(f, saved[i]!) : rmSync(f, { force: true }))));
  }
  const before = await mainGlb(id), main = join(refsOut, `${id}.main.png`);
  try {
    await runBlender({ script: "blender/closeups.py", args: [...(before ? [before, main] : []), ...built.flatMap((b) => [b.glb, b.strip])], cwd: APP });
  } finally { if (before) rmSync(before, { force: true }); }
  for (const out of [main, ...built.map((b) => b.strip)]) for (const v of VIEWS) rmSync(`${out.slice(0, -4)}.${v}.png`, { force: true });
  return built;
}

/** Writes the comparison page for the beast; answers its path. With `candidates`, a strip per prototype in place of "Now". */
export async function compare(id: string, o: { out?: string; draw?: boolean; candidates?: Built[] } = {}): Promise<string> {
  const refs = await readRefs(id);
  if (!refs) throw new Error(`no refs/${id}.json: run --refs ${id} first`);
  const strips = o.draw === false || o.candidates ?{ now: join(refsOut, `${id}.now.png`), main: join(refsOut, `${id}.main.png`) } : await closeups(id, { main: true });
  const jf = Bun.file(judgedPath(id));
  const judged = (await jf.exists()) ? Judged(await jf.json()) : null;
  const pics = await Promise.all(refs.images.filter((i) => existsSync(join(REFS, id, i.file))).map(async (i) => ({ ...i, url: await inline(join(REFS, id, i.file), 520) })));
  const strip = async (label: string, f?: string) => f && existsSync(f) ? `<figure class="strip"><figcaption>${label}</figcaption><img src="${await inline(f, 1800)}" alt="${label}: front, side, three-quarter, head"><div class="views">${VIEWS.map((v) => `<span>${v}</span>`).join("")}</div></figure>` : "";
  const rows = traitRows(refs.traits).map((r) => {
    const j = judged?.traits.find((t) => t.key === r.key);
    return `<tr><th>${r.key.startsWith("child") ? "a child draws" : r.key}</th><td>${esc(r.want)}</td><td class="mark ${j?.verdict ?? "none"}">${j ? MARK[j.verdict] : ""}<span>${j ? esc(j.note || j.verdict) : "not judged"}</span></td></tr>`;
  }).join("\n");
  const credit = (i: (typeof pics)[number]) => i.from === "owner" ? "the owner's picture" : `<a href="${esc(i.page ?? "")}">${esc(i.artist ?? "Unknown")}</a>, ${esc(i.license ?? "")}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(refs.name)} references</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1d1b;--mute:#6b6a66;--card:#fff;--line:#dedcd6;--yes:#2f7d4a;--no:#b3412f;--partly:#a87512}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#171716;--fg:#ecebe7;--mute:#9b9a95;--card:#22221f;--line:#3a3935;--yes:#5cbf7d;--no:#e2735f;--partly:#d9a443}}
:root[data-theme=dark]{--bg:#171716;--fg:#ecebe7;--mute:#9b9a95;--card:#22221f;--line:#3a3935;--yes:#5cbf7d;--no:#e2735f;--partly:#d9a443}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px;font-size:28px}h2{margin:32px 0 12px;font-size:18px}
.sub{color:var(--mute);margin:0}a{color:inherit}
.refs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.refs figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.refs img{display:block;width:100%;height:220px;object-fit:contain;background:#fff}
.refs figcaption{padding:8px 10px;font-size:12px;color:var(--mute)}
.strip{margin:0 0 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.strip figcaption{padding:8px 12px;font-weight:600}.strip img{display:block;width:100%}
.views{display:grid;grid-template-columns:repeat(4,1fr);font-size:12px;color:var(--mute);text-align:center;padding:4px 0 8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-top:1px solid var(--line)}th{width:120px;text-transform:capitalize}
.mark{width:34%}.mark svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;vertical-align:-3px;margin-right:6px}
.yes{color:var(--yes)}.no{color:var(--no)}.partly{color:var(--partly)}.none{color:var(--mute)}.mark span{color:var(--fg)}.none span{color:var(--mute)}
.score{font-size:15px;color:var(--mute)}
@media (max-width:640px){th{width:auto}td,th{display:block;border-top:0}tr{display:block;border-top:1px solid var(--line)}.mark{width:auto}}
</style></head><body><main>
<h1>${esc(refs.name)}</h1>
<p class="sub">${pics.length} references${refs.category ? `, from Commons category ${esc(refs.category)}` : ""}${judged ? ` · judged ${esc(judged.at)}: <b>${judged.score}/10</b> against the references` : ""}</p>
<h2>References</h2>
<div class="refs">${pics.map((i) => `<figure><img src="${i.url}" alt="${esc(i.file)}"><figcaption>${credit(i)}</figcaption></figure>`).join("")}</div>
<h2>The model</h2>
${await strip("Before (git main)", strips.main)}
${o.candidates
  ? (await Promise.all(o.candidates.map((c, i) => strip(`${String.fromCharCode(65 + i)}. ${esc(c.name)}${c.note ? ` · ${esc(c.note)}` : ""}${c.ok ? "" : " (rig check failed)"}`, c.strip)))).join("\n")
  : await strip("Now", strips.now)}
<h2>Traits</h2>
<table>${rows || `<tr><td>No traits written yet: fill refs/${esc(id)}.json.</td></tr>`}</table>
${judged?.fix ? `<h2>What to fix next</h2><p>${esc(judged.fix)}</p>` : ""}
</main></body></html>`;
  const out = o.out ?? join(refsOut, `${id}.compare.html`);
  await Bun.write(out, html);
  return out;
}

/** Draws the close-ups (now and main), has a fresh judge score now against the references, and saves the verdict. */
export async function judge(id: string): Promise<Judged> {
  const refs = await readRefs(id);
  if (!refs) throw new Error(`no refs/${id}.json: run --refs ${id} first`);
  const traits = traitRows(refs.traits);
  if (!traits.length) throw new Error(`refs/${id}.json has no traits yet: write them from the pictures first`);
  const pics = refs.images.map((i) => join(REFS, id, i.file)).filter((f) => existsSync(f));
  if (!pics.length) throw new Error(`no pictures in refs/${id}/: run --refs ${id}`);
  const { now } = await closeups(id, { main: true });
  const answer = await judgeTraits({ name: refs.name, refs: pics, model: now, views: VIEWS, traits });
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) throw new Error("the judge's answer is not a JSON object");
  const raw = Judged({ ...answer, id, at: new Date().toISOString().slice(0, 16).replace("T", " ") });
  const j: Judged = { ...raw, traits: raw.traits.filter((t) => traits.some((r) => r.key === t.key)) };
  await Bun.write(judgedPath(id), JSON.stringify(j, null, 2) + "\n");
  return j;
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const id = val("--refs") ?? val("--closeups") ?? val("--compare") ?? val("--judge") ?? val("--candidates");
  if (!id || id.startsWith("--")) { console.error("usage: bun scripts/beast-refs.ts --refs <id> | --closeups <id> [--main] | --compare <id> | --judge <id>   (--help for more)"); process.exit(1); }
  if (argv.includes("--refs")) {
    const max = val("--max") === undefined ? undefined : Number(val("--max"));
    if (max !== undefined && !(Number.isInteger(max) && max >= 1 && max <= 12)) { console.error("--max takes 1 to 12"); process.exit(1); }
    const r = await fetchRefs(id, { query: val("--query"), category: val("--category"), max, skip: val("--skip")?.split(","), draft: argv.includes("--draft") });
    for (const i of r.images) console.log(`${i.from.padEnd(6)} refs/${id}/${i.file}${i.license ? `  ${i.license}, ${i.artist}` : ""}`);
    if (r.images.filter((i) => i.from !== "owner").length < 3) console.warn(`fewer than 3 Commons pictures: try --query with another name for it`);
    console.log(`refs/${id}.json: ${traitRows(r.traits).length ? "traits written (check them against the pictures)" : "fill in the traits from the pictures, or rerun with --draft"}`);
  }
  if (argv.includes("--closeups")) {
    const r = await closeups(id, { main: argv.includes("--main") });
    for (const p of Object.values(r)) console.log(p);
  }
  if (argv.includes("--candidates")) {
    const files = argv.slice(argv.indexOf("--candidates") + 2).filter((a) => a.endsWith(".json"));
    if (files.length < 1) { console.error("--candidates <id> takes one or more candidate sheets (.json)"); process.exit(1); }
    console.log(await compare(id, { out: val("--out"), candidates: await candidates(id, files) }));
  } else if (argv.includes("--judge")) {
    const j = await judge(id);
    for (const t of j.traits) console.log(`${t.verdict.padEnd(6)} ${t.key.padEnd(10)} ${t.note}`);
    console.log(`score ${j.score}/10 against the references${j.fix ? `\nfix: ${j.fix}` : ""}`);
    console.log(await compare(id, { out: val("--out"), draw: false }));
  } else if (argv.includes("--compare")) console.log(await compare(id, { out: val("--out") }));
}
