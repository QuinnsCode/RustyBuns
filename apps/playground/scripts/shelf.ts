// Writes public/shelf.json: the parts a game can add, one per package under packages/* whose package.json has a
// `shelf` field ({ name, picture }), with what it does (its description), the line that adds it and the apps that use it.
// `picture` names one of those apps; its screenshot (public/shots/<app>.jpg) is the part's picture.
// Run `bun run shelf` after adding a part or changing a package's description. Usage: bun scripts/shelf.ts
import { readdirSync } from "node:fs";

export type Part = { pkg: string; dir: string; name: string; does: string; add: string; published: boolean; picture: string; usedBy: string[] };

const root = `${import.meta.dir}/../../..`;
// Reads one field off parsed JSON, or undefined when it isn't there.
const field = (v: unknown, k: string): unknown => (v && typeof v === "object" ? Reflect.get(v, k) : undefined);
const text = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`${what} is missing`);
  return v;
};
const keys = (v: unknown): string[] => (v && typeof v === "object" ? Object.keys(v) : []);
const read = async (path: string): Promise<unknown> => Bun.file(path).json();
const folders = (dir: string) => readdirSync(`${root}/${dir}`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

/** The shelf as the packages describe themselves today. */
export async function shelf(): Promise<Part[]> {
  const apps = await Promise.all(folders("apps").map(async (app) => {
    const pj = await read(`${root}/apps/${app}/package.json`).catch(() => undefined);
    return { app, deps: [...keys(field(pj, "dependencies")), ...keys(field(pj, "devDependencies"))] };
  }));
  const parts: Part[] = [];
  for (const dir of folders("packages")) {
    const pj = await read(`${root}/packages/${dir}/package.json`).catch(() => undefined);
    const s = field(pj, "shelf");
    if (s === undefined) continue;
    const pkg = text(field(pj, "name"), `packages/${dir} name`);
    const published = field(pj, "private") !== true;
    const usedBy = apps.filter((a) => a.deps.includes(pkg)).map((a) => a.app);
    const picture = text(field(s, "picture"), `${pkg} shelf.picture`);
    if (!usedBy.includes(picture)) throw new Error(`${pkg} shelf.picture names ${picture}, which doesn't use it (${usedBy.join(", ")})`);
    parts.push({
      pkg, dir, name: text(field(s, "name"), `${pkg} shelf.name`),
      does: text(field(pj, "description"), `${pkg} description`).replace(/\s*Not published\.$/, ""),
      // Published parts come from npm; the rest are workspace packages, added from inside the repo.
      add: published ? `bun add ${pkg}` : `"${pkg}": "workspace:*"`,
      published, picture, usedBy,
    });
  }
  return parts;
}

if (import.meta.main) {
  const { help } = await import("../../../scripts/help.ts");
  help(import.meta.path);
  const parts = await shelf();
  await Bun.write(`${import.meta.dir}/../public/shelf.json`, `${JSON.stringify(parts, null, 2)}\n`);
  for (const p of parts) console.log(`${p.name.padEnd(16)} ${p.add.padEnd(36)} used by ${p.usedBy.length}`);
}
