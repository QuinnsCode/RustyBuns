// The material kit: every map a surface asks for is in textures/, the folder stays in its 2 MB budget, and the `low`
// quality look dresses every gear slot without loading a texture.
import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GEAR_IDS, gear } from "../src/gear.ts";
import { SURFACES, SURFACE_NAMES, gearSurfaces, surfaceFiles, wornShader } from "../src/surfaces.ts";

const dir = join(import.meta.dir, "..", "textures");

test("every surface's maps are on disk, and the kit stays under 2 MB", async () => {
  for (const name of SURFACE_NAMES) for (const f of surfaceFiles(name)) expect(await Bun.file(join(dir, f)).exists(), f).toBe(true);
  const bytes = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).reduce((n, e) => n + statSync(join(e.parentPath, e.name)).size, 0);
  expect(bytes).toBeLessThan(2 * 1024 * 1024);
});

test("low quality dresses every piece of gear in flat colour, loading nothing", async () => {
  const loader = new THREE.TextureLoader();
  let asked = 0;
  loader.load = () => (asked++, new THREE.Texture());
  const { look, ready } = gearSurfaces({ base: "/textures/", quality: "low", loader });
  await ready;
  for (const id of GEAR_IDS) for (const m of gear(id, { look }).children.filter((c) => c instanceof THREE.Mesh)) {
    const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat, m.name).toBeDefined();
    expect(mat.map ?? mat.normalMap ?? null, m.name).toBeNull();
  }
  expect(asked).toBe(0);
});

test("every worn surface hooks into three's standard material", () => {
  // `wornShader` throws when a chunk it hooks is gone; this is what a three.js update would break
  for (const name of SURFACE_NAMES) {
    const s = SURFACES[name];
    if (!("wear" in s)) continue;
    const out = wornShader(THREE.ShaderLib.physical, "backing" in s ? s.backing : 0, s.wear);
    expect(out.fragmentShader, name).toContain("wChip");
  }
});
