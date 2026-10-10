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
