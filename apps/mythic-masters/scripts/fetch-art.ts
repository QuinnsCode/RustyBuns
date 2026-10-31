// Saves each beast's card pictures (src/art.ts PICKS, Commons file titles) to public/art/<id>-<side>.jpg, 480 px
// wide (ffmpeg on PATH re-encodes it, flattening a transparent PNG onto white), and writes who made each and under what licence to src/art.json, which the card reads.
// `bun scripts/fetch-art.ts` fetches only what's missing; `--all` fetches everything again.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { arr, obj, opt, rec, str } from "@rustybuns/util/guard";
import { Art, PICKS, type Pic } from "../src/art.ts";

const ROOT = join(import.meta.dir, ".."), OUT = join(ROOT, "public/art"), JSON_PATH = join(ROOT, "src/art.json");
const UA = "MythicMastersArt/0.1 (https://github.com/QuinnsCode/RustyBuns)";
const all = process.argv.includes("--all");

const meta = opt(obj({ value: str(5000, { min: 0 }) }));
const Reply = obj({ query: obj({ pages: rec(obj({ title: str(500), imageinfo: opt(arr(obj({
  thumburl: str(1000), descriptionurl: str(1000),
  extmetadata: obj({ Artist: meta, LicenseShortName: meta, LicenseUrl: meta }),
}), 1)) })) }) });

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
  .replace(/^(Unknown author ?)+$/i, "Unknown")
  .replace(/^No machine-readable author provided\. (.+?) assumed.*$/, "$1").slice(0, 200);
const license = (s: string) => /^public domain$/i.test(s) ? "Public domain" : s;

async function fetchPic(file: string, base: string): Promise<Pic> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=600`
    + `&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl&titles=${encodeURIComponent(`File:${file}`)}`;
  const page = Object.values(Reply(await (await fetch(url, { headers: { "User-Agent": UA } })).json()).query.pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`not on Commons: ${file}`);
  const img = await fetch(info.thumburl, { headers: { "User-Agent": UA } });
  if (!img.ok) throw new Error(`${img.status} for ${info.thumburl}`);
  const tmp = join(tmpdir(), `${base}-${Date.now()}`);
  await Bun.write(tmp, img);
  await $`ffmpeg -loglevel error -y -i ${tmp} -filter_complex ${"[0:v]scale='min(480,iw)':-2,format=rgba[f];color=white[b];[b][f]scale2ref[b][f];[b][f]overlay=shortest=1,format=yuvj420p"} -frames:v 1 -q:v 4 ${join(OUT, `${base}.jpg`)}`;
  rmSync(tmp);
  const m = info.extmetadata;
  return {
    src: `art/${base}.jpg`, page: info.descriptionurl,
    artist: plain(m.Artist?.value ?? "") || "Unknown", license: license(m.LicenseShortName?.value ?? "") || "unknown",
    ...(m.LicenseUrl?.value ? { licenseUrl: m.LicenseUrl.value } : {}),
  };
}

mkdirSync(OUT, { recursive: true });
const art: Art = existsSync(JSON_PATH) && !all ? Art(await Bun.file(JSON_PATH).json()) : {};
for (const [id, pick] of Object.entries(PICKS)) {
  for (const side of ["bw", "color"] as const) {
    const file = pick[side];
    if (!file || (art[id]?.[side] && existsSync(join(ROOT, "public", art[id][side].src)))) continue;
    const pic = await fetchPic(file, `${id}-${side}`);
    art[id] = { ...art[id], [side]: pic };
    console.log(`${id} ${side}: ${pic.license}, ${pic.artist}`);
  }
}
await Bun.write(JSON_PATH, JSON.stringify(art, null, 2) + "\n");
