// Generates the desktop package from inference + boundary analysis.
// Nothing here edits src/. Everything lands in packages/desktop (yours to keep)
// or .rustybuns (regenerated every build).

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import type { Inferred } from "./infer.ts";
import { plan, type ModuleInfo } from "./boundary.ts";

export interface ScaffoldOut { written: string[]; skipped: string[] }

async function writeOnce(path: string, text: string, out: ScaffoldOut, force = false) {
  if (!force && existsSync(path)) { out.skipped.push(path); return; }
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, text);
  out.written.push(path);
}

/** Regenerated every build: stubs, action proxies, host action table, aliases. */
export async function generateBoundaryFiles(root: string, inf: Inferred, modules: ModuleInfo[]): Promise<ScaffoldOut> {
  const out: ScaffoldOut = { written: [], skipped: [] };
  const p = plan(modules);
  const gen = join(root, ".rustybuns");

  // 1. server-only specifiers -> one stub module. Everything is a Proxy that
  //    returns undefined/noop, so an accidental call is visible, not a crash.
  await writeOnce(join(gen, "stubs.ts"), `// GENERATED: server-only modules aliased away in the desktop client bundle.
// A server component that reaches one of these on the desktop gets undefined.
// If you need the real thing, make it a "use server" action: those run on the host.
const noop = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : noop),
  apply: () => undefined,
  construct: () => noop,
}) as any;
export default noop;
export const db = noop, prisma = noop, auth = noop, requestInfo = { ctx: { user: { id: "local", name: "local" } }, request: null, headers: new Headers() };
export const env = new Proxy({}, { get: () => noop });
export class DurableObject { constructor(public ctx: any, public env: any) {} }
`, out, true);

  // 2. action proxies: same export names, each POSTs to the host.
  for (const m of p.actions) {
    const id = m.file.replace(/[^\w]+/g, "_");
    const body = [`// GENERATED proxy for ${m.file}: "use server" runs on the Bun host.`,
      `import { callAction } from "@rustybuns/shell-bun/client";`,
      ...m.exports.map((fn) => `export const ${fn} = (...args: unknown[]) => callAction(${JSON.stringify(m.file)}, ${JSON.stringify(fn)}, args);`)].join("\n") + "\n";
    await writeOnce(join(gen, "actions", id + ".ts"), body, out, true);
  }

  // 3. host action table: imports the REAL modules, keyed by file#fn.
  const tbl = [`// GENERATED: the host's action table. Real modules, real sqlite underneath.`,
    ...p.actions.map((m, i) => `import * as a${i} from ${JSON.stringify(relative(gen, join(root, m.file)).replace(/\\/g, "/").replace(/^(?!\.)/, "./"))};`),
    `export const actions: Record<string, Record<string, (...a: any[]) => unknown>> = {`,
    ...p.actions.map((m, i) => `  ${JSON.stringify(m.file)}: a${i} as any,`),
    `};`].join("\n") + "\n";
  await writeOnce(join(gen, "actions.ts"), tbl, out, true);

  // 4. one stub module per server-only specifier, exporting exactly the names
  //    the app imports from it (ESM can't fake arbitrary named exports).
  const stubFiles: Record<string, string> = {};
  const known: Record<string, string[]> = { "rwsdk/worker": ["requestInfo", "env", "waitUntil", "defineApp", "route", "render", "prefix"], "cloudflare:workers": ["env", "DurableObject", "WorkerEntrypoint"] };
  const specs = new Set([...p.stubSpecifiers, "rwsdk/worker", "cloudflare:workers"]);
  for (const spec of specs) {
    const names = new Set([...(p.stubNames[spec] ?? []), ...(known[spec] ?? [])]);
    const file = `stubs/${spec.replace(/[^\w]+/g, "_")}.ts`;
    stubFiles[spec] = "./.rustybuns/" + file;
    await writeOnce(join(gen, file), [`// GENERATED stub for ${JSON.stringify(spec)} in the desktop client bundle.`,
      `import noop, * as base from "../stubs.ts";`, `export default noop;`,
      ...[...names].map((n) => `export const ${n} = (base as any)[${JSON.stringify(n)}] ?? noop;`)].join("\n") + "\n", out, true);
  }

  // 5. the vite plugin: stub specifiers, and swap action modules for proxies by RESOLVED path
  const actionMap = Object.fromEntries(p.actions.map((m) => [join(root, m.file), join(gen, "actions", m.file.replace(/[^\w]+/g, "_") + ".ts")]));
  await writeOnce(join(gen, "vite.ts"), `// GENERATED vite plugin: the desktop client's view of the server boundary.
import type { Plugin } from "vite";
const stubs: Record<string, string> = ${JSON.stringify(Object.fromEntries(Object.entries(stubFiles).map(([k, v]) => [k, join(root, v.replace("./", ""))])), null, 2)};
const actions: Record<string, string> = ${JSON.stringify(actionMap, null, 2)};
export function rustybuns(): Plugin {
  return {
    name: "rustybuns-boundary",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (stubs[source]) return stubs[source];
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      if (r && actions[r.id]) return actions[r.id];
      return r;
    },
  };
}
`, out, true);
  return out;
}

