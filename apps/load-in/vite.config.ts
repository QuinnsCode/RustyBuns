import { defineConfig } from "vite";
import { firstScreen } from "@rustybuns/util/copy";

export default defineConfig({
  // index.html's words come from content/first-screen.json (`bun run screens` edits them).
  plugins: [firstScreen()],
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", rollupOptions: { input: ["index.html", "feel.html", "stack.html"] } },
  worker: { format: "es" },
});
