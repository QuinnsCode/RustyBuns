// Open finished models in Blender: an empty scene with each .glb imported.

import { existsSync } from "node:fs";

const CANDIDATES: Record<string, string[]> = {
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender"],
  win32: ["C:\\Program Files\\Blender Foundation\\Blender\\blender.exe"],
  linux: ["/usr/bin/blender", "/snap/bin/blender"],
};

/** Blender's executable, or null. BLENDER_PATH wins, then the usual install places, then PATH. */
export function findBlender(): string | null {
  const env = process.env.BLENDER_PATH;
  if (env && existsSync(env)) return env;
  for (const p of CANDIDATES[process.platform] ?? []) if (existsSync(p)) return p;
  return Bun.which("blender");
}

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
