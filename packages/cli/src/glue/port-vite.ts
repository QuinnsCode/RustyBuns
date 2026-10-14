// `rustybuns init --port-vite`: Create React App and Vue CLI apps onto Vite, so init reads them
// as a plain Vite app (#404). The mechanical part only: vite.config.ts, index.html moved up from
// public/ with its module script, %PUBLIC_URL% / <%= BASE_URL %>, REACT_APP_* / VUE_APP_* through
// loadEnv + define, and the @ alias. Anything else is printed as a note to port by hand.
// A custom webpack config gets a guided port: what it does, with names, and a draft vite.config.ts (#849).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Stack } from "./fit.ts";

/** What the port writes (package.json included), what it removes after, and what's left to port by hand. */
export interface Port {
  writes: Record<string, string>;
  remove: string[];
  notes: string[];
}

// Vite 7: @vitejs/plugin-vue2 doesn't take Vite 8 yet, and 7 still transforms with esbuild,
// which the JSX-in-.js loader below relies on.
export const PORT_DEPS = {
  vite: "^7.3.0",
  "@vitejs/plugin-react": "^5.2.0",
  "@vitejs/plugin-vue": "^6.0.0",
  "@vitejs/plugin-vue2": "^2.3.0",
} as const;

const CRA_ENTRIES = ["src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js"];
const VUE_ENTRIES = ["src/main.ts", "src/main.js"];

/** public/index.html as Vite wants it: at the root, public paths absolute, the entry a module script. */
export function portHtml(html: string, stack: "cra" | "vue-cli", entry: string, title: string): string {
  let out = stack === "cra"
    ? html.replace(/%PUBLIC_URL%/g, "")
    : html.replace(/<%=\s*BASE_URL\s*%>/g, "/")
        .replace(/<%=\s*htmlWebpackPlugin\.options\.title\s*%>/g, title)
        .replace(/[ \t]*<!--\s*built files will be auto injected\s*-->\n?/, "");
  const script = `<script type="module" src="/${entry}"></script>`;
  if (out.includes(script)) return out;
  // Indented like the line before </body>.
  const m = out.match(/\n([ \t]*)[^\n]*\n([ \t]*)<\/body>/);
  const pad = m ? m[1]! : "  ";
  return /<\/body>/i.test(out) ? out.replace(/([ \t]*)<\/body>/i, `${pad}${script}\n$1</body>`) : out + `\n${script}\n`;
}

export interface ViteConfigOpts {
  stack: "cra" | "vue-cli";
  vue2?: boolean;
  /** CRA lets .js files hold JSX; Vite needs telling. */
  jsxInJs?: boolean;
  /** Source still calls require(): let the build turn it into imports. */
  require?: boolean;
  /** `<template lang="html">`: vue-loader ignored it, the Vite plugin looks for an "html" preprocessor. */
  langHtml?: boolean;
}

