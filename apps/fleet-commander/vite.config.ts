import { defineConfig } from "vite";
import { firstScreen } from "@rustybuns/util/copy";

export default defineConfig({
  // index.html's words come from content/first-screen.json (`bun run screens` edits them).
  plugins: [firstScreen()],
  // ships.html is the hull sheets' turntable (src/ships-page.ts), shipped beside the game.
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", rollupOptions: { input: { main: "index.html", ships: "ships.html" } } },
  worker: { format: "es" },
});
