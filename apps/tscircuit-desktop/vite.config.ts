import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { collectNotices, packageDirOf, writeNotices } from "./scripts/licenses.ts";

/**
 * Writes THIRD_PARTY_LICENSES.txt from the modules actually in the bundle:
 * into the UI build (so it ships inside the binary, at /THIRD_PARTY_LICENSES.txt)
 * and into dist/ (to publish next to the binaries).
 * LICENSES_STRICT=1 fails the build on unlicensed or copyleft components (use in CI).
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: "third-party-licenses",
    apply: "build",
    async generateBundle() {
      const dirs = new Set<string>();
      for (const id of this.getModuleIds()) {
        const d = packageDirOf(id);
        if (d) dirs.add(d);
      }
      const n = await collectNotices({ uiPackageDirs: [...dirs] });
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_LICENSES.txt", source: n.text });
      writeNotices(n.text, [resolve(__dirname, "dist")]);
      console.log("\n" + n.summary);
      if (n.flagged.length && process.env.LICENSES_STRICT) this.error(`${n.flagged.length} component(s) need a license review (see above)`);
    },
  };
}

export default defineConfig({
  plugins: [react(), thirdPartyLicenses()],
  resolve: {
    alias: { "circuit-json-to-altium": resolve(__dirname, "src/stubs/unavailable.ts") },
    // tscircuit packages share these as peers; one copy each, the app's.
    dedupe: ["react", "react-dom", "circuit-json", "@tscircuit/core", "@tscircuit/props", "zod"],
  },
  worker: { format: "es" },
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 30_000 },
  // tscircuit's browser bundles expect these Node-isms to exist.
  define: { global: "globalThis", "process.env": "{}" },
});
