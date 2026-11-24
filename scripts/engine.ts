// Queng's parts list (ENGINE.md, build order step 2): every runtime part and the apps that use it, read from the
// repo, so nobody has to grep for the runtime. A part is a `packages/*` package (its name and package.json
// `description`) or a `@rustybuns/util` module (its side from packages/util/api.json, whether it is stable, and the
// first sentence of its doc comment). Its users are the apps whose source imports `@rustybuns/<pkg>` or
// `@rustybuns/<pkg>/<sub>`; tests, node_modules and build output don't count. A part nobody imports says so.
//
//   bun run engine                  one line per part: kind, users, doc
//   bun run engine util/eqosys      one part (also: eqosys, gear, @rustybuns/gear/circuit) and every app using it
//   bun run engine --json           the same list as JSON
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { help } from "./help.ts";
import { appDirs } from "./app-dirs.ts";
import { arr, check, obj, opt, str } from "../packages/util/src/guard.ts";

const ROOT = join(import.meta.dir, "..");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const Pkg = obj({ name: str(200), description: opt(str(4000)) });
const Api = obj({ stable: arr(str(100), 500), shared: arr(str(100), 500), web: arr(str(100), 500), server: arr(str(100), 500) });

export type User = { app: string; files: number; imports: string[] };
export type Part = {
  /** `cli`, `gear` for a package; `util/eqosys` for a util module. */
  name: string;
  kind: "package" | "util";
  side?: "shared" | "web" | "server";
  stable?: boolean;
  doc: string;
  users: User[];
  /** Other parts that import this one (`util/eqosys` imports `util/skin`; `game-controls` imports `ui`). */
  inside: string[];
};

/** The first sentence of a file's leading `//` comment, or of its first `/** *\/` doc when it has none. */
export function firstDoc(src: string): string {
  const lines = src.replace(/^#!.*\n/, "").split("\n");
  const lead: string[] = [];
  for (const l of lines) {
    if (!l.startsWith("//")) break;
    lead.push(l.replace(/^\/\/ ?/, "").trim());
  }
  let text = lead.join(" ").trim();
  if (!text) text = /\/\*\*\s*([\s\S]*?)\*\//.exec(src)?.[1]?.replace(/^\s*\*\s?/gm, "").replace(/\s+/g, " ").trim() ?? "";
  return /^(.*?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
}

const SKIP_DIRS = new Set(["node_modules", "test", "tests", "__tests__", "dist", "build", "out", ".output", "target", "coverage", ".wrangler", ".alchemy", ".vite", ".svelte-kit", ".astro", ".next", ".turbo"]);
const SOURCE = /\.(ts|tsx|mts|js|jsx|mjs|svelte|vue|astro|html)$/;
const LEAD = String.raw`(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*["'\`]`;
/** `@rustybuns/util/eqosys`, and the same file reached by path (`../../../packages/util/src/eqosys.ts`). */
const IMPORT = new RegExp(`${LEAD}(?:@rustybuns\\/([a-z0-9-]+)((?:\\/[\\w.-]+)*)|(?:\\.\\.\\/)+packages\\/([a-z0-9-]+)\\/src\\/([\\w./-]+?))["'\`]`, "g");
const LOCAL = new RegExp(`${LEAD}\\.\\/([\\w-]+)\\.ts["'\`]`, "g");

/** The specifiers one file imports, as `util/eqosys` or `gear/circuit` (a path into a package's src counts too). */
function specs(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(IMPORT)) {
    if (m[1]) out.add(`${m[1]}${m[2]}`);
    else { const sub = m[4].replace(/\.ts$/, ""); out.add(m[3] === "util" ? (sub === "index" ? "util" : `util/${sub}`) : m[3]); }
  }
  return out;
}

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) yield* sources(join(dir, e.name)); }
    else if (SOURCE.test(e.name) && !/\.(test|spec)\.\w+$/.test(e.name) && !e.name.endsWith(".d.ts")) yield join(dir, e.name);
  }
}

