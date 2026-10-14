import { expect, test } from "bun:test";
import { fit, stackOf, vitePlugins } from "../src/glue/fit.ts";

const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) => ({ name: "app", dependencies: deps, ...extra });

test("stackOf: specific frameworks win over the vite they pull in", () => {
  expect(stackOf({ vite: "6", react: "19" })).toBe("vite-react");
  expect(stackOf({ vite: "6" })).toBe("vite");
  expect(stackOf({ vite: "6", "@sveltejs/kit": "2" })).toBe("sveltekit");
  expect(stackOf({ vite: "6", react: "19", "@react-router/dev": "7" })).toBe("react-router");
  expect(stackOf({ "@remix-run/node": "2" })).toBe("react-router");
  expect(stackOf({ next: "15", react: "19" })).toBe("next");
  expect(stackOf({ vite: "6" }, ["rwsdk"])).toBe("rwsdk");
  expect(stackOf({ lodash: "4" })).toBe("unknown");
});

test("stackOf: names the frameworks init doesn't read yet", () => {
  expect(stackOf({ vite: "6", "@solidjs/start": "1" })).toBe("solidstart");
  expect(stackOf({ vite: "6", "@builder.io/qwik": "1", "@builder.io/qwik-city": "1" })).toBe("qwik");
  expect(stackOf({ "@qwik.dev/core": "2", "@qwik.dev/router": "2" })).toBe("qwik");
  expect(stackOf({ "@angular/core": "20", "@angular/build": "20" })).toBe("angular");
  expect(stackOf({ gatsby: "5", react: "18" })).toBe("gatsby");
  expect(stackOf({ "react-scripts": "5", react: "18" })).toBe("cra");
  expect(stackOf({ "@vue/cli-service": "5", vue: "3" })).toBe("vue-cli");
  expect(stackOf({ webpack: "5", react: "18" })).toBe("webpack");
  // halfway through a port: vite wins over the webpack still in package.json
  expect(stackOf({ webpack: "5", vite: "6", react: "18" })).toBe("vite-react");
});

test("vitePlugins: by the packages a config imports", () => {
  const src = `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport { cloudflare } from "@cloudflare/vite-plugin";`;
  expect(vitePlugins(src)).toEqual(["react", "cloudflare"]);
});

test("ready: supported frameworks, Workers and fetch-handler servers", () => {
  const vr = fit({ pkg: pkg({ vite: "6", react: "19", typescript: "5" }), files: ["package.json", "src/main.tsx"] });
  expect(vr).toMatchObject({ verdict: "ready", stack: "vite-react", label: "Vite + React, TypeScript", typescript: true });
  expect(fit({ pkg: pkg({}), files: ["wrangler.jsonc"], viteConfig: null })).toMatchObject({ verdict: "ready", label: "Cloudflare Worker" });
  expect(fit({ pkg: pkg({ hono: "4" }), files: [] })).toMatchObject({ verdict: "ready", label: "hono" });
  expect(fit({ pkg: pkg({ astro: "7", "@astrojs/cloudflare": "14" }), files: ["astro.config.mjs"] })).toMatchObject({ verdict: "ready", stack: "astro", label: "Astro" });
});

test("needs work: a framework init doesn't infer yet links its issue", () => {
  const f = fit({ pkg: pkg({ next: "15", react: "19" }), files: ["tsconfig.json"] });
  expect(f).toMatchObject({ verdict: "needs-work", stack: "next", label: "Next.js, TypeScript" });
  expect(f.issue).toMatch(/issues\/318$/);
});

test("React Router is ready built as a Worker (@cloudflare/vite-plugin), needs work on Node", () => {
  const deps = pkg({ react: "19", "react-router": "7", "@react-router/dev": "7", vite: "7" });
  const cf = `import { reactRouter } from "@react-router/dev/vite";\nimport { cloudflare } from "@cloudflare/vite-plugin";`;
  expect(vitePlugins(cf)).toEqual(["react-router", "cloudflare"]);
  expect(fit({ pkg: deps, files: [], viteConfig: cf })).toMatchObject({ verdict: "ready", stack: "react-router" });
  const node = fit({ pkg: deps, files: [], viteConfig: `import { reactRouter } from "@react-router/dev/vite";` });
  expect(node).toMatchObject({ verdict: "needs-work", stack: "react-router" });
  expect(node.reasons[0]).toContain("@cloudflare/vite-plugin");
  expect(node.issue).toMatch(/issues\/318$/);
});

