// Poly Haven fetches for the room builder: models (1k glTF with its textures), floor textures and HDRI skies,
// cached once in ~/.cache/splat-rooms/polyhaven. Everything there is CC0 (https://polyhaven.com/license).
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getJson } from "@rustybuns/util/http";
import { obj, rec, str } from "@rustybuns/util/guard";

const CACHE = join(homedir(), ".cache/splat-rooms/polyhaven");
const API = "https://api.polyhaven.com";

const Url = obj({ url: str(400) });
const ModelFiles = obj({ gltf: obj({ "1k": obj({ gltf: obj({ url: str(400), include: rec(Url, 64) }) }) }) });
const TexFiles = obj({ Diffuse: obj({ "1k": obj({ jpg: Url }) }) });
const HdriFiles = obj({ hdri: obj({ "1k": obj({ hdr: Url }) }) });
const Info = obj({ name: str(200), authors: rec(str(200), 16) });

async function download(url: string, to: string) {
  if (existsSync(to)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  mkdirSync(dirname(to), { recursive: true });
  await Bun.write(`${to}.part`, res);
  await Bun.$`mv ${to}.part ${to}`.quiet();
}

/** One model's glTF and its textures, kept with their relative paths so the glTF resolves them. */
export async function model(id: string): Promise<string> {
  const dir = join(CACHE, id);
  const gltf = join(dir, `${id}.gltf`);
  if (existsSync(gltf)) return gltf;
  const files = await getJson(`${API}/files/${id}`, ModelFiles);
  if (!files) throw new Error(`Poly Haven has no files for ${id}`);
  const g = files.gltf["1k"].gltf;
  await Promise.all(Object.entries(g.include).map(([rel, f]) => download(f.url, join(dir, rel))));
  await download(g.url, gltf);
  return gltf;
}

export async function texture(id: string): Promise<string> {
  const to = join(CACHE, "textures", `${id}_diff_1k.jpg`);
  if (existsSync(to)) return to;
  const files = await getJson(`${API}/files/${id}`, TexFiles);
  if (!files) throw new Error(`Poly Haven has no texture ${id}`);
  await download(files.Diffuse["1k"].jpg.url, to);
  return to;
}

/** An equirectangular sky, for daylight through the windows and the view out of them. */
export async function hdri(id: string): Promise<string> {
  const to = join(CACHE, "hdris", `${id}_1k.hdr`);
  if (existsSync(to)) return to;
  const files = await getJson(`${API}/files/${id}`, HdriFiles);
  if (!files) throw new Error(`Poly Haven has no HDRI ${id}`);
  await download(files.hdri["1k"].hdr.url, to);
  return to;
}

/** Name and artists, for CREDITS.md. */
export async function credit(id: string): Promise<{ id: string; name: string; by: string }> {
  const info = await getJson(`${API}/info/${id}`, Info);
  return { id, name: info?.name ?? id, by: Object.keys(info?.authors ?? {}).join(", ") };
}

export async function inBatches<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const res: R[] = [];
  for (let i = 0; i < xs.length; i += n) res.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return res;
}
