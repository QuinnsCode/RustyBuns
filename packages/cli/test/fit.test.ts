import { expect, test } from "bun:test";
import { fit, stackOf, vitePlugins, type Stack } from "../src/glue/fit.ts";

const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) => ({ name: "app", dependencies: deps, ...extra });

test("stackOf: specific frameworks win over the vite they pull in, and the ones init doesn't read are named", () => {
  const cases: [Record<string, string>, Stack, string[]?][] = [
    [{ vite: "6", react: "19" }, "vite-react"],
    [{ vite: "6" }, "vite"],
    [{ vite: "6", "@sveltejs/kit": "2" }, "sveltekit"],
    [{ vite: "6", react: "19", "@react-router/dev": "7" }, "react-router"],
    [{ "@remix-run/node": "2" }, "react-router"],
    [{ next: "15", react: "19" }, "next"],
    [{ vite: "8", "solid-js": "1", "@solidjs/start": "2" }, "solidstart"],
    [{ vite: "6" }, "rwsdk", ["rwsdk"]],
    [{ lodash: "4" }, "unknown"],
    [{ vite: "6", "@builder.io/qwik": "1", "@builder.io/qwik-city": "1" }, "qwik"],
    [{ "@qwik.dev/core": "2", "@qwik.dev/router": "2" }, "qwik"],
    [{ "@angular/core": "20", "@angular/build": "20" }, "angular"],
    [{ gatsby: "5", react: "18" }, "gatsby"],
    [{ "react-scripts": "5", react: "18" }, "cra"],
    [{ "@vue/cli-service": "5", vue: "3" }, "vue-cli"],
    [{ webpack: "5", react: "18" }, "webpack"],
    // halfway through a port: vite wins over the webpack still in package.json
    [{ webpack: "5", vite: "6", react: "18" }, "vite-react"],
  ];
  for (const [deps, stack, plugins] of cases) expect(stackOf(deps, plugins)).toBe(stack);
});

test("ready: supported frameworks, Workers and fetch-handler servers", () => {
  const cases: [Parameters<typeof fit>[0], Record<string, unknown>][] = [
    [{ pkg: pkg({ vite: "6", react: "19", typescript: "5" }), files: ["package.json", "src/main.tsx"] }, { stack: "vite-react", label: "Vite + React, TypeScript", typescript: true }],
    [{ pkg: pkg({}), files: ["wrangler.jsonc"], viteConfig: null }, { label: "Cloudflare Worker" }],
    [{ pkg: pkg({ hono: "4" }), files: [] }, { label: "hono" }],
    [{ pkg: pkg({ astro: "7", "@astrojs/cloudflare": "14" }), files: ["astro.config.mjs"] }, { stack: "astro", label: "Astro" }],
    [{ pkg: pkg({ nuxt: "4", vue: "3" }), files: ["nuxt.config.ts"] }, { stack: "nuxt", label: "Nuxt, TypeScript" }],
    [{ pkg: pkg({ "@solidjs/start": "2", "solid-js": "1", vite: "8" }), files: ["wrangler.jsonc"] }, { stack: "solidstart" }],
    [{ pkg: pkg({ "@builder.io/qwik": "1", "@builder.io/qwik-city": "1", vite: "7" }), files: [] }, { stack: "qwik" }],
  ];
  for (const [input, want] of cases) {
    const got = fit(input);
    expect(got).toMatchObject({ verdict: "ready", ...want });
    expect(got.issue).toBeUndefined();
  }
});

