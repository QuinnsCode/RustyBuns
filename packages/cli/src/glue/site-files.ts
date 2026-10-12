// The disk side of static-site.ts: find a site in a folder, and copy a hand-written one into dist/.
import { cpSync, existsSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { NOT_SITE, staticSite, type StaticSite } from "./static-site.ts";

/** staticSite() for a folder on disk: the top level, and one level into the folders it looks in. */
export function staticSiteAt(root: string): StaticSite | null {
  const files: string[] = [];
  const list = (d: string) => { try { return readdirSync(join(root, d), { withFileTypes: true }); } catch { return []; } };
  for (const e of list(".")) {
    files.push(e.name);
    if (e.isDirectory()) for (const c of list(e.name).slice(0, 50)) files.push(`${e.name}/${c.name}`);
  }
  return staticSite(files);
}

/** Copy a hand-written site into `to`, leaving out dotfiles, Rusty Buns' files and `to` itself. */
export function copySite(from: string, to: string) {
  const src = resolve(from), dest = resolve(to);
  // Our files only sit at the project root; a docs/ site keeps a page called desktop/.
  const atRoot = src === process.cwd();
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const keep = (p: string) => {
    const abs = resolve(p);
    if (abs === dest || abs.startsWith(dest + sep)) return false;
    const rel = relative(src, abs).split(sep);
    return !rel.some((part) => part.startsWith(".")) && !(atRoot && NOT_SITE.has(rel[0]!));
  };
  // Entry by entry: cpSync won't copy a folder into its own dist/.
  for (const e of readdirSync(src)) if (keep(join(src, e))) cpSync(join(src, e), join(dest, e), { recursive: true, filter: keep });
  if (!existsSync(join(dest, "index.html"))) throw new Error(`no index.html in ${from}: nothing to serve`);
}