test("needs work: webpack builds point at the Vite port issue", () => {
  for (const d of [{ "react-scripts": "5" }, { "@vue/cli-service": "5" }, { webpack: "5" }] as Record<string, string>[]) {
    const f = fit({ pkg: pkg(d), files: [] });
    expect(f.verdict).toBe("needs-work");
    expect(f.issue).toMatch(d.webpack ? /issues\/849$/ : /issues\/404$/);
    expect(f.reasons[0]).toContain("--port-vite");
  }
  expect(fit({ pkg: pkg({ "@angular/core": "20" }), files: [] }).issue).toMatch(/issues\/318$/);
});

test("likely: Bun or TypeScript apps with no framework", () => {
  expect(fit({ pkg: pkg({}, { devDependencies: { "@types/bun": "1" } }), files: [] })).toMatchObject({ verdict: "likely", label: "Bun" });
  expect(fit({ pkg: pkg({}), files: ["index.ts"] }).verdict).toBe("likely");
  expect(fit({ pkg: pkg({ lodash: "4" }), files: ["index.js"] }).verdict).toBe("needs-work");
});

test("red flags pull the verdict down", () => {
  expect(fit({ pkg: pkg({ express: "4" }), files: ["server.js"] }).verdict).toBe("poor");
  expect(fit({ pkg: pkg({ vite: "6", express: "4" }), files: [] }).verdict).toBe("needs-work");
  const native = fit({ pkg: pkg({ vite: "6", sharp: "0.33" }), files: [] });
  expect(native.verdict).toBe("needs-work");
  expect(native.reasons.join(" ")).toContain("sharp");
  expect(fit({ pkg: pkg({ vite: "6" }, { workspaces: ["apps/*"] }), files: [] }).verdict).toBe("needs-work");
  // Only the top level counts: a nested pnpm-workspace.yaml is some other package's business.
  expect(fit({ pkg: pkg({ vite: "6" }), files: ["vendor/pnpm-workspace.yaml"] }).verdict).toBe("ready");
});

test("no package.json is a poor fit", () => {
  expect(fit({ pkg: null, files: ["main.go"] })).toMatchObject({ verdict: "poor", typescript: false });
});

test("a static site with no app: plain HTML is ready, a generator's site likely", () => {
  expect(fit({ pkg: null, files: ["index.html", "style.css"] })).toMatchObject({ verdict: "ready", label: "static HTML site" });
  expect(fit({ pkg: null, files: ["README.md", "docs/index.html"] }).verdict).toBe("ready");
  expect(fit({ pkg: null, files: ["_config.yml", "_layouts/default.html", "index.md"] })).toMatchObject({ verdict: "likely", label: "Jekyll site" });
  expect(fit({ pkg: null, files: ["hugo.toml", "content/_index.md"] }).label).toBe("Hugo site");
  expect(fit({ pkg: null, files: ["mkdocs.yml", "docs/index.md"] }).label).toBe("MkDocs site");
  // a Vite app's index.html is the app's entry, not a static site
  expect(fit({ pkg: { dependencies: { vite: "6" } }, files: ["index.html"] }).label).not.toContain("static");
});

test("SvelteKit is ready with adapter-cloudflare, needs work without it", () => {
  const sk = { "@sveltejs/kit": "2", svelte: "5", vite: "7" };
  expect(fit({ pkg: pkg({ ...sk, "@sveltejs/adapter-cloudflare": "7" }), files: [] })).toMatchObject({ verdict: "ready", stack: "sveltekit" });
  const auto = fit({ pkg: pkg({ ...sk, "@sveltejs/adapter-auto": "6" }), files: [] });
  expect(auto).toMatchObject({ verdict: "needs-work", stack: "sveltekit" });
  expect(auto.reasons[0]).toContain("adapter-cloudflare");
  expect(auto.issue).toMatch(/issues\/318$/);
});
