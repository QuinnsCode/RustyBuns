// A new game from the starter (#4053): `bun run new-game rocket-golf [--title "Rocket Golf"]`.
// Copies apps/starter-game to apps/<id> under the new names (its eqosys id, its `window.<handle>` harness, its title) and
// adds its row to HANDLES in scripts/probe.ts, so `bun run probe <id>` asks the game from the first run. Then: `bun install`,
// `cd apps/<id> && bun run dev`. The same starter as a codeSplitter repo of your own is the "New game" button on the eqosys
// Studio page (POST /api/github/starter). What's left by hand, the eqosys listing and the sign-in site, is in the new README.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { help } from "./help.ts";
import { STARTER, isStarterText, renameStarter, starterNames, type StarterNames } from "../apps/codesplitter/src/starter.ts";

/** Folders a copy leaves behind: installs and builds. */
const SKIP = new Set(["node_modules", "dist", ".wrangler", ".rustybuns"]);

/** Copies the starter folder `from` to `to` under the names `n`, the text files renamed. Returns the files written. */
export function copyStarter(from: string, to: string, n: StarterNames): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const src = join(dir, name), rel = relative(from, src), dst = join(to, rel);
      if (statSync(src).isDirectory()) { walk(src); continue; }
      mkdirSync(dirname(dst), { recursive: true });
      if (isStarterText(rel)) writeFileSync(dst, renameStarter(rel, readFileSync(src, "utf8"), n));
      else cpSync(src, dst);
      out.push(rel);
    }
  };
  walk(from);
  return out.sort();
}

/** probe.ts's source with the new game's HANDLES row added at the end of the table (unchanged when it has one). */
export function withHandle(probe: string, n: StarterNames): string {
  const key = /^[a-z]+$/.test(n.id) ? n.id : JSON.stringify(n.id);
  if (probe.includes(`\n  ${key}: {`)) return probe;
  const row = `  ${key}: { state: "${n.handle}.state()", does: "the round (phase, score, lives, stars), whether you're signed in to eqosys, and the Qollab party (code, members, room, seat); start(), aim(x) (steer the basket, 0..400). Made from the starter (bun run new-game). Also --cmd ${n.prefix}_how_to_play, _start, _state" },\n`;
  const at = probe.indexOf("\n};", probe.indexOf("export const HANDLES"));
  if (at < 0) throw new Error("no HANDLES table in scripts/probe.ts");
  return probe.slice(0, at + 1) + row + probe.slice(at + 1);
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2), id = argv.find((a) => !a.startsWith("--")) ?? "";
  const t = argv.indexOf("--title"), title = t >= 0 ? argv[t + 1] : undefined;
  const n = starterNames(id, title);
  if (!n) { console.error("give the game an id: lowercase letters and digits, single dashes between, 3 to 40 long (bun run new-game rocket-golf)"); process.exit(1); }
  const root = join(import.meta.dir, ".."), to = join(root, "apps", n.id);
  if (existsSync(to)) { console.error(`apps/${n.id} is there already`); process.exit(1); }
  const files = copyStarter(join(root, STARTER.folder), to, n);
  const probe = join(root, "scripts/probe.ts");
  writeFileSync(probe, withHandle(readFileSync(probe, "utf8"), n));
  console.log(`apps/${n.id}: ${files.length} files, window.${n.handle}.state() in HANDLES.\nNext: bun install, then cd apps/${n.id} && bun run dev. Its README says how to list it on eqosys.`);
}
