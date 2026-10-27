// Fit: how easily Rusty Buns could box a repo, from what it says about itself.
// Pure text in, verdict out (no filesystem), so a host that keeps files
// elsewhere (codeSplitter keeps them in Durable Objects) can ask too.
// infer() uses the same framework detection, so there is one detector.

/** Every stack we can name. SUPPORTED lists the ones `init` reads today. */
import { staticSite } from "./static-site.ts";

export type Stack =
  | "rwsdk" | "tanstack-start" | "vite-react" | "vite"
  | "next" | "astro" | "sveltekit" | "react-router" | "nuxt"
  | "solidstart" | "qwik" | "angular" | "gatsby"
  | "cra" | "vue-cli" | "webpack"
  | "unknown";

/** React Router counts only when it builds through @cloudflare/vite-plugin; see `inits`. */
/** SvelteKit counts only with @sveltejs/adapter-cloudflare, which builds the Worker; see `inits`. */
/** Nuxt builds its Worker with Nitro's cloudflare-module preset (.output/server/index.mjs plus .output/public). */
/** SolidStart 2 (a Vite plugin with Nitro behind it): its Cloudflare preset builds the module Worker init runs. */
export const SUPPORTED: Stack[] = ["rwsdk", "tanstack-start", "astro", "react-router", "sveltekit", "nuxt", "solidstart", "vite-react", "vite"];

const LABEL: Record<Stack, string> = {
  rwsdk: "RedwoodSDK", "tanstack-start": "TanStack Start", "vite-react": "Vite + React", vite: "Vite",
  next: "Next.js", astro: "Astro", sveltekit: "SvelteKit", "react-router": "React Router / Remix", nuxt: "Nuxt",
  solidstart: "SolidStart", qwik: "Qwik City", angular: "Angular", gatsby: "Gatsby",
  cra: "Create React App", "vue-cli": "Vue CLI", webpack: "webpack", unknown: "no framework",
};

/**
 * Frameworks `init` doesn't infer yet, and the issue tracking each: #318 for the ones with a
 * Cloudflare build (ranked in FRAMEWORKS.md), #404 for CRA and Vue CLI (`init --port-vite`), #849 for custom webpack.
 */
const TRACKED: Partial<Record<Stack, number>> = {
  next: 318, sveltekit: 318, "react-router": 318, qwik: 318, angular: 318, gatsby: 318,
  cra: 404, "vue-cli": 404, webpack: 849,
};
const ISSUES = "https://github.com/QuinnsCode/RustyBuns/issues/";

/** A framework init doesn't support yet: its name and tracking issue. */
export const unsupported = (s: Stack) => TRACKED[s] ? { name: LABEL[s], issue: ISSUES + TRACKED[s] } : null;

/** Plugins a vite.config imports, by package name. */
export function vitePlugins(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const pkg = m[1]!;
    if (/rwsdk\/vite|redwood/.test(pkg)) out.push("rwsdk");
    else if (/@cloudflare\/vite-plugin/.test(pkg)) out.push("cloudflare");
    else if (/@vitejs\/plugin-react/.test(pkg)) out.push("react");
    else if (/@tanstack\/(react-)?start/.test(pkg)) out.push("tanstack-start");
    else if (/@tailwindcss\/vite/.test(pkg)) out.push("tailwind");
    else if (/@react-router\/dev\/vite/.test(pkg)) out.push("react-router");
  }
  return out;
}

/** The framework, from deps and vite plugins. Specific frameworks first: most of them pull in vite too. */
export function stackOf(deps: Record<string, unknown>, plugins: string[] = []): Stack {
  if (deps["rwsdk"] || plugins.includes("rwsdk")) return "rwsdk";
  if (deps["@tanstack/react-start"] || deps["@tanstack/start"] || plugins.includes("tanstack-start")) return "tanstack-start";
  if (deps["next"]) return "next";
  if (deps["astro"]) return "astro";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps["@react-router/dev"] || Object.keys(deps).some((d) => d.startsWith("@remix-run/"))) return "react-router";
  if (deps["nuxt"]) return "nuxt";
  // These build with vite too, so they come before it.
  if (deps["@solidjs/start"]) return "solidstart";
  if (deps["@builder.io/qwik-city"] || deps["@qwik.dev/router"]) return "qwik";
  if (deps["@angular/core"]) return "angular";
  if (deps["gatsby"]) return "gatsby";
  if (deps["vite"] && deps["react"]) return "vite-react";
  if (deps["vite"]) return "vite";
  // webpack builds, after vite: an app halfway through a port is a Vite app.
  if (deps["react-scripts"]) return "cra";
  if (deps["@vue/cli-service"]) return "vue-cli";
  if (deps["webpack"]) return "webpack";
  return "unknown";
}

/**
 * Whether `init` reads this app. React Router only as a Worker (its Cloudflare template's
 * @cloudflare/vite-plugin), SvelteKit only with @sveltejs/adapter-cloudflare.
 */
export const inits = (stack: Stack, plugins: string[], deps: Record<string, unknown> = {}) =>
  SUPPORTED.includes(stack)
  && (stack !== "react-router" || plugins.includes("cloudflare"))
  && (stack !== "sveltekit" || !!deps["@sveltejs/adapter-cloudflare"]);

export type Verdict = "ready" | "likely" | "needs-work" | "poor";

export interface Fit {
  verdict: Verdict;
  stack: Stack;
  /** e.g. "Vite + React, TypeScript" */
  label: string;
  typescript: boolean;
  /** Why, one line each, best news first. */
  reasons: string[];
  /** The issue tracking support for this framework, when there is one. */
  issue?: string;
}

