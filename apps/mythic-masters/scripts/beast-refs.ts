// The reference kit: a beast's model is built and judged beside real pictures of it, not from memory (#4249).
//
//   bun scripts/beast-refs.ts --refs <id> [--category "Commons category"] [--query "text"] [--skip c4.jpg,c5.jpg] [--max 6]
//       Pictures of the beast into refs/<id>/ and their credits plus a traits stub into refs/<id>.json. Ranked: any
//       picture you drop into refs/<id>/ yourself (an owner's photo; any name but c<n>.jpg or card-*.jpg) first, then
//       the bestiary card's own Commons picks (src/art.ts), then the beast's Commons category (the one named for it,
//       or --category) and its art subcategories, then a Commons search for the sheet's name (or --query); both are
//       kept in the JSON for the next run. Freely licensed only, one per artist, up to --max Commons pictures (default 6).
//       --skip drops pictures of the last run (a sign or a shop named for it) for good: they go in the JSON's `skip`.
//       A rerun fetches the Commons ones again and keeps the traits you wrote. The pictures are not committed
//       (refs/.gitignore): the JSON says where each came from, and --refs fetches them again.
//   bun scripts/beast-refs.ts --closeups <id> [--main]
//       blender/out/refs/<id>.now.png: front, side, three-quarter and head close-ups of public/models/<id>.glb, through an
//       orthographic camera (blender/closeups.py). --main also draws git main's GLB to <id>.main.png at the same scale,
//       so a change in size shows. One Blender at a time.
//
// The traits are what the model is judged on: fill refs/<id>.json's `traits` from the pictures (silhouette, head, limbs,
// hide, colours, and the three things a child would draw) before building.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { runBlender } from "@rustybuns/cli/blender";
import { arr, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { PICKS } from "../src/art.ts";
import { help } from "../../../scripts/help.ts";
import { categoryFiles, fetchFile, findCategory, searchFiles, type Credit, type Hit } from "./commons.ts";
import { OUT } from "./judge-loop.ts";

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
export async function fetchRefs(id: string, o: { query?: string; category?: string; max?: number; skip?: string[] } = {}): Promise<Refs> {
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

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const id = val("--refs") ?? val("--closeups");
  if (!id || id.startsWith("--")) { console.error("usage: bun scripts/beast-refs.ts --refs <id> | --closeups <id> [--main]   (--help for more)"); process.exit(1); }
  if (argv.includes("--refs")) {
    const max = val("--max") === undefined ? undefined : Number(val("--max"));
    if (max !== undefined && !(Number.isInteger(max) && max >= 1 && max <= 12)) { console.error("--max takes 1 to 12"); process.exit(1); }
    const r = await fetchRefs(id, { query: val("--query"), category: val("--category"), max, skip: val("--skip")?.split(",") });
    for (const i of r.images) console.log(`${i.from.padEnd(6)} refs/${id}/${i.file}${i.license ? `  ${i.license}, ${i.artist}` : ""}`);
    if (r.images.filter((i) => i.from !== "owner").length < 3) console.warn(`fewer than 3 Commons pictures: try --query with another name for it`);
    console.log(`refs/${id}.json: ${Object.values(r.traits).flat().some((t) => t) ? "traits kept" : "fill in the traits from the pictures"}`);
  }
  if (argv.includes("--closeups")) {
    const r = await closeups(id, { main: argv.includes("--main") });
    for (const p of Object.values(r)) console.log(p);
  }
}
