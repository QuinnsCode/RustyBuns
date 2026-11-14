// Wikimedia Commons, read one way for the card art (scripts/fetch-art.ts) and the reference kit (scripts/beast-refs.ts):
// a file's picture with who made it and under what licence, by title or by search, saved as a JPEG through ffmpeg
// (on PATH; a transparent PNG is flattened onto white).
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { arr, int, obj, opt, rec, str, type Of } from "@rustybuns/util/guard";

const UA = "MythicMastersArt/0.1 (https://github.com/QuinnsCode/RustyBuns)";
const API = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|mime|size"
  + "&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl";

const meta = opt(obj({ value: str(5000, { min: 0 }) }));
const Info = obj({
  thumburl: str(1000), descriptionurl: str(1000), mime: opt(str(100)), width: opt(int(0, 1e6)), height: opt(int(0, 1e6)),
  extmetadata: obj({ Artist: meta, LicenseShortName: meta, LicenseUrl: meta }),
});
const Page = obj({ title: str(500), index: opt(int(0, 1e6)), imageinfo: opt(arr(Info, 1)) });
const Reply = obj({ query: opt(obj({ pages: rec(Page) })) });
type Info = Of<typeof Info>;

/** One Commons picture as the app credits it: where it was saved, its page, its maker and licence. */
export interface Credit { src: string; page: string; artist: string; license: string; licenseUrl?: string }

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
  .replace(/^(Anonymous ?)?(Unknown author ?)+$/i, "Unknown")
  .replace(/^No machine-readable author provided\. (.+?) assumed.*$/, "$1")
  .replace(/^The original uploader was (.+?) at English Wikipedia.*$/, "$1")
  .replace(/^(.{3,}?)\. (Owned by|Original text).*$/, "$1")
  .replace(/\s*\([^()]*\)\s*$/, "").replace(/^Creator:/, "").slice(0, 200);
const license = (s: string) => /^public domain$/i.test(s) ? "Public domain" : s;

/** A licence we may show with credit: public domain, CC0, or CC BY / BY-SA. Not NC, not ND, not fair use. */
export const freeLicense = (s: string) => /^(public domain|pd\b|cc0|cc[- ]by(-sa)?\b)/i.test(s) && !/\b(nc|nd)\b/i.test(s);

/** A Commons API call's JSON; a busy answer (429, or "too many requests" in plain text) waits and tries again, up to four times. */
async function api(url: string): Promise<unknown> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const body = await res.text();
    if (res.ok && body.startsWith("{")) return JSON.parse(body);
    if (i >= 4 || (res.status !== 429 && !/too many requests/i.test(body))) throw new Error(`Commons answered ${res.status}: ${body.slice(0, 120)}`);
    await Bun.sleep(2000 * 2 ** i);
  }
}

