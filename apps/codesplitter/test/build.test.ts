import { expect, test } from "bun:test";
import { inlineScriptHashes } from "../src/security.ts";

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

// The CSP is enforced (#673) without 'unsafe-inline': each page's inline scripts run because
// _headers lists their hashes. A page whose script changed without a rebuild would go blank.
test("_headers enforces the CSP and lets every page's inline scripts run by hash", async () => {
  const p = Bun.spawn(["bun", "run", "build.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  const dist = `${import.meta.dir}/../dist/client`;
  const headers = await Bun.file(`${dist}/_headers`).text();
  const policy = headers.match(/^  content-security-policy: (.*)$/m)?.[1] ?? "";
  expect(headers).not.toContain("report-only");
  const scriptSrc = policy.split("; ").find((d) => d.startsWith("script-src "))!;
  expect(scriptSrc).not.toContain("unsafe-inline");
  for (const page of ["index.html", "play.html", "features.html", "reference.html", "mcp.html"]) {
    const hashes = inlineScriptHashes(await Bun.file(`${dist}/${page}`).text());
    // The home page keeps none inline: its script is a hashed file under 'self'.
    if (page === "index.html") expect(hashes).toHaveLength(0); else expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) expect(scriptSrc).toContain(`'${h}'`);
  }
}, 60_000);

// The Worker ships minified with a linked source map (#612), which goes up to Cloudflare with
// it (worker.sourceMaps) so Workers Logs traces name the source. The map carries the source
// itself, so it may hold only the repo's own tracked code and packages: no machine paths,
// 1Password references or keys, and it never lands in the public assets.
test("the Worker is minified, its source map is linked and leaks nothing", async () => {
  const p = Bun.spawn(["bun", "run", "build.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  const dist = `${import.meta.dir}/../dist`;
  const out = await Bun.file(`${dist}/worker/worker.js`).text();
  expect(out).toEndWith("//# sourceMappingURL=worker.js.map\n");
  expect(out.split("\n").length).toBeLessThan(5_000);   // unminified, it's tens of thousands
  const map = await Bun.file(`${dist}/worker/worker.js.map`).json();
  for (const s of map.sources as string[]) expect(s).not.toMatch(/^\/|^[A-Za-z]:|\.env|\.dev\.vars|\.alchemy|\.agent-office/);
  const all = (map.sourcesContent as string[]).join("\n");
  expect(all).not.toMatch(/\/Users\/|\/home\/[a-z]|op:\/\/|sk-ant-|ghp_[A-Za-z0-9]{20}|github_pat_|AKIA[0-9A-Z]{16}/);
  expect(await Bun.file(`${dist}/client/worker.js.map`).exists()).toBe(false);
}, 60_000);

// The home page's CSS and JS are content-hashed files, cached forever, so the HTML stays small (#1470).
test("the home page links hashed CSS and JS files that _headers caches as immutable", async () => {
  const p = Bun.spawn(["bun", "run", "build.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  const dist = `${import.meta.dir}/../dist/client`;
  const html = await Bun.file(`${dist}/index.html`).text();
  expect(html.length).toBeLessThan(50_000);
  expect(html).not.toContain("<style>");
  const css = html.match(/<link href="(\/assets\/app-[0-9a-f]{10}\.css)" rel="stylesheet">/)?.[1];
  const js = html.match(/<script src="(\/assets\/app-[0-9a-f]{10}\.js)"><\/script>/)?.[1];
  expect(css).toBeTruthy();
  expect(js).toBeTruthy();
  expect(await Bun.file(`${dist}${css}`).exists()).toBe(true);
  expect(await Bun.file(`${dist}${js}`).exists()).toBe(true);
  expect(await Bun.file(`${dist}/_headers`).text()).toContain("/assets/*\n  cache-control: public, max-age=31536000, immutable");
}, 60_000);
