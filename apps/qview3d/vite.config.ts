import { defineConfig } from "vite";

// The widget as one ES module at a fixed URL (/v1/qview3d.js, what shops paste) plus hashed chunks beside it
// (three.js and the hats, loaded on first view, cacheable forever). public/ is the demo shop page.
// An app build rather than lib mode, which leaves ES output unminified; base "./" makes the chunk URLs relative
// to the script, so the widget loads its chunks from its own origin on any shop's page.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    target: "es2022",
    modulePreload: false,
    rollupOptions: {
      input: "src/widget/index.ts",
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "v1/qview3d.js",
        chunkFileNames: "v1/[name]-[hash].js",
        banner: "/*! QView3D. Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0: commercial use needs a license, hello@qntbr.com */",
      },
    },
  },
  worker: { format: "es" },
});
