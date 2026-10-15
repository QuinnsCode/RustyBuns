// Serves the watch page with a live feed (#1731): `bun scripts/mervin-watch.ts [--port 4177] [--dir .mervin]`.
//   /                     the page (src/mervin-watch.html); open /?live to follow the feed
//   /feed?from=N          {steps, paused}: the events `mervin-merge.ts --live` appended from the Nth on
//   PUT|DELETE /pause     write or remove the pause file that `mervin-merge.ts --go` waits on before each auto-merge
// Everything else (fonts, icons) comes from dist/client, so run the build once first.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FEED, PAUSE } from "../src/mervin-replay.ts";

/** The feed from event `from` on, and whether the pause file is there. */
export function feed(dir: string, from: number) {
  const file = join(dir, FEED);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  return { steps: lines.slice(from).map((l) => JSON.parse(l)), next: lines.length, paused: existsSync(join(dir, PAUSE)) };
}

export function pause(dir: string, on: boolean) {
  mkdirSync(dir, { recursive: true });
  if (on) writeFileSync(join(dir, PAUSE), new Date().toISOString());
  else rmSync(join(dir, PAUSE), { force: true });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const dir = resolve(arg("dir") ?? ".mervin");
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/mervin-replay.ts")], target: "browser", format: "esm" });
  const js = await built.outputs[0]!.text();
  const server = Bun.serve({
    port: Number(arg("port") ?? 4177),
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/feed") return Response.json(feed(dir, Number(u.searchParams.get("from") ?? 0)));
      if (u.pathname === "/pause" && (req.method === "PUT" || req.method === "DELETE")) { pause(dir, req.method === "PUT"); return Response.json({ paused: req.method === "PUT" }); }
      if (u.pathname === "/mervin-replay.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
      if (u.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "../src/mervin-watch.html")), { headers: { "content-type": "text/html" } });
      const asset = Bun.file(join(import.meta.dir, "../dist/client", u.pathname));
      return u.pathname.includes("..") || !(await asset.exists()) ? new Response("not found", { status: 404 }) : new Response(asset);
    },
  });
  console.log(`watch Mervin: http://localhost:${server.port}/?live  (feed ${join(dir, FEED)})`);
}
