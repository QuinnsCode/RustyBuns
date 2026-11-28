// The photos-to-splat script with stand-ins for COLMAP and Brush: what it asks of each, and what it says when it can't.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { train } from "../trainer/venue.ts";

const root = mkdtempSync(join(tmpdir(), "venue-"));
const log = join(root, "calls.log");
const saved = { COLMAP: process.env.COLMAP, BRUSH: process.env.BRUSH };

function stand(name: string, body: string): string {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function folder(name: string, photos: number): string {
  const dir = join(root, name);
  mkdirSync(dir);
  for (let i = 0; i < photos; i++) writeFileSync(join(dir, `IMG_${i}.JPG`), "x");
  writeFileSync(join(dir, "notes.txt"), "not a photo");
  return dir;
}

beforeAll(() => {
  // The mapper writes its model to <--output_path>/0; Brush writes <--export-path>/<--export-name>.
  process.env.COLMAP = stand("colmap", `if [ "$1" = mapper ]; then mkdir -p "$7/0"; fi`);
  process.env.BRUSH = stand("brush", `while [ $# -gt 0 ]; do [ "$1" = --export-path ] && out="$2"; [ "$1" = --export-name ] && n="$2"; shift; done; echo ply > "$out/$n"`);
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(root, { recursive: true, force: true });
});

describe("venue trainer", () => {
  test("a folder of photos becomes splat.ply, through COLMAP then Brush", async () => {
    const photos = folder("hall", 24);
    const ply = await train([photos, "--steps", "500"]);
    expect(ply).toBe(join(`${photos}-splat`, "splat.ply"));
    expect(existsSync(ply)).toBe(true);
    expect(readdirSync(join(`${photos}-splat`, "dataset", "images"))).toHaveLength(24);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ").slice(0, 2).join(" "));
    expect(calls.slice(0, 3)).toEqual(["colmap feature_extractor", "colmap exhaustive_matcher", "colmap mapper"]);
    expect(calls[3]).toStartWith("brush ");
  });

  test.each([
    ["too few photos", 5, {}, "at least 20"],
    ["no trainer installed", 24, { BRUSH: join(root, "nowhere") }, "no brush here"],
    ["photos COLMAP can't place", 24, { COLMAP: "true" }, "could not place the photos"],
  ])("says why: %s", async (name, n, env, why) => {
    const before = { ...process.env };
    Object.assign(process.env, env);
    try {
      await expect(train([folder(name, n)])).rejects.toThrow(why);
    } finally {
      Object.assign(process.env, { COLMAP: before.COLMAP, BRUSH: before.BRUSH });
    }
  });
});
