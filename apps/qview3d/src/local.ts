// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The Worker on Bun, for `bun run dev` and the tests: R2 is shell-bun's twin over a directory, and the built
// widget (dist/client) is served first, the way Cloudflare serves static assets before the Worker.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { r2 } from "@rustybuns/shell-bun";
import type { Org, Product } from "./api.ts";
import { orgKey, productKey } from "./layout.ts";
import { handle, type Env } from "./worker.ts";

const STATIC = resolve(import.meta.dir, "../dist/client");

/** The demo org: any page may embed it, with one product per hat. */
export async function seedDemo(bindings: Env) {
  const put = (k: string, v: Org | Product) => bindings.BUCKET.put(k, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });
  await put(orgKey("demo"), { origins: ["*"] });
  await put(productKey("demo", "field-cap"), { name: "Field Cap", model: "cap", colors: ["#1f2937", "#f5f5f4", "#b91c1c", "#1d4ed8", "#166534", "#e7d7b9"] });
  await put(productKey("demo", "cuff-beanie"), { name: "Cuff Beanie", model: "beanie", colors: ["#d97706", "#1f2937", "#7c3aed", "#f5f5f4"] });
  await put(productKey("demo", "bucket-hat"), { name: "Bucket Hat", model: "bucket", colors: ["#e7d7b9", "#166534", "#1f2937", "#f5f5f4"] });
}

export async function local(o: { dir: string; port?: number; secret?: string }) {
  const bindings: Env = { BUCKET: r2(join(o.dir, "bucket")), UPLOAD_SECRET: o.secret ?? crypto.randomUUID() };
  await seedDemo(bindings);
  const server = Bun.serve({
    port: o.port ?? 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = join(STATIC, path.endsWith("/") ? `${path}index.html` : path);
      if (req.method === "GET" && file.startsWith(STATIC) && existsSync(file) && statSync(file).isFile()) {
        return new Response(Bun.file(file), { headers: { "access-control-allow-origin": "*", "cache-control": "no-cache" } });
      }
      return handle(req, bindings);
    },
  });
  return { url: `http://localhost:${server.port}`, bindings, stop: () => server.stop(true) };
}
