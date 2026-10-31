// Cloudflare Pages Functions (a `functions/` folder routed by file name) as a module Worker:
// `rustybuns pages-functions` writes .rustybuns/pages/index.ts, a route table importing every
// handler and `_middleware` as written, run by pages-adapter.ts. The Worker's build runs it first,
// so a new file under functions/ is a new route on the next build, on every target.
//
//   functions/api/v1/catalog.ts        ->  /api/v1/catalog
//   functions/api/datasets/[id].ts     ->  /api/datasets/:id       params.id: string
//   functions/api/tile/[[path]].ts     ->  /api/tile/:path*        params.path: string[]
//   functions/api/_middleware.ts       ->  wraps everything under /api
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const PAGES_DIR = ".rustybuns/pages";
export const PAGES_ENTRY = `${PAGES_DIR}/index.ts`;

const METHODS: Record<string, string> = {
  onRequest: "ANY", onRequestGet: "GET", onRequestPost: "POST", onRequestPut: "PUT", onRequestPatch: "PATCH",
  onRequestDelete: "DELETE", onRequestHead: "HEAD", onRequestOptions: "OPTIONS",
};
const exportsOf = (src: string) =>
  Object.keys(METHODS).filter((m) => new RegExp(`export\\s+(?:const|let|var|async\\s+function|function)\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`).test(src));

type Seg = { kind: "static" | "param" | "rest"; v: string };
export type PagesRoute = { file: string; path: string; segs: Seg[]; methods: string[] };
export type PagesMiddleware = { file: string; prefix: string[] };

const seg = (s: string): Seg => {
  const rest = /^\[\[(\w+)\]\]$/.exec(s), param = /^\[(\w+)\]$/.exec(s);
  return rest ? { kind: "rest", v: rest[1]! } : param ? { kind: "param", v: param[1]! } : { kind: "static", v: s };
};
// Pages' order: the more specific route first. Segment by segment, static beats a param beats a catch-all.
const RANK = { static: 0, param: 1, rest: 2 };
const bySpecificity = (a: { segs: Seg[] }, b: { segs: Seg[] }) => {
  for (let i = 0; i < Math.max(a.segs.length, b.segs.length); i++) {
    const x = a.segs[i], y = b.segs[i];
    if (!x) return 1;
    if (!y) return -1;
    if (RANK[x.kind] !== RANK[y.kind]) return RANK[x.kind] - RANK[y.kind];
  }
  return 0;
};

/** Every route and middleware under `fnDir`. Files and folders starting with `_` (other than `_middleware`) are helpers, as on Pages. */
export function pagesRoutes(fnDir: string): { routes: PagesRoute[]; middleware: PagesMiddleware[] } {
  const routes: PagesRoute[] = [], middleware: PagesMiddleware[] = [];
  const files = (readdirSync(fnDir, { recursive: true }) as string[]).map((f) => f.replaceAll("\\", "/"))
    .filter((f) => /\.(?:[cm]?[jt]s)$/.test(f) && !/\.(?:test|spec)\.\w+$|\.d\.ts$/.test(f)).sort();
  for (const file of files) {
    const parts = file.replace(/\.\w+$/, "").split("/");
    const name = parts.at(-1)!, dirs = parts.slice(0, -1);
    if (dirs.some((d) => d.startsWith("_") || d === "node_modules")) continue;
    const methods = exportsOf(readFileSync(join(fnDir, file), "utf8"));
    if (name === "_middleware") { if (methods.includes("onRequest")) middleware.push({ file, prefix: dirs }); continue; }
    if (name.startsWith("_") || !methods.length) continue;
    const segs = (name === "index" ? dirs : parts).map(seg);
    const path = "/" + segs.map((s) => s.kind === "static" ? s.v : s.kind === "param" ? `:${s.v}` : `:${s.v}*`).join("/");
    routes.push({ file, path, segs, methods });
  }
  routes.sort(bySpecificity);
  middleware.sort((a, b) => a.prefix.length - b.prefix.length);
  return { routes, middleware };
}

