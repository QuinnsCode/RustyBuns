#!/usr/bin/env bun
// Layout (gitwiz/serve.ts): `bun run gitwiz` serves gitwiz on its own, with no Worker, rebuilt on every load
// bun run gitwiz [-- --port 4783]   then open http://localhost:4783/
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGitwiz } from "./build.ts";

const app = join(import.meta.dir, "../..");
const i = process.argv.indexOf("--port");
const port = i > 0 ? Number(process.argv[i + 1]) : 4783;
const out = mkdtempSync(join(tmpdir(), "gitwiz-"));

const server = Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/" || pathname === "/gitwiz" || pathname === "/gitwiz.html") await buildGitwiz(out);
    const file =
      pathname === "/" || pathname === "/gitwiz" ? join(out, "gitwiz.html")
      : pathname === "/vendor/lucide.min.js" ? join(app, "node_modules/lucide/dist/umd/lucide.min.js")
      : pathname.startsWith("/fonts/") ? join(app, "src", pathname)
      : join(out, pathname);
    // Only the three places above are ever read from: no path climbs out of them.
    if (pathname.includes("..")) return new Response("not found", { status: 404 });
    const f = Bun.file(file);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
console.log(`gitwiz on http://localhost:${server.port}/`);
