import { defineConfig } from "vite";
import { firstScreen } from "@rustybuns/util/copy";

export default defineConfig({
  // index.html's words come from content/first-screen.json (`bun run screens` edits them).
  plugins: [firstScreen()],
  // three.js plus the baked terrain: big for a web page, fine for a desktop app.
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1500 },
});