/** Written once: the developer owns these afterwards. */
export async function scaffoldDesktopPackage(root: string, inf: Inferred, opts: { dir?: string; entryComponent?: string; aliases?: Record<string, string> } = {}): Promise<ScaffoldOut> {
  const out: ScaffoldOut = { written: [], skipped: [] };
  const dir = join(root, opts.dir ?? "packages/desktop");
  const appAliases = opts.aliases ?? { "@": inf.srcDir, ...inf.aliases };
  const hasApp = !!opts.entryComponent;

  await writeOnce(join(dir, "package.json"), JSON.stringify({
    name: "@app/desktop", private: true, type: "module",
    // declared here so strict package managers (pnpm) resolve one React
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  }, null, 2) + "\n", out);

  await writeOnce(join(dir, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${inf.name}</title>
<style>html,body,#root{margin:0;height:100%;background:#0b0e0c}</style>
</head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
`, out);

  await writeOnce(join(dir, "main.tsx"), hasApp ? `// Desktop entry. Mounts below the RSC boundary; the host vouches identity at /ws.
// StrictMode omitted on purpose: its double-mount opens two sockets in a shipped binary.
import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import ${opts.entryComponent!.split("#")[1] ?? "App"} from ${JSON.stringify(opts.entryComponent!.split("#")[0])};

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}><${opts.entryComponent!.split("#")[1] ?? "App"} netPath="/ws" /></Suspense>,
);
` : `// Desktop entry. No app component was pointed at yet, so this renders the
// Rusty Buns intro page: it proves the host, the world socket, storage and
// version. Replace the import with your own component when ready.
import { createRoot } from "react-dom/client";
import { Intro } from "@rustybuns/shell-bun/intro";
createRoot(document.getElementById("root")!).render(<Intro />);
`, out);

  await writeOnce(join(dir, "world.ts"), `// The world: a class with a Durable Object's shape and no base class.
// The host binds it in-process with sqlite storage and alarms; the same class
// (plus \`extends DurableObject\`) is your Cloudflare shell.
export default class World {
  private boots = 0;
  constructor(private ctx: any, private env: any) {
    ctx.blockConcurrencyWhile(async () => {
      this.boots = ((await ctx.storage.get("boots")) ?? 0) + 1;
      await ctx.storage.put("boots", this.boots);
    });
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const userId = request.headers.get("X-User-Id");
    if (!userId) return new Response("Unauthenticated", { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, name: request.headers.get("X-User-Name") });
    server.send(JSON.stringify({ t: "hello", userId, boots: this.boots, sockets: this.ctx.getWebSockets().length }));
    return new Response(null, { status: 101, webSocket: client } as any);
  }
  webSocketMessage(ws: any, m: string | ArrayBuffer) {
    for (const s of this.ctx.getWebSockets()) s.send(typeof m === "string" ? JSON.stringify({ t: "echo", m }) : m);
  }
  webSocketClose() {}
}
`, out);

  await writeOnce(join(root, "vite.desktop.config.ts"), `// GENERATED ONCE by rustybuns; yours now. A plain SPA build of the desktop entry:
// no rwsdk/cloudflare plugins (they emit a Worker, not an index.html).
// Server-only modules become stubs and "use server" actions become host proxies
// via the .rustybuns/vite plugin, regenerated on every \`rustybuns build desktop\`.
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { rustybuns } from "./.rustybuns/vite";

const req = createRequire(resolve(__dirname, ${JSON.stringify((opts.dir ?? "packages/desktop") + "/package.json")}));
const reactAlias = {
  react: resolve(req.resolve("react"), ".."),
  "react-dom": resolve(req.resolve("react-dom"), ".."),
  "react/jsx-runtime": req.resolve("react/jsx-runtime"),
};
export default defineConfig({
  plugins: [rustybuns()],
  root: resolve(__dirname, ${JSON.stringify(opts.dir ?? "packages/desktop")}),
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
${Object.entries(appAliases).map(([a, d]) => `      ${JSON.stringify(a)}: resolve(__dirname, ${JSON.stringify(d)}),`).join("\n")}
      ...reactAlias,
    },
    dedupe: ["react", "react-dom"${inf.hasThree ? ', "three"' : ""}],
  },
  esbuild: { jsx: "automatic" },
  build: {
    outDir: resolve(__dirname, "dist/desktop"),
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
    rollupOptions: { onwarn(w, warn) { if (w.code === "MODULE_LEVEL_DIRECTIVE") return; warn(w); } },
  },
});
`, out);
  return out;
}
