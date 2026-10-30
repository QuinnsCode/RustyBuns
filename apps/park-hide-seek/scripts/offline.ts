// Packs src/offline.ts into ios/App/Resources/room.js, the script the iOS app runs in JavaScriptCore for offline play.
//   bun scripts/offline.ts
// The terrain package lists all 63 zones; offline play only needs the seven surveyed ones its zones.ts imports
// directly, so the lazy loader is swapped for an empty one rather than carrying 56 JSON files nobody asks for.
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const out = resolve(import.meta.dir, "../ios/App/Resources/room.js");
mkdirSync(dirname(out), { recursive: true });
const built = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "../src/offline.ts")],
  target: "browser", format: "iife", minify: true,
  plugins: [{
    name: "bundled-zones-only",
    setup(b) {
      b.onLoad({ filter: /packages\/terrain\/src\/load\.ts$/ }, () => ({
        loader: "ts",
        contents: 'export const ZONE_FILES = {}; export const loadZone = (id) => Promise.reject(new Error("no zone " + id + " offline"));',
      }));
    },
  }],
});
if (!built.success) throw new Error(built.logs.join("\n"));
await Bun.write(out, built.outputs[0]);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