export function viteConfig({ stack, vue2, jsxInJs, require, langHtml }: ViteConfigOpts): string {
  const cra = stack === "cra";
  const prefix = cra ? "REACT_APP_" : "VUE_APP_";
  const plugin = cra ? `import react from "@vitejs/plugin-react";` : `import vue from "@vitejs/plugin-vue${vue2 ? "2" : ""}";`;
  const lines = [
    `// Ported from ${cra ? "Create React App" : "Vue CLI"} by \`rustybuns init --port-vite\` (#404).`,
    `import { defineConfig, loadEnv } from "vite";`,
    ...(cra ? [] : [`import { fileURLToPath } from "node:url";`]),
    plugin,
    ``,
    `export default defineConfig(({ mode }) => {`,
    `  // ${prefix}* from .env files and the shell, inlined as process.env.${prefix}* the way ${cra ? "CRA" : "Vue CLI"} did.`,
    `  const env = loadEnv(mode, process.cwd(), "${prefix}");`,
    `  return {`,
    ...(langHtml ? [
      `    plugins: [`,
      `      // <template lang="html"> is plain HTML, as vue-loader read it.`,
      `      { name: "template-lang-html", enforce: "pre", transform: (code: string, id: string) =>`,
      `        id.endsWith(".vue") ? code.replace(/<template(\\s[^>]*)?\\slang=["']html["']/g, "<template$1") : undefined },`,
      `      vue(),`,
      `    ],`,
    ] : [`    plugins: [${cra ? "react()" : "vue()"}],`]),
    `    envPrefix: ["VITE_", "${prefix}"],`,
    `    define: {`,
    cra ? `      "process.env.PUBLIC_URL": JSON.stringify(""),` : `      "process.env.BASE_URL": JSON.stringify("/"),`,
    `      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [\`process.env.\${k}\`, JSON.stringify(v)])),`,
    `    },`,
    ...(cra ? [] : [
      `    resolve: {`,
      `      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },`,
      `      // Vue CLI resolved imports without the .vue extension.`,
      `      extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".vue"],`,
      `    },`,
    ]),
    ...(jsxInJs ? [
      `    // JSX in .js files, as CRA allowed.`,
      `    esbuild: { loader: "jsx", include: /src\\/.*\\.jsx?$/, exclude: [] },`,
      `    optimizeDeps: { esbuildOptions: { loader: { ".js": "jsx" } } },`,
    ] : []),
    ...(require ? [
      `    // require() in the app's own source: bundle it rather than leave it for the browser.`,
      `    build: { commonjsOptions: { include: [/node_modules/, /src\\//], extensions: [".js", ".jsx", ".ts", ".tsx", ".vue"], transformMixedEsModules: true } },`,
    ] : []),
    `    server: { port: ${cra ? 3000 : 8080} },`,
    `  };`,
    `});`,
  ];
  return lines.join("\n") + "\n";
}

/** Every file under dir, relative to root; node_modules skipped. */
function walk(root: string, dir: string, out: string[] = []): string[] {
  if (!existsSync(join(root, dir))) return out;
  for (const e of readdirSync(join(root, dir))) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out); else out.push(rel);
  }
  return out;
}

const SCRIPT_SWAPS: [RegExp, string][] = [
  [/\breact-scripts start\b/g, "vite"], [/\breact-scripts build\b/g, "vite build"],
  [/\bvue-cli-service serve\b/g, "vite"], [/\bvue-cli-service build\b/g, "vite build"],
];

/**
 * The port for a CRA or Vue CLI app at root, or a string saying why there isn't one.
 * Reads only; the caller checks for files it would overwrite and writes.
 */
