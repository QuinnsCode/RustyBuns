import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS } from "../src/api.ts";
import { local } from "../src/local.ts";

const src = join(import.meta.dir, "../src");

// "GET /api/repos/${c.owner}/x?q=" and "GET /api/repos/:o/x" are the same call: params are
// ":", the query goes, and an optional [/part] is both with and without it.
const SEGMENT = String.raw`(?:[\w:.\-]|\$\{[^}]*\})+`;
const PATH = String.raw`/api(?:/${SEGMENT}|\[/${SEGMENT}\])*`;
const keys = (method: string, path: string): string[] => {
  const opt = /\[(\/[^\]]+)\]/.exec(path);
  if (opt) return [...keys(method, path.replace(opt[0], "")), ...keys(method, path.replace(opt[0], opt[1]!))];
  return [`${method} ${path.split("?")[0]!.split("/").map((s) => s.startsWith(":") || s.startsWith("${") ? ":" : s).join("/")}`];
};
const documented = new Set(GROUPS.flatMap((g) => g.endpoints.flatMap((e) => keys(e.method, e.path))));

describe("the API reference", () => {
  test("has every route a comment in src/ names", () => {
    const missing: string[] = [];
    const comment = new RegExp(String.raw`^\s*(?://|\*)\s*((?:GET|POST|PUT|DELETE|WS)(?:\|(?:GET|POST|PUT|DELETE))*)\s+(${PATH})`, "gm");
    for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
      for (const [, methods, path] of readFileSync(join(src, f), "utf8").matchAll(comment)) {
        for (const m of methods!.split("|")) for (const k of keys(m, path!)) if (!documented.has(k)) missing.push(`${f}: ${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("has every call the command palette names", () => {
    const html = readFileSync(join(src, "client.html"), "utf8");
    const named = [...html.matchAll(new RegExp(String.raw`[\`"](GET|POST|PUT|DELETE|WS) (${PATH})`, "g"))];
    expect(named.length).toBeGreaterThan(20);
    expect(named.flatMap(([, m, p]) => keys(m!, p!)).filter((k) => !documented.has(k))).toEqual([]);
  });

  test("lists each call once", () => {
    const all = GROUPS.flatMap((g) => g.endpoints.map((e) => `${e.method} ${e.path.split("?")[0]}`));
    expect(all.filter((k, i) => all.indexOf(k) !== i)).toEqual([]);
  });

  test("is served at GET /api", async () => {
    const call = await local();
    afterAll(() => call.close());
    const r = await call(null, "/api");
    expect(r.status).toBe(200);
    const ref = (await r.json()) as { groups: typeof GROUPS };
    expect(ref.groups).toEqual(GROUPS);
  });
});