export interface FitInput {
  /** The top-level package.json, parsed; null when there isn't one. */
  pkg: Record<string, any> | null;
  /** Paths in the repo (top level is enough; deeper helps the TypeScript check). */
  files: string[];
  /** vite.config.* text, when there is one. */
  viteConfig?: string | null;
}

// Servers built on node:http rather than a fetch handler.
const NODE_SERVERS = ["express", "fastify", "koa", "@nestjs/core", "@hapi/hapi"];
// Native addons: no Worker runs them, and they don't compile into one binary.
const NATIVE = ["sharp", "better-sqlite3", "sqlite3", "canvas", "bcrypt", "@prisma/client", "prisma", "node-gyp", "puppeteer"];
// Fetch-handler servers: a Worker already, or a line away from one.
const FETCH_SERVERS = ["hono", "itty-router", "elysia"];

const ORDER: Verdict[] = ["ready", "likely", "needs-work", "poor"];
const worst = (a: Verdict, b: Verdict) => ORDER[Math.max(ORDER.indexOf(a), ORDER.indexOf(b))]!;

export function fit({ pkg, files, viteConfig }: FitInput): Fit {
  const top = new Set(files.filter((f) => !f.includes("/")));
  const has = (n: string) => top.has(n);
  const typescript = !!(pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript)
    || has("tsconfig.json") || files.some((f) => /\.(ts|tsx|mts)$/.test(f) && !f.endsWith(".d.ts"));

  // A site with no app: plain HTML, or a generator's output (GitHub Pages). init boxes the output.
  const site = staticSite(files);
  if (site && (!pkg || stackOf({ ...pkg.dependencies, ...pkg.devDependencies }) === "unknown") && !files.some((f) => /^wrangler\.(jsonc?|toml)$/.test(f))) {
    return { verdict: site.tool ? "likely" : "ready", stack: "unknown", label: site.label, typescript,
      reasons: [site.tool
        ? `A ${site.label}: \`rustybuns init\` builds it with ${site.tool} and boxes the output; ${site.tool} has to be installed.`
        : "A static HTML site: `rustybuns init` boxes its files as they are."] };
  }
  if (!pkg) {
    return { verdict: "poor", stack: "unknown", label: typescript ? "TypeScript" : "no package.json", typescript,
      reasons: ["No package.json at the top of the repo, so there's no JavaScript app to box."] };
  }

  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const plugins = viteConfig ? vitePlugins(viteConfig) : [];
  const stack = stackOf(deps, plugins);
  const reasons: string[] = [];
  let verdict: Verdict;
  let issue: string | undefined;
  let name = LABEL[stack];
  const worker = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].find(has);
  const fetchServer = FETCH_SERVERS.find((d) => deps[d]);

  if (inits(stack, plugins, deps)) {
    verdict = "ready";
    reasons.push(`${LABEL[stack]}: \`rustybuns init\` reads it as is.`);
  } else if (unsupported(stack)) {
    verdict = "needs-work";
    issue = unsupported(stack)!.issue;
    reasons.push(stack === "react-router"
      ? "React Router: `rustybuns init` reads it when @cloudflare/vite-plugin builds it (Cloudflare's current template), not through cloudflareDevProxy or a Node server."
      : stack === "sveltekit"
      ? "SvelteKit: `rustybuns init` reads it with @sveltejs/adapter-cloudflare, which builds the Worker; add it (`npm i -D @sveltejs/adapter-cloudflare`) in svelte.config.js."
      : TRACKED[stack] === 404 || stack === "webpack"
        ? stack === "webpack"
          ? "A custom webpack build: ported to Vite by hand, `rustybuns init` reads it (`init --port-vite` lists what to port)."
          : `${LABEL[stack]} builds with webpack: \`rustybuns init --port-vite\` ports it to Vite, then reads it.`
        : `${LABEL[stack]} has a Cloudflare build, but \`rustybuns init\` doesn't infer it yet.`);
  } else if (worker || fetchServer) {
    verdict = "ready";
    name = worker ? "Cloudflare Worker" : fetchServer!;
    reasons.push(worker ? `Already a Cloudflare Worker (${worker}).` : `${fetchServer} serves a fetch handler, the shape Rusty Buns runs everywhere.`);
  } else if (deps["@types/bun"] || deps["bun-types"] || has("bun.lock") || has("bun.lockb")) {
    verdict = "likely";
    name = "Bun";
    reasons.push("A Bun app with no framework: fine if its server is a fetch handler (`Bun.serve`).");
  } else if (typescript || has("index.html")) {
    verdict = "likely";
    reasons.push(has("index.html") ? "A page with no framework: Rusty Buns can serve it, with a small fetch handler for any backend." : "TypeScript with no framework: fine if it's an app with a fetch handler, not a library.");
  } else {
    verdict = "needs-work";
    reasons.push("No framework or server Rusty Buns recognises.");
  }

  const node = NODE_SERVERS.find((d) => deps[d]);
  if (node) {
    verdict = worst(verdict, stack === "unknown" && !fetchServer ? "poor" : "needs-work");
    reasons.push(`${node} runs on node:http, not a fetch handler; Workers won't run it as is.`);
  }
  const native = NATIVE.filter((d) => deps[d]);
  if (native.length) {
    verdict = worst(verdict, "needs-work");
    reasons.push(`Native ${native.length === 1 ? "addon" : "addons"} (${native.join(", ")}): no Worker runs them, and they don't fit in one binary.`);
  }
  if (pkg.workspaces || has("pnpm-workspace.yaml")) {
    verdict = worst(verdict, "needs-work");
    reasons.push("A monorepo root: Rusty Buns boxes one app, so point it at that app's folder.");
  }
  if (typescript) reasons.push("TypeScript: Bun runs it with no build step.");

  return { verdict, stack, label: name + (typescript ? ", TypeScript" : ""), typescript, reasons, ...(issue ? { issue } : {}) };
}
