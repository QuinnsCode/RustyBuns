// Dev server only: POST /__beast/nudge moves one node of a beast's sheet, rebuilds that one beast (Blender, then the
// rigger: `bun scripts/beasts.ts <id>`) and answers when public/models/<id>.glb is new, so the gallery can hot-swap it.
// GET /__beast/sheets answers each sheet's id and triangle budget. A production build has neither.
import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Plugin } from "vite";
import { Bad } from "@rustybuns/util/guard";
import { Nudge, nudged } from "./src/nudge.ts";

const APP = import.meta.dirname;
const busy = new Set<string>();

function build(id: string): Promise<{ ok: boolean; log: string }> {
  return new Promise((done) => {
    const p = spawn("bun", ["scripts/beasts.ts", id], { cwd: APP });
    let log = "";
    p.stdout.on("data", (d) => { log += d; }); p.stderr.on("data", (d) => { log += d; });
    p.on("close", (code) => done({ ok: code === 0, log: log.trim().split("\n").slice(-6).join("\n") }));
    p.on("error", (e) => done({ ok: false, log: String(e) }));
  });
}

export function devBeasts(): Plugin {
  return {
    name: "mythic-masters-dev-beasts", apply: "serve",
    configureServer(server) {
      const reply = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
        res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body));
      };
      server.middlewares.use("/__beast/sheets", async (_req, res) => {
        const ids = readdirSync(join(APP, "beasts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
        const rows = await Promise.all(ids.map(async (id) => {
          const budget: unknown = JSON.parse(await readFile(join(APP, "beasts", `${id}.json`), "utf8")).budget;
          return { id, budget: typeof budget === "number" ? budget : null };
        }));
        reply(res, 200, rows);
      });
      server.middlewares.use("/__beast/nudge", async (req, res) => {
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
