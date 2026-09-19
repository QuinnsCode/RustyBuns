"use server";
// Reads InteriorGS scene folders from disk. The splat PLY itself is served as a
// static mount (/scenes) rather than through an action: it's ~31 MB.
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SCENES_DIR = (process.env.SPLAT_ROOMS_DIR ?? "~/Documents/SplatRooms").replace(/^~/, homedir());

export interface Corner { x: number; y: number; z: number }
export interface SceneObject { ins_id: string; label: string; bounding_box?: Corner[]; room_box?: unknown }
export interface SceneSummary { id: string; objects: number; kinds: number; top: [string, number][]; splatMb: number; hasSplats: boolean }
export interface SceneDetail {
  id: string;
  objects: SceneObject[];
  /** occupancy.json: world <-> pixel mapping, metres */
  occupancy: { scale: number; min: number[]; max: number[]; center?: number[] } | null;
  structure: { rooms?: { profile: number[][]; room_type?: string }[]; walls?: unknown[]; holes?: unknown[] } | null;
  plyUrl: string | null;
}

const readJson = async (p: string) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } };

export async function listScenes(): Promise<{ dir: string; scenes: SceneSummary[]; error?: string }> {
  let entries: string[];
  try { entries = await readdir(SCENES_DIR); }
  catch { return { dir: SCENES_DIR, scenes: [], error: `No scene folder at ${SCENES_DIR}. Drop InteriorGS scene folders there, or set SPLAT_ROOMS_DIR.` }; }
  const scenes: SceneSummary[] = [];
  for (const id of entries.sort()) {
    const dir = join(SCENES_DIR, id);
    const objs: SceneObject[] | null = await readJson(join(dir, "labels.json"));
    if (!Array.isArray(objs)) continue;
    // A labels-only folder is still worth listing: you can browse what's in the
    // room and decide whether the splats are worth downloading.
    let splatMb = 0;
    try { splatMb = Math.round(((await stat(join(dir, "3dgs_compressed.ply"))).size / 1e6) * 10) / 10; } catch { splatMb = 0; }
    const counts = new Map<string, number>();
    for (const o of objs) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
    scenes.push({
      id, objects: objs.length, kinds: counts.size, splatMb, hasSplats: splatMb > 0,
      top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
    });
  }
  return { dir: SCENES_DIR, scenes };
}

export async function readScene(id: string): Promise<SceneDetail> {
  if (!/^[\w.-]+$/.test(id)) throw new Error("bad scene id");
  const dir = join(SCENES_DIR, id);
  const objects = (await readJson(join(dir, "labels.json"))) as SceneObject[] | null;
  if (!Array.isArray(objects)) throw new Error(`no labels.json in ${id}`);
  let hasSplats = true;
  try { await stat(join(dir, "3dgs_compressed.ply")); } catch { hasSplats = false; }
  return {
    id, objects,
    occupancy: await readJson(join(dir, "occupancy.json")),
    structure: await readJson(join(dir, "structure.json")),
    plyUrl: hasSplats ? `/scenes/${encodeURIComponent(id)}/3dgs_compressed.ply` : null,
  };
}