test("Next.js, React Router and SvelteKit are ready with their Cloudflare build, and need work without it", () => {
  const next = { next: "16", react: "19", "react-dom": "19" };
  const rr = pkg({ react: "19", "react-router": "7", "@react-router/dev": "7", vite: "7" });
  const cf = `import { reactRouter } from "@react-router/dev/vite";\nimport { cloudflare } from "@cloudflare/vite-plugin";`;
  expect(vitePlugins(cf)).toEqual(["react-router", "cloudflare"]);
  const sk = { "@sveltejs/kit": "2", svelte: "5", vite: "7" };
  const cases: [Parameters<typeof fit>[0], Parameters<typeof fit>[0], Stack, string][] = [
    [{ pkg: pkg({ ...next, "@opennextjs/cloudflare": "1" }), files: ["open-next.config.ts", "tsconfig.json"] }, { pkg: pkg(next), files: ["tsconfig.json"] }, "next", "@opennextjs/cloudflare"],
    [{ pkg: rr, files: [], viteConfig: cf }, { pkg: rr, files: [], viteConfig: `import { reactRouter } from "@react-router/dev/vite";` }, "react-router", "@cloudflare/vite-plugin"],
    [{ pkg: pkg({ ...sk, "@sveltejs/adapter-cloudflare": "7" }), files: [] }, { pkg: pkg({ ...sk, "@sveltejs/adapter-auto": "6" }), files: [] }, "sveltekit", "adapter-cloudflare"],
  ];
  for (const [ready, without, stack, adapter] of cases) {
    const f = fit(ready);
    expect(f).toMatchObject({ verdict: "ready", stack });
    expect(f.issue).toBeUndefined();
    const plain = fit(without);
    expect(plain).toMatchObject({ verdict: "needs-work", stack });
    expect(plain.reasons[0]).toContain(adapter);
    expect(plain.issue).toMatch(/issues\/2455$/);
  }
  expect(fit({ pkg: pkg({ ...next, "@opennextjs/cloudflare": "1" }), files: ["tsconfig.json"] }).label).toBe("Next.js, TypeScript");
});

test("Angular and Gatsby link their issue and say they are out of scope, not 'not yet'", () => {
  const f = fit({ pkg: pkg({ "@angular/core": "20" }), files: ["tsconfig.json"] });
  expect(f).toMatchObject({ verdict: "needs-work", stack: "angular", label: "Angular, TypeScript" });
  expect(f.issue).toMatch(/issues\/2455$/);
  for (const dep of [{ "@angular/core": "20" }, { gatsby: "5", react: "18" }] as Record<string, string>[]) {
    expect(fit({ pkg: pkg(dep), files: [] }).reasons.join(" ")).toContain("out of scope");
  }
});

test("needs work: webpack builds point at the Vite port issue", () => {
  for (const d of [{ "react-scripts": "5" }, { "@vue/cli-service": "5" }, { webpack: "5" }] as Record<string, string>[]) {
    const f = fit({ pkg: pkg(d), files: [] });
    expect(f.verdict).toBe("needs-work");
    expect(f.issue).toMatch(d.webpack ? /issues\/849$/ : /issues\/404$/);
    expect(f.reasons[0]).toContain("--port-vite");
  }
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

test("no package.json: plain HTML is ready, a generator's site likely, anything else a poor fit", () => {
  expect(fit({ pkg: null, files: ["main.go"] })).toMatchObject({ verdict: "poor", typescript: false });
  expect(fit({ pkg: null, files: ["index.html", "style.css"] })).toMatchObject({ verdict: "ready", label: "static HTML site" });
  expect(fit({ pkg: null, files: ["README.md", "docs/index.html"] }).verdict).toBe("ready");
  expect(fit({ pkg: null, files: ["_config.yml", "_layouts/default.html", "index.md"] })).toMatchObject({ verdict: "likely", label: "Jekyll site" });
  expect(fit({ pkg: null, files: ["hugo.toml", "content/_index.md"] }).label).toBe("Hugo site");
  expect(fit({ pkg: null, files: ["mkdocs.yml", "docs/index.md"] }).label).toBe("MkDocs site");
  // a Vite app's index.html is the app's entry, not a static site
  expect(fit({ pkg: { dependencies: { vite: "6" } }, files: ["index.html"] }).label).not.toContain("static");
});

test("Rat Stack: its web app is named and ready, and keeps its own deploy pins", () => {
  const web = fit({ pkg: { name: "@rat-stack/web", dependencies: { "@rat-stack/core": "workspace:*", alchemy: "2.0.0-beta.87", effect: "4.1.4", foldkit: "0.170.0" }, devDependencies: { vite: "8.3.8", typescript: "7.0.2" } }, files: ["package.json", "vite.config.ts", "src/main.ts"] });
  expect(web).toMatchObject({ verdict: "ready", stack: "vite", label: "Rat Stack (Vite), TypeScript" });
  expect(web.reasons.join("\n")).toContain("keeps its versions");
});
