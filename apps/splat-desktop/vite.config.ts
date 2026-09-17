import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { packageDirOf } from "./scripts/licenses.ts";

/** Records which npm packages ended up in the shell bundle, for the license notices. */
function bundledPackages(): Plugin {
  return {
    name: "bundled-packages",
    apply: "build",
    generateBundle() {
      const dirs = new Set<string>();
      for (const id of this.getModuleIds()) { const d = packageDirOf(id); if (d) dirs.add(d); }
      mkdirSync(resolve(__dirname, ".build"), { recursive: true });
      writeFileSync(resolve(__dirname, ".build/shell-packages.json"), JSON.stringify([...dirs].sort(), null, 2));
    },
  };
}

export default defineConfig({
  plugins: [react(), bundledPackages()],
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext" },
});
