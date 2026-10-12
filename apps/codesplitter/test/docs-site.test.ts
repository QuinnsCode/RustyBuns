import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codesplitter } from "../../../scripts/site/codesplitter.ts";
import type { Source } from "../../../scripts/site/lib.ts";
import { tools } from "../src/mcp-tools.ts";
import { openapi } from "../src/openapi.ts";

setDefaultTimeout(20_000);

// The working tree, read from the repo root like `bun run site` does.
const root = join(import.meta.dir, "../../..");
const src: Source = { version: "latest", ref: "main", read: (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : undefined) };
const pages = codesplitter.pages(src);
const page = (path: string) => pages.find((p) => p.path === path);

describe("the codeSplitter docs site", () => {
  test("every operation has a section on its group's page, risky ones flagged", () => {
    const spec = openapi("");
    for (const [path, methods] of Object.entries(spec.paths))
      for (const [method, op] of Object.entries(methods) as [string, any][]) {
        const md = pages.find((p) => p.section === "API" && p.title === op.tags[0])?.md ?? "";
        const section = md.split(`\n## ${op.operationId}\n`)[1]?.split("\n## ")[0];
        expect(section, op.operationId).toBeDefined();
        expect(section).toContain(`\`${method.toUpperCase()} /api${path}\``);
        expect(section!.includes("x-codesplitter-risky"), op.operationId).toBe(!!op["x-codesplitter-risky"]);
      }
  });

  test("the MCP page lists the server's tools", () => {
    const md = page("api/mcp.html")!.md;
    for (const t of tools()) expect(md).toContain(`\`${t.name}\``);
    expect(md).toContain(`Its ${tools().length} tools`);
  });

  test("a page per feature and per ### in REFERENCE.md", () => {
    const reference = src.read("apps/codesplitter/REFERENCE.md")!;
    expect(page("index.html")?.md).toBe(src.read("apps/codesplitter/README.md")!);
    expect(pages.filter((p) => p.section === "Features").length).toBeGreaterThan(20);
    const subs = [...reference.split("\n## Layout")[0]!.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(pages.filter((p) => p.section === "Running it").map((p) => p.title)).toEqual(subs.map((s) => s!.replace(/`/g, "")));
  });
});
