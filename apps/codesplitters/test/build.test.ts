import { expect, test } from "bun:test";

// The Worker bundle must resolve Better Auth as workerd does. Its browser build keeps
// request state in one slot every request shares, so on the live site overlapping
// requests cleared each other's and getSession threw "No request state found" (#216).
test("the Worker bundle gets Better Auth's real AsyncLocalStorage, not the one-slot stand-in", async () => {
  const p = Bun.spawn(["bun", "run", "build.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  const out = await Bun.file(`${import.meta.dir}/../dist/worker/worker.js`).text();
  expect(out).toContain(`import("node:async_hooks")`);
  expect(out).not.toContain("AsyncLocalStoragePolyfill");
}, 60_000);

// Fonts, icons and three.js come from the site itself (#498): the privacy page lists no
// CDN, so no page may load a script or stylesheet from another origin.
test("the pages load their scripts and styles from the site, and the build ships them", async () => {
  const p = Bun.spawn(["bun", "run", "build.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  const dist = `${import.meta.dir}/../dist/client`;
  for (const page of ["index.html", "play.html", "features.html", "reference.html", "mcp.html"]) {
    const html = await Bun.file(`${dist}/${page}`).text();
    expect(html).not.toMatch(/<script[^>]*src="(https?:)?\/\//);
    expect(html).not.toMatch(/<link[^>]*href="(https?:)?\/\/[^"]*"[^>]*stylesheet|<link[^>]*stylesheet[^>]*href="(https?:)?\/\//);
    expect(html).not.toMatch(/"imports":\s*\{[^}]*"(https?:)?\/\//);
  }
  for (const f of ["vendor/lucide.min.js", "vendor/three.module.js", "fonts/geist.css"]) expect(await Bun.file(`${dist}/${f}`).exists()).toBe(true);
}, 60_000);