/** Every `@rustybuns/...` specifier an app's source imports, with how many files import it. */
function appImports(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of sources(dir)) {
    for (const s of specs(readFileSync(f, "utf8"))) out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

/** The util module a specifier under `@rustybuns/util` lands in (`util` -> index, `util/eqosys.ts` -> eqosys). */
const utilModule = (spec: string) => (spec === "util" ? "index" : spec.slice("util/".length).replace(/\.ts$/, ""));

/** Every runtime part under `root` and the apps that import it. */
export function engine(root = ROOT): Part[] {
  const parts: Part[] = [];
  const pkgDir = join(root, "packages");
  for (const dir of existsSync(pkgDir) ? readdirSync(pkgDir).sort() : []) {
    const file = join(pkgDir, dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg = check(Pkg, JSON.parse(readFileSync(file, "utf8")));
    if (!pkg?.name.startsWith("@rustybuns/")) continue;
    parts.push({ name: pkg.name.slice("@rustybuns/".length), kind: "package", doc: pkg.description ?? "", users: [], inside: [] });
  }
  const apiFile = join(pkgDir, "util", "api.json");
  const api = existsSync(apiFile) ? check(Api, JSON.parse(readFileSync(apiFile, "utf8"))) : null;
  if (api) {
    const sides = [...api.shared.map((m) => [m, "shared"] as const), ...api.web.map((m) => [m, "web"] as const), ...api.server.map((m) => [m, "server"] as const)];
    for (const [m, side] of sides.sort(([a], [b]) => a.localeCompare(b))) {
      const src = join(pkgDir, "util", "src", `${m}.ts`);
      parts.push({ name: `util/${m}`, kind: "util", side, stable: api.stable.includes(m), doc: existsSync(src) ? firstDoc(readFileSync(src, "utf8")) : "", users: [], inside: [] });
    }
  }
  const byName = new Map(parts.map((p) => [p.name, p]));
  const add = (part: Part | undefined, app: string, spec: string, files: number) => {
    if (!part) return;
    let u = part.users.find((x) => x.app === app);
    if (!u) part.users.push((u = { app, files: 0, imports: [] }));
    u.files += files;
    if (!u.imports.includes(`@rustybuns/${spec}`)) u.imports.push(`@rustybuns/${spec}`);
  };
  for (const [app, dir] of existsSync(join(root, "apps")) ? appDirs(root) : []) {
    for (const [spec, files] of appImports(join(root, dir))) {
      const pkg = spec.split("/")[0];
      add(byName.get(pkg), app, spec, files);
      if (pkg === "util") add(byName.get(`util/${utilModule(spec)}`), app, spec, files);
    }
  }
  // Parts that use other parts: a package's @rustybuns imports, and util's modules importing each other by `./x.ts`.
  const inside = (target: Part | undefined, from: string) => { if (target && target.name !== from && !target.inside.includes(from)) target.inside.push(from); };
  for (const p of parts.filter((x) => x.kind === "package")) {
    const src = join(pkgDir, p.name, "src");
    if (!existsSync(src)) continue;
    for (const f of sources(src)) {
      const text = readFileSync(f, "utf8");
      const from = p.name === "util" ? `util/${f.slice(src.length + 1).replace(/\.ts$/, "")}` : p.name;
      for (const spec of specs(text)) inside(byName.get(spec.split("/")[0] === "util" ? `util/${utilModule(spec)}` : spec.split("/")[0]), from);
      if (p.name === "util") for (const m of text.matchAll(LOCAL)) inside(byName.get(`util/${m[1]}`), from);
    }
  }
  for (const p of parts) p.inside.sort();
  for (const p of parts) p.users.sort((a, b) => b.files - a.files || a.app.localeCompare(b.app));
  return parts;
}

/** A part by any name a person would type: `util/eqosys`, `eqosys`, `gear`, `@rustybuns/gear/circuit`. */
export function find(parts: Part[], q: string): Part | undefined {
  const s = q.replace(/^@rustybuns\//, "").replace(/\.ts$/, "");
  return parts.find((p) => p.name === s) ?? parts.find((p) => p.name === `util/${s}`) ?? parts.find((p) => p.kind === "package" && p.name === s.split("/")[0]);
}

const tag = (p: Part) => (p.kind === "package" ? "package" : `${p.side}${p.stable ? " stable" : ""}`);
const usedBy = (p: Part) => {
  if (!p.users.length) return p.inside.length ? `no apps; inside ${p.inside.slice(0, 3).join(", ")}${p.inside.length > 3 ? ` +${p.inside.length - 3}` : ""}` : "no users";
  const names = p.users.slice(0, 4).map((u) => u.app).join(", ");
  return `${p.users.length} app${p.users.length === 1 ? "" : "s"}: ${names}${p.users.length > 4 ? ` +${p.users.length - 4}` : ""}`;
};

/** One line per part. */
export function list(parts: Part[]): string {
  const w = Math.max(...parts.map((p) => p.name.length), 4);
  const lines = parts.map((p) => `${p.name.padEnd(w)}  ${tag(p).padEnd(13)}  ${cut(p.doc, 90) || "(no doc)"}  [${usedBy(p)}]`);
  const idle = parts.filter((p) => !p.users.length && !p.inside.length).length;
  return [...lines, "", `${parts.length} parts, ${idle} with no users at all. bun run engine <part> for one part and all its users.`].join("\n");
}

/** One part, and every app that uses it with what it imports. */
export function detail(p: Part): string {
  const head = [`${p.name} (${tag(p)})`, p.doc || "(no doc)", p.kind === "util" ? `packages/util/src/${p.name.slice(5)}.ts` : `packages/${p.name}`];
  const users = p.users.length
    ? p.users.map((u) => `  ${u.app}: ${u.files} file${u.files === 1 ? "" : "s"} (${u.imports.join(", ")})`)
    : ["  no app imports it"];
  const via = p.inside.length ? ["", `Imported inside the runtime by: ${p.inside.join(", ")}`] : [];
  return [...head, "", `Used by ${p.users.length}:`, ...users, ...via].join("\n");
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const rootAt = args.indexOf("--root");
  const root = rootAt >= 0 ? args[rootAt + 1] : ROOT;
  const rest = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
  const parts = engine(root);
  if (rest[0]) {
    const p = find(parts, rest[0]);
    if (!p) { console.error(`No part ${rest[0]}. bun run engine lists them.`); process.exit(1); }
    console.log(args.includes("--json") ? JSON.stringify(p, null, 2) : detail(p));
  } else console.log(args.includes("--json") ? JSON.stringify(parts, null, 2) : list(parts));
}
