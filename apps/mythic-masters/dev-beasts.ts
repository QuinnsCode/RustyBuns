// Dev server only: POST /__beast/nudge moves one node of a beast's sheet, rebuilds that one beast (Blender, then the
// rigger) and answers when public/models/<id>.glb is new, so the gallery can hot-swap it. The builds go to one
// `bun scripts/beasts.ts --serve`, started on the first nudge, so every nudge after it skips Blender's cold start
// (#3822); it ends with the dev server (its stdin closes).
// GET /__beast/sheets answers each sheet's id and triangle budget. A production build has neither.
import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import type { Plugin } from "vite";
import { Bad, bool, obj, str } from "@rustybuns/util/guard";
import { Nudge, nudged } from "./src/nudge.ts";

const APP = import.meta.dirname;
const busy = new Set<string>();

const Built = obj({ id: str(), ok: bool(), log: str() });
type Built = ReturnType<typeof Built>;
const MARK = "@@built ";
let server: { p: ChildProcessWithoutNullStreams; waiting: ((b: Built) => void)[] } | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serve() {
  const p = spawn("bun", ["scripts/beasts.ts", "--serve"], { cwd: APP });
  const s = { p, waiting: [] as ((b: Built) => void)[] };
  let rest = "", log: string[] = [];
  p.stderr.on("data", (d) => { log = [...log, ...String(d).trim().split("\n")].slice(-6); });
  p.stdout.on("data", (d) => {
    const lines = (rest + d).split("\n");
    rest = lines.pop()!;
    for (const l of lines) if (l.startsWith(MARK)) s.waiting.shift()?.(Built(JSON.parse(l.slice(MARK.length))));
  });
  const gone = (why: string) => {
    if (server === s) server = null;
    for (const w of s.waiting.splice(0)) w({ id: "", ok: false, log: [why, ...log].join("\n") });
  };
  p.on("close", (code) => gone(`the beast builder stopped (${code})`));
  p.on("error", (e) => gone(String(e)));
  return s;
}

// One build at a time, in the order asked, through the one warm builder.
function build(id: string): Promise<Built> {
  const next = queue.then(() => new Promise<Built>((done) => {
    server ??= serve();
    server.waiting.push(done);
    server.p.stdin.write(id + "\n");
  }));
  queue = next;
  return next;
}

export function devBeasts(): Plugin {
  return {
    name: "mythic-masters-dev-beasts", apply: "serve",
    configureServer(vite) {
      vite.httpServer?.on("close", () => server?.p.stdin.end());
      const reply = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
        res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body));
      };
      vite.middlewares.use("/__beast/sheets", async (_req, res) => {
        const ids = readdirSync(join(APP, "beasts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
        const rows = await Promise.all(ids.map(async (id) => {
          const budget: unknown = JSON.parse(await readFile(join(APP, "beasts", `${id}.json`), "utf8")).budget;
          return { id, budget: typeof budget === "number" ? budget : null };
        }));
        reply(res, 200, rows);
      });
      vite.middlewares.use("/__beast/nudge", async (req, res) => {
        if (req.method !== "POST") return reply(res, 405, { error: "POST a nudge" });
        let n: Nudge;
        try {
          let text = ""; for await (const c of req) text += c;
          n = Nudge(JSON.parse(text));
        } catch (e) { return reply(res, 400, { error: e instanceof Bad ? e.message : "a JSON nudge" }); }
        if (busy.has(n.id)) return reply(res, 409, { error: `${n.id} is still building` });
        busy.add(n.id);
        try {
          const file = join(APP, "beasts", `${n.id}.json`);
          const sheet = nudged(JSON.parse(await readFile(file, "utf8")), n);
          await writeFile(file, JSON.stringify(sheet, null, 2));
          const r = await build(n.id);
          reply(res, r.ok ? 200 : 500, r);
        } catch (e) { reply(res, 404, { error: e instanceof Error ? e.message : String(e) }); }
        finally { busy.delete(n.id); }
      });
    },
  };
}
