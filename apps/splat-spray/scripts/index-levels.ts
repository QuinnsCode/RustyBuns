// Lists the scanned rooms the game can open: every folder in the scenes dir with a labels.json and a
// 3dgs_compressed.ply gets a row in levels.json, which the menu reads. Run it after adding a room.
//   bun scripts/index-levels.ts [dir]      (default SPLAT_ROOMS_DIR or ~/Documents/SplatRooms)
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = (process.argv[2] ?? process.env.SPLAT_ROOMS_DIR ?? "~/Documents/SplatRooms").replace(/^~/, homedir());
const levels = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "labels.json")) && existsSync(join(dir, e.name, "3dgs_compressed.ply")))
  .map((e) => ({ id: e.name, name: e.name.replace(/^\d+_/, "Room ") }))
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(dir, "levels.json"), JSON.stringify(levels, null, 1));
console.log(`${levels.length} room${levels.length === 1 ? "" : "s"} in ${join(dir, "levels.json")}`);
