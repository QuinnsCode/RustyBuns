// Where each app lives. An app's id is its folder's own name ("hippo-tycoon", "astro-example"); most sit in apps/<id>,
// and a group folder holds a level more: the framework samples are apps/frameworks/<id>, out of the way of the
// apps people play with. Ids stay unique across groups, so CI rows, artifacts, tiers and channels never change.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");

export const GROUPS = ["frameworks"];

/** Every app (a folder with a package.json) as id -> its folder, relative to `root` (`apps/<id>` or `apps/<group>/<id>`). */
export function appDirs(root = REPO): Map<string, string> {
  const kids = (d: string) => readdirSync(join(root, d), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const out = new Map<string, string>();
  for (const name of kids("apps").sort()) {
    if (GROUPS.includes(name)) for (const id of kids(`apps/${name}`).sort()) out.set(id, `apps/${name}/${id}`);
    else out.set(name, `apps/${name}`);
  }
  for (const [id, dir] of out) if (!existsSync(join(root, dir, "package.json"))) out.delete(id);
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** One app's folder, relative to `root`. An id no group holds (a new app, an old one) is `apps/<id>`. */
export function appDir(id: string, root = REPO): string {
  for (const g of GROUPS) if (existsSync(join(root, "apps", g, id, "package.json"))) return `apps/${g}/${id}`;
  return `apps/${id}`;
}

/** The app a repo path belongs to (`apps/frameworks/astro-example/src/x.ts` -> astro-example), or undefined. */
export function appOf(path: string): string | undefined {
  const m = path.match(/^apps\/([^/]+)\/(?:([^/]+)\/)?/);
  if (!m) return undefined;
  return GROUPS.includes(m[1]!) ? m[2] : m[1];
}

/** From an app's folder back up to the repo root: "../../" or "../../../". */
export const upFrom = (dir: string) => "../".repeat(dir.split("/").length);