async function query(params: string, width: number): Promise<Of<typeof Page>[]> {
  const pages = Object.values(Reply(await api(`${API}&iiurlwidth=${width}&${params}`)).query?.pages ?? {});
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** Downloads `info`'s thumbnail to `to` as a JPEG at most `width` wide and answers its credit (`src` is `to` as given). */
async function save(info: Info, to: string, width: number, artistOverride?: string): Promise<Credit> {
  const img = await fetch(info.thumburl, { headers: { "User-Agent": UA } });
  if (!img.ok) throw new Error(`${img.status} for ${info.thumburl}`);
  const tmp = join(tmpdir(), `commons-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await Bun.write(tmp, img);
  try {
    await $`ffmpeg -loglevel error -y -i ${tmp} -filter_complex ${`[0:v]scale='min(${width},iw)':-2,format=rgba[f];color=white[b];[b][f]scale2ref[b][f];[b][f]overlay=shortest=1,format=yuvj420p`} -frames:v 1 -q:v 4 ${to}`;
  } finally { rmSync(tmp, { force: true }); }
  const m = info.extmetadata;
  return {
    src: to, page: info.descriptionurl,
    artist: artistOverride ?? (plain(m.Artist?.value ?? "") || "Unknown"), license: license(m.LicenseShortName?.value ?? "") || "unknown",
    ...(m.LicenseUrl?.value ? { licenseUrl: m.LicenseUrl.value } : {}),
  };
}

/** Saves the Commons file `file` (a title without "File:") to `to`; throws when Commons has no such file. */
export async function fetchFile(file: string, to: string, o: { width?: number; artist?: string } = {}): Promise<Credit> {
  const width = o.width ?? 480;
  const info = (await query(`titles=${encodeURIComponent(`File:${file}`)}`, width))[0]?.imageinfo?.[0];
  if (!info) throw new Error(`not on Commons: ${file}`);
  return save(info, to, width, o.artist);
}

/** A search hit: the file's title, its licence, and a function that saves it. */
export interface Hit { title: string; license: string; artist: string; save: (to: string) => Promise<Credit> }

/** Commons files matching `text`, photos and drawings only (no SVG, maps or tiny icons), best match first, freely licensed only. */
export async function searchFiles(text: string, o: { width?: number; limit?: number } = {}): Promise<Hit[]> {
  const width = o.width ?? 800;
  const pages = await query(`generator=search&gsrnamespace=6&gsrlimit=${o.limit ?? 30}&gsrsearch=${encodeURIComponent(`${text} filetype:bitmap`)}`, width);
  return hitsOf(pages, width);
}

function hitsOf(pages: Of<typeof Page>[], width: number): Hit[] {
  const hits: Hit[] = [], seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.title)) continue;
    seen.add(p.title);
    const info = p.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png)$/.test(info.mime ?? "")) continue;
    if ((info.width ?? 0) < 300 || (info.height ?? 0) < 200) continue;
    const lic = info.extmetadata.LicenseShortName?.value ?? "";
    if (!freeLicense(lic)) continue;
    hits.push({ title: p.title.replace(/^File:/, ""), license: lic, artist: plain(info.extmetadata.Artist?.value ?? ""), save: (to) => save(info, to, width) });
  }
  return hits;
}

const Cats = obj({ query: opt(obj({ search: arr(obj({ title: str(500) }), 50) })) });

/** The Commons category for `name`: one titled the name itself (or its plural) if there is one, else the best search hit, or null. */
export async function findCategory(name: string): Promise<string | null> {
  const found = Cats(await api(`https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=14&srlimit=10&srsearch=${encodeURIComponent(name)}`));
  const titles = (found.query?.search ?? []).map((s) => s.title.replace(/^Category:/, ""));
  const n = name.toLowerCase();
  return titles.find((t) => [n, `${n}s`, `${n}es`].includes(t.toLowerCase())) ?? titles[0] ?? null;
}

/** Subcategories that hold pictures of the beast itself, not things named after it (a ride, a ship, a pub). */
const ART_SUBCAT = /\b(in art|statues?|sculptures?|drawings?|illustrations?|depictions?|paintings?|engravings?|models?)\b/i;

/** The freely licensed pictures in Commons category `cat`: its art subcategories' first (`Statues of X`, `X in art`: nothing but the
 * beast), then the category's own files (which can hold the signs and shops named for it), each in category order. */
export async function categoryFiles(cat: string, o: { width?: number } = {}): Promise<Hit[]> {
  const width = o.width ?? 800;
  const members = (c: string, type: "file" | "subcat") => query(`generator=categorymembers&gcmlimit=50&gcmtype=${type}&gcmtitle=${encodeURIComponent(`Category:${c}`)}`, width);
  const subs = (await members(cat, "subcat")).map((p) => p.title.replace(/^Category:/, "")).filter((t) => ART_SUBCAT.test(t));
  const pages: Of<typeof Page>[] = [];
  for (const s of subs.slice(0, 4)) pages.push(...await members(s, "file"));
  pages.push(...await members(cat, "file"));
  return hitsOf(pages, width);
}
