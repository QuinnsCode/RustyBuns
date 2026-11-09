// Open finished models in Blender: an empty scene with each .glb imported.

import { findBlender } from "@rustybuns/cli/blender";

export { findBlender };

/** Python for --python-expr. Paths go in as JSON strings, which Python reads as string literals. */
export function importExpr(paths: string[]): string {
  return [
    "import bpy",
    "bpy.ops.wm.read_homefile(use_empty=True)",
    `for p in ${JSON.stringify(paths)}: bpy.ops.import_scene.gltf(filepath=p)`,
  ].join("\n");
}

export function openInBlender(paths: string[]): boolean {
  const exe = findBlender();
  if (!exe) return false;
  Bun.spawn([exe, "--python-expr", importExpr(paths)], { stdout: "ignore", stderr: "ignore" }).unref();
  return true;
}
