// Fit: how easily Rusty Buns could box a repo, from what it says about itself.
// Pure text in, verdict out (no filesystem), so a host that keeps files
// elsewhere (codeSplitters keeps them in Durable Objects) can ask too.
// infer() uses the same framework detection, so there is one detector.

/** Every stack we can name. SUPPORTED lists the ones `init` reads today. */
export type Stack =
  | "rwsdk" | "tanstack-start" | "vite-react" | "vite"
  | "next" | "astro" | "sveltekit" | "react-router" | "nuxt"
  | "unknown";

export const SUPPORTED: Stack[] = ["rwsdk", "tanstack-start", "astro", "vite-react", "vite"];

const LABEL: Record<Stack, string> = {
  rwsdk: "RedwoodSDK", "tanstack-start": "TanStack Start", "vite-react": "Vite + React", vite: "Vite",
  next: "Next.js", astro: "Astro", sveltekit: "SvelteKit", "react-router": "React Router / Remix", nuxt: "Nuxt", unknown: "no framework",
};

/** Frameworks with a Cloudflare adapter that `init` doesn't infer yet. One issue tracks them all. */
const TRACKED: Partial<Record<Stack, number>> = { next: 318, sveltekit: 318, "react-router": 318, nuxt: 318 };
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
  if (deps["vite"] && deps["react"]) return "vite-react";
  if (deps["vite"]) return "vite";
  return "unknown";
}

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

  if (!pkg) {
    return { verdict: "poor", stack: "unknown", label: typescript ? "TypeScript" : "no package.json", typescript,
      reasons: ["No package.json at the top of the repo, so there's no JavaScript app to box."] };
  }

  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const stack = stackOf(deps, viteConfig ? vitePlugins(viteConfig) : []);
  const reasons: string[] = [];
  let verdict: Verdict;
  let issue: string | undefined;
  let name = LABEL[stack];
  const worker = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].find(has);
  const fetchServer = FETCH_SERVERS.find((d) => deps[d]);

  if (SUPPORTED.includes(stack)) {
    verdict = "ready";
    reasons.push(`${LABEL[stack]}: \`rustybuns init\` reads it as is.`);
  } else if (unsupported(stack)) {
    verdict = "needs-work";
    issue = unsupported(stack)!.issue;
    reasons.push(`${LABEL[stack]} has a Cloudflare adapter, but \`rustybuns init\` doesn't infer it yet.`);
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
