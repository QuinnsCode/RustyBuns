// The dev preview page (src/client/preview) must never ship: main.tsx only imports
// it behind import.meta.env.DEV. Build for production and look.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";

test("a production build leaves out the preview page and the dev hooks", async () => {
  const out = mkdtempSync(join(tmpdir(), "hippo-build-")), env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";                     // as `bun run build` has it (bun test sets "test", which Vite reads as a dev build)
  try {
    await build({ root: new URL("..", import.meta.url).pathname, mode: "production", logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    const files = readdirSync(join(out, "assets"));
    expect(files.some((f) => /preview|turntable/i.test(f))).toBe(false);
    const code = files.map((f) => readFileSync(join(out, "assets", f), "utf8")).join("\n");
    for (const s of ["__preview", "__hippo", "pv-stage", "Turntable", "preview/Preview"]) expect({ s, found: code.includes(s) }).toEqual({ s, found: false });
    expect(code).toContain("HIPPO TYCOON");                // and the game itself is there
  } finally { process.env.NODE_ENV = env; rmSync(out, { recursive: true, force: true }); }
}, 60_000);