export function planPort(root: string, stack: Stack): Port | string {
  if (stack !== "cra" && stack !== "vue-cli") return stack === "webpack" ? webpackHint(root) : `this is a ${stack} app, not Create React App or Vue CLI; --port-vite has nothing to port.`;
  const cra = stack === "cra";
  const raw = readFileSync(join(root, "package.json"), "utf8");
  const pkg = JSON.parse(raw);
  const entry = (cra ? CRA_ENTRIES : VUE_ENTRIES).find((f) => existsSync(join(root, f)));
  if (!entry) return `no ${(cra ? CRA_ENTRIES : VUE_ENTRIES).join(", ")}: --port-vite needs the app's entry where ${cra ? "CRA" : "Vue CLI"} keeps it.`;
  if (!existsSync(join(root, "public/index.html"))) return `no public/index.html: --port-vite moves it to the root as Vite's entry page.`;

  const notes: string[] = [];
  const src = walk(root, "src").filter((f) => /\.(m?[jt]sx?|vue|s[ac]ss|less)$/.test(f));
  const text = (f: string) => readFileSync(join(root, f), "utf8");
  const code = src.filter((f) => !/\.(s[ac]ss|less)$/.test(f));
  const jsxInJs = cra && code.some((f) => f.endsWith(".js") && /<\/?[A-Za-z][\w.]*[\s/>]/.test(text(f)));
  const requires = code.filter((f) => !f.endsWith("setupProxy.js") && /\brequire\(/.test(text(f)));
  if (requires.length) notes.push(`require() in ${list(requires)}: the build bundles it (commonjsOptions), but moving to import is safer.`);

  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const vueMajor = Number(String(deps.vue ?? "").replace(/^[^0-9]*/, "").split(".")[0]);
  const vue2 = !cra && vueMajor === 2;
  const devDependencies = { ...pkg.devDependencies, vite: PORT_DEPS.vite };
  const plugin = cra ? "@vitejs/plugin-react" : vue2 ? "@vitejs/plugin-vue2" : "@vitejs/plugin-vue";
  devDependencies[plugin] = PORT_DEPS[plugin];
  const next = { ...pkg, devDependencies };
  // @vitejs/plugin-vue2 needs Vue 2.7, which compiles templates itself.
  if (vue2 && !/^[\^~]?2\.(7|[89]|\d\d)/.test(String(deps.vue))) {
    for (const k of ["dependencies", "devDependencies"] as const) if (next[k]?.vue) next[k] = { ...next[k], vue: "^2.7.16" };
    notes.push(`vue ${deps.vue} -> ^2.7.16: @vitejs/plugin-vue2 needs 2.7. Check your Vue 2 plugins still agree.`);
  }
  // Vite 7's optional peer: an older @types/node (CRA shipped 16) stops npm installing it.
  const types = String(deps["@types/node"] ?? "");
  if (types && Number(types.replace(/^[^0-9]*/, "").split(".")[0]) < 20) {
    for (const k of ["dependencies", "devDependencies"] as const) if (next[k]?.["@types/node"]) next[k] = { ...next[k], "@types/node": "^20.19.0" };
    notes.push(`@types/node ${types} -> ^20.19.0: Vite 7 wants it, and npm won't install around an older one.`);
  }
  const scripts: Record<string, string> = { ...pkg.scripts };
  for (const [k, v] of Object.entries(scripts)) scripts[k] = SCRIPT_SWAPS.reduce((s, [re, to]) => s.replace(re, to), v);
  scripts.preview ??= "vite preview";
  next.scripts = scripts;
  const left = Object.entries(scripts).filter(([, v]) => /react-scripts|vue-cli-service/.test(v)).map(([k]) => k);
  notes.push(left.length
    ? `scripts ${left.join(", ")} still run ${cra ? "react-scripts" : "vue-cli-service"}; keep it for them, or move them to Vite tooling (vitest) and remove it.`
    : `nothing runs ${cra ? "react-scripts" : "@vue/cli-service"} now; remove it and its plugins when you like.`);

  const html = text("public/index.html");
  const out = portHtml(html, stack, entry, pkg.name ?? "app");
  const ejs = out.match(/<%[^>]*%>/g);
  if (ejs) notes.push(`index.html still has template tags Vite won't fill: ${[...new Set(ejs)].join(" ")}`);

  // Things this port doesn't do, found in the app.
  const env = new Set<string>();
  for (const f of code) for (const m of text(f).matchAll(/process\.env\.(\w+)/g)) env.add(m[1]!);
  const prefix = cra ? "REACT_APP_" : "VUE_APP_";
  const other = [...env].filter((k) => !k.startsWith(prefix) && !["NODE_ENV", "PUBLIC_URL", "BASE_URL"].includes(k));
  if (other.length) notes.push(`process.env.${other.join(", process.env.")}: not ${prefix}*, so not defined; add them to define in vite.config.ts.`);
  if (cra) {
    if (existsSync(join(root, "src/setupProxy.js"))) notes.push("src/setupProxy.js: port its proxies to server.proxy in vite.config.ts.");
    const svgr = code.filter((f) => /ReactComponent\s+as\b/.test(text(f)));
    if (svgr.length) notes.push(`SVGs imported as components in ${list(svgr)}: add vite-plugin-svgr.`);
    const conf = ["jsconfig.json", "tsconfig.json"].find((f) => existsSync(join(root, f)) && /"baseUrl"\s*:\s*"\.?\/?src"/.test(text(f)));
    if (conf) notes.push(`${conf} sets baseUrl to src (absolute imports): add vite-tsconfig-paths, or aliases in vite.config.ts.`);
    if (existsSync(join(root, "src/react-app-env.d.ts"))) notes.push(`src/react-app-env.d.ts references react-scripts types; for TypeScript, point it at vite/client.`);
  } else {
    const vc = ["vue.config.js", "vue.config.ts", "vue.config.cjs"].find((f) => existsSync(join(root, f)));
    if (vc) {
      // Top-level keys only: the indent of the first one.
      const pad = text(vc).match(/^([ \t]+)\w+\s*:/m)?.[1] ?? "  ";
      const keys = [...text(vc).matchAll(new RegExp(`^${pad}(\\w+)\\s*:`, "gm"))].map((m) => m[1]!);
      notes.push(`${vc} isn't read: port ${keys.length ? keys.join(", ") : "its settings"} by hand (devServer.proxy -> server.proxy, publicPath -> base).`);
    }
    if (deps["vuetify-loader"]) notes.push("vuetify-loader registered Vuetify components for you; use unplugin-vue-components with its Vuetify resolver.");
  }
  const tilde = src.filter((f) => /@(import|use)\s+["']~/.test(text(f)));
  if (tilde.length) notes.push(`~ in Sass/Less imports (${list(tilde)}): Vite doesn't strip it; drop the ~.`);

  return {
    writes: {
      "vite.config.ts": viteConfig({ stack, vue2, jsxInJs, require: requires.length > 0,
        langHtml: !cra && src.some((f) => f.endsWith(".vue") && /<template[^>]*\slang=["']html["']/.test(text(f))) }),
      "index.html": out,
      "package.json": JSON.stringify(next, null, indentOf(raw)) + "\n",
    },
    remove: ["public/index.html"],
    notes,
  };
}

const list = (fs: string[]) => fs.length > 3 ? `${fs.slice(0, 3).join(", ")} and ${fs.length - 3} more` : fs.join(", ");
const indentOf = (json: string) => json.match(/^\{\n([ \t]+)"/)?.[1] ?? 2;

/** The `{ ... }` body after `name:` in a config (brace-matched); null when not found. */
function objectAfter(cfg: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*:\\s*\\{`).exec(cfg);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  for (; i < cfg.length && depth; i++) depth += cfg[i] === "{" ? 1 : cfg[i] === "}" ? -1 : 0;
  return cfg.slice(start, i - 1);
}

/** Top-level keys of an object body (quoted or bare). */
function keysOf(body: string): string[] {
  const out: string[] = [];
  let depth = 0, at = 0;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if ((c === "," && depth === 0) || i === body.length) {
      const k = body.slice(at, i).match(/^\s*(?:["']([^"']+)["']|([\w$]+))\s*:/);
      if (k) out.push((k[1] ?? k[2])!);
      at = i + 1;
    }
  }
  return out;
}

/**
 * A custom webpack build: no automatic port (the config grows custom loaders), but a guided one. What the
 * config does that vite.config.ts must too, with the names it found, and a draft vite.config.ts to start from.
 */
export function webpackHint(root: string): string {
  const f = ["webpack.config.js", "webpack.config.ts", "webpack.config.cjs", "webpack.config.mjs", "config/webpack.config.js"].find((c) => existsSync(join(root, c)));
  const lines = [`--port-vite only ports Create React App and Vue CLI. This is a custom webpack build; port it by hand (https://github.com/QuinnsCode/RustyBuns/issues/849):`];
  const cfg = f ? readFileSync(join(root, f), "utf8") : "";
  const has = (re: RegExp) => re.test(cfg);
  const named = (what: string, keys: string[]) => keys.length ? `${what} (${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", ..." : ""})` : what;
  const aliasKeys = keysOf(objectAfter(cfg, "alias") ?? "");
  const defines = keysOf(objectAfter(cfg.replace(/DefinePlugin\s*\(\s*\{/, "DefinePlugin: {"), "DefinePlugin") ?? "");
  const entries = keysOf(objectAfter(cfg, "entry") ?? "");
  const proxy = keysOf(objectAfter(cfg, "proxy") ?? "");
  const publicPath = cfg.match(/\bpublicPath\s*:\s*["']([^"']+)["']/)?.[1];
  const todo: [boolean, string][] = [
    [true, named("index.html at the root, with <script type=\"module\" src=\"/your/entry\"> for each page", entries)],
    [entries.length > 1, "several entries: one HTML page each, listed in build.rollupOptions.input"],
    [has(/HtmlWebpackPlugin[\s\S]*HtmlWebpackPlugin/), "several HtmlWebpackPlugin pages: list them in build.rollupOptions.input"],
    [has(/HtmlWebpackPlugin/), "HtmlWebpackPlugin templates: <%= %> tags aren't filled; write the values into index.html"],
    [has(/DefinePlugin/), named("DefinePlugin -> define", defines)],
    [has(/ProvidePlugin/), "ProvidePlugin -> explicit imports, or @rollup/plugin-inject"],
    [has(/\balias\b/), named("resolve.alias -> resolve.alias", aliasKeys)],
    [has(/\bextensions\b/), "resolve.extensions -> resolve.extensions"],
    [has(/\bfallback\s*:/), "resolve.fallback (node polyfills) -> vite-plugin-node-polyfills"],
    [has(/worker-loader/), "worker-loader! imports -> new Worker(new URL(...), { type: \"module\" }) or ?worker"],
    [has(/sass-loader|less-loader/), "Sass/Less: install sass or less; drop ~ from imports"],
    [has(/raw-loader|asset\/source/), "raw-loader / asset/source -> import x from \"./f?raw\""],
    [has(/url-loader|file-loader|asset\/resource|asset\/inline/), "url-loader / file-loader / asset modules -> Vite's asset imports (?url, ?inline)"],
    [has(/svgr|svg-loader/), "SVG loaders -> vite-plugin-svgr"],
    [has(/MiniCssExtractPlugin|style-loader/), "MiniCssExtractPlugin / style-loader: Vite extracts CSS itself; drop them"],
    [has(/\bexternals\b/), "externals -> build.rollupOptions.external"],
    [has(/devServer/), named("devServer.proxy -> server.proxy", proxy)],
    [!!publicPath, `output.publicPath ${publicPath} -> base: "${publicPath}"`],
    [has(/CopyWebpackPlugin|copy-webpack-plugin/), "CopyWebpackPlugin -> public/ (copied as is)"],
    [has(/babel-loader/), "babel-loader: Vite transpiles TS/JSX itself; keep only real Babel plugins (via @vitejs/plugin-react's babel option)"],
  ];
  if (!f) lines.push("  (no webpack.config.* at the root; look where your build script points)");
  for (const [on, t] of todo) if (on) lines.push(`  - ${t}`);
  // A draft to start from: only the parts the config showed.
  const draft = [
    `import { defineConfig } from "vite";`, ``, `export default defineConfig({`,
    ...(publicPath ? [`  base: "${publicPath}",`] : []),
    ...(aliasKeys.length ? [`  resolve: { alias: { ${aliasKeys.map((k) => `${JSON.stringify(k)}: "/* path */"`).join(", ")} } },`] : []),
    ...(defines.length ? [`  define: { ${defines.map((k) => `${JSON.stringify(k)}: "/* value */"`).join(", ")} },`] : []),
    ...(proxy.length ? [`  server: { proxy: { ${proxy.map((k) => `${JSON.stringify(k)}: "/* target */"`).join(", ")} } },`] : []),
    ...(entries.length > 1 ? [`  build: { rollupOptions: { input: { ${entries.map((k) => `${k}: "${k}.html"`).join(", ")} } } },`] : []),
    `});`,
  ];
  lines.push("Start vite.config.ts from this (plugins for the loaders above go in `plugins`):", ...draft.map((l) => `  ${l}`));
  lines.push("Then `rustybuns init` reads it as a Vite app.");
  return lines.join("\n");
}