/** Workers refuse eval and new Function while a module loads unless the compatibility date is this or later (or the flag is set). */
export const EVAL_AT_STARTUP_DEFAULT_DATE = "2025-06-01";

/**
 * Whether a file under `fnDir` compiles code from strings as it loads: Ajv is imported and an unindented
 * line (module level, not inside a function) builds or calls `.compile(`. Workers throw EvalError there at startup.
 */
export function compilesAtStartup(fnDir: string): boolean {
  if (!existsSync(fnDir)) return false;
  return (readdirSync(fnDir, { recursive: true }) as string[])
    .filter((f) => /\.(?:[cm]?[jt]s)$/.test(f) && !/\.(?:test|spec)\.\w+$|\.d\.ts$/.test(f) && !f.split(/[\\/]/).includes("node_modules"))
    .some((f) => {
      const src = readFileSync(join(fnDir, f), "utf8");
      return /from\s+["']ajv(?:\/|["'])|require\(["']ajv/.test(src) && /^[^\s/*].*\.compile\(/m.test(src);
    });
}

/** A Pages project: a functions/ folder with at least one handler in it. */
export function hasPagesFunctions(dir = "."): boolean {
  const fn = join(dir, "functions");
  if (!existsSync(fn)) return false;
  const { routes, middleware } = pagesRoutes(fn);
  return routes.length + middleware.length > 0;
}

/** Writes PAGES_DIR: the adapter, the route table and the Worker entry. Returns the counts. */
export function writePagesWorker(fnDir = "functions", assetsDir?: string, out = PAGES_DIR): { routes: number; middleware: number } {
  if (!existsSync(fnDir)) throw new Error(`no ${fnDir}/ folder: nothing to route`);
  const { routes, middleware } = pagesRoutes(fnDir);
  mkdirSync(out, { recursive: true });
  copyFileSync(fileURLToPath(new URL("./pages-adapter.ts", import.meta.url)), join(out, "adapter.ts"));
  const spec = (file: string) => JSON.stringify("./" + relative(out, join(fnDir, file)).replaceAll("\\", "/").replace(/\.ts$/, ""));
  const imports = [...middleware.map((m) => m.file), ...routes.map((r) => r.file)];
  const alias = new Map(imports.map((f, i) => [f, `m${i}`]));
  // _routes.json lives with the static files: in public/ before the build, in the build output after.
  const routesJson = [assetsDir && join(assetsDir, "_routes.json"), "public/_routes.json"].find((p) => p && existsSync(p));
  const rj = routesJson ? JSON.parse(readFileSync(routesJson, "utf8")) : undefined;
  writeFileSync(join(out, "routes.ts"), [
    `// Generated by \`rustybuns pages-functions\` from ${fnDir}/. Don't edit: the Worker's build writes it again.`,
    `import type { Table } from "./adapter";`,
    ...imports.map((f) => `import * as ${alias.get(f)} from ${spec(f)};`),
    ``,
    `export const table: Table = {`,
    `  routesJson: ${JSON.stringify(rj ? { include: rj.include, exclude: rj.exclude } : undefined)},`,
    `  middleware: [`,
    ...middleware.map((m) => `    { prefix: ${JSON.stringify(m.prefix)}, fns: [${alias.get(m.file)}.onRequest].flat() },`),
    `  ],`,
    `  routes: [`,
    ...routes.map((r) => `    { path: ${JSON.stringify(r.path)}, segs: ${JSON.stringify(r.segs)}, methods: { ${r.methods.map((m) => `${METHODS[m]}: ${alias.get(r.file)}.${m}`).join(", ")} } },`),
    `  ],`,
    `};`,
    ``,
  ].join("\n"));
  writeFileSync(join(out, "index.ts"), `import { pagesWorker } from "./adapter";\nimport { table } from "./routes";\n\nexport default pagesWorker(table);\n`);
  return { routes: routes.length, middleware: middleware.length };
}
