// `rustybuns init --port-vite`: Create React App and Vue CLI apps onto Vite, so init reads them
// as a plain Vite app (#404). The mechanical part only: vite.config.ts, index.html moved up from
// public/ with its module script, %PUBLIC_URL% / <%= BASE_URL %>, REACT_APP_* / VUE_APP_* through
// loadEnv + define, and the @ alias. Anything else is printed as a note to port by hand.
// A custom webpack config gets a guided port (webpack-hint.ts): what it does, with names, and a draft vite.config.ts (#849).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Stack } from "./fit.ts";
import { webpackHint } from "./webpack-hint.ts";

/** What the port writes (package.json included), what it removes after, and what's left to port by hand. */
export interface Port {
  writes: Record<string, string>;
  remove: string[];
  notes: string[];
}

// Vite 8, except Vue 2: @vitejs/plugin-vue2 takes Vite up to 7, so that port keeps VITE_7 (#851).
export const PORT_DEPS = {
  vite: "^8.0.0",
  "@vitejs/plugin-react": "^6.0.0",
  "@vitejs/plugin-vue": "^6.0.0",
  "@vitejs/plugin-vue2": "^2.3.0",
} as const;
export const VITE_7 = "^7.3.0";

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
  /** Source still calls require(): let the build turn it into imports (Vite 7 only; Rolldown bundles it unasked). */
  require?: boolean;
  /** `<template lang="html">`: vue-loader ignored it, the Vite plugin looks for an "html" preprocessor. */
  langHtml?: boolean;
  /** vuetify-loader registered Vuetify components at build time; unplugin-vue-components does the same (#850). */
  vuetify?: boolean;
  /** vue.config.js publicPath, as Vite's base. */
  base?: string;
  /** devServer.proxy or setupProxy.js, as server.proxy. */
  proxy?: Record<string, ProxyEntry>;
}

export type ProxyEntry = string | { target?: string; changeOrigin?: boolean; ws?: boolean; secure?: boolean; pathRewrite?: Record<string, string> };

/** A plain data literal from config source, or undefined if it holds anything else (calls, names, spreads). */
export function literal(src: string): unknown {
  const bare = src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\b(true|false|null)\b|[A-Za-z_$][\w$]*\s*:/g, "");
  if (/[()=;`]|\.\.\.|[A-Za-z_$]/.test(bare)) return undefined;
  try { return new Function(`return (${src});`)(); } catch { return undefined; }
}

/** The `{...}` starting at src[at], braces balanced and strings skipped. */
function braces(src: string, at: number): string | undefined {
  let depth = 0;
  for (let i = at, q = ""; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(at, i + 1);
  }
}

const isTable = (v: unknown): v is Record<string, ProxyEntry> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;

/** server.proxy from Vue CLI's devServer.proxy, or undefined when it isn't a plain object of paths. */
export function vueCliProxy(config: string): Record<string, ProxyEntry> | undefined {
  const at = config.search(/\bproxy\s*:\s*\{/);
  const src = at < 0 ? undefined : braces(config, config.indexOf("{", at));
  const v = src && literal(src);
  return isTable(v) ? v : undefined;
}

/** server.proxy from CRA's `app.use("/api", createProxyMiddleware({...}))` calls; undefined unless every use() is that shape. */
export function craProxy(setup: string): Record<string, ProxyEntry> | undefined {
  const calls = [...setup.matchAll(/\.use\(\s*(["'])([^"']+)\1\s*,\s*(?:createProxyMiddleware|proxy)\(\s*(\{)/g)];
  const out: Record<string, ProxyEntry> = {};
  for (const m of calls) {
    const src = braces(setup, m.index! + m[0].length - 1);
    const v = src && literal(src);
    if (!v || typeof v !== "object") return undefined;
    out[m[2]!] = v as ProxyEntry;
  }
  return calls.length && calls.length === (setup.match(/\.use\(/g) ?? []).length ? out : undefined;
}

/** A proxy table as vite.config.ts lines; http-proxy-middleware's pathRewrite becomes Vite's rewrite function. */
function proxyLines(proxy: Record<string, ProxyEntry>): string[] {
  return Object.entries(proxy).map(([path, e]) => {
    if (typeof e === "string") return `        ${JSON.stringify(path)}: ${JSON.stringify(e)},`;
    const { pathRewrite, ...rest } = e;
    const props = Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    if (pathRewrite) {
      const rules = Object.entries(pathRewrite).map(([re, to]) => `[new RegExp(${JSON.stringify(re)}), ${JSON.stringify(to)}]`);
      props.push(`rewrite: (p: string) => ([${rules.join(", ")}] as const).reduce((s, [re, to]) => s.replace(re, to), p)`);
    }
    return `        ${JSON.stringify(path)}: { ${props.join(", ")} },`;
  });
}

export function viteConfig({ stack, vue2, jsxInJs, require, langHtml, vuetify, base, proxy }: ViteConfigOpts): string {
  const cra = stack === "cra";
  const prefix = cra ? "REACT_APP_" : "VUE_APP_";
  const plugin = cra ? `import react from "@vitejs/plugin-react";` : `import vue from "@vitejs/plugin-vue${vue2 ? "2" : ""}";`;
  const lines = [
    `// Ported from ${cra ? "Create React App" : "Vue CLI"} by \`rustybuns init --port-vite\` (#404).`,
    `import { defineConfig, loadEnv${jsxInJs ? ", transformWithOxc, type Plugin" : ""} } from "vite";`,
    ...(cra ? [] : [`import { fileURLToPath } from "node:url";`]),
    plugin,
    ...(vuetify ? [`import Components from "unplugin-vue-components/vite";`, `import { VuetifyResolver } from "unplugin-vue-components/resolvers";`] : []),
    ...(jsxInJs ? [
      ``,
      `// JSX in .js files, as CRA allowed: Oxc picks the language from the extension, so parse them as JSX first.`,
      `const jsxInJs = (): Plugin => ({`,
      `  name: "jsx-in-js",`,
      `  enforce: "pre",`,
      `  transform: { filter: { id: /\\/src\\/.*\\.js$/ }, handler: (code, id) => transformWithOxc(code, id, { lang: "jsx" }) },`,
      `});`,
    ] : []),
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
      ...(vuetify ? [`      Components({ resolvers: [VuetifyResolver()] }),`] : []),
      `    ],`,
    ] : [`    plugins: [${cra ? (jsxInJs ? "jsxInJs(), react()" : "react()") : vuetify ? "vue(), Components({ resolvers: [VuetifyResolver()] })" : "vue()"}],`]),
    ...(base ? [`    base: ${JSON.stringify(base)},`] : []),
    `    envPrefix: ["VITE_", "${prefix}"],`,
    `    define: {`,
    cra ? `      "process.env.PUBLIC_URL": JSON.stringify(""),` : `      "process.env.BASE_URL": JSON.stringify(${JSON.stringify(base ?? "/")}),`,
    `      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [\`process.env.\${k}\`, JSON.stringify(v)])),`,
    `    },`,
    ...(cra ? [] : [
      `    resolve: {`,
      `      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },`,
      `      // Vue CLI resolved imports without the .vue extension.`,
      `      extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".vue"],`,
      `    },`,
    ]),
    ...(require && vue2 ? [
      `    // require() in the app's own source: bundle it rather than leave it for the browser.`,
      `    build: { commonjsOptions: { include: [/node_modules/, /src\\//], extensions: [".js", ".jsx", ".ts", ".tsx", ".vue"], transformMixedEsModules: true } },`,
    ] : []),
    ...(proxy ? [`    server: {`, `      port: ${cra ? 3000 : 8080},`, `      proxy: {`, ...proxyLines(proxy), `      },`, `    },`]
      : [`    server: { port: ${cra ? 3000 : 8080} },`]),
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
  const devDependencies = { ...pkg.devDependencies, vite: vue2 ? VITE_7 : PORT_DEPS.vite };
  const plugin = cra ? "@vitejs/plugin-react" : vue2 ? "@vitejs/plugin-vue2" : "@vitejs/plugin-vue";
  devDependencies[plugin] = PORT_DEPS[plugin];
  const next = { ...pkg, devDependencies };
  // @vitejs/plugin-vue2 needs Vue 2.7, which compiles templates itself.
  if (vue2 && !/^[\^~]?2\.(7|[89]|\d\d)/.test(String(deps.vue))) {
    for (const k of ["dependencies", "devDependencies"] as const) if (next[k]?.vue) next[k] = { ...next[k], vue: "^2.7.16" };
    notes.push(`vue ${deps.vue} -> ^2.7.16: @vitejs/plugin-vue2 needs 2.7. Check your Vue 2 plugins still agree.`);
  }
  // Vite's optional peer: an older @types/node (CRA shipped 16) stops npm installing it.
  const types = String(deps["@types/node"] ?? "");
  if (types && Number(types.replace(/^[^0-9]*/, "").split(".")[0]) < 20) {
    for (const k of ["dependencies", "devDependencies"] as const) if (next[k]?.["@types/node"]) next[k] = { ...next[k], "@types/node": "^20.19.0" };
    notes.push(`@types/node ${types} -> ^20.19.0: Vite wants it, and npm won't install around an older one.`);
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
  let proxy: Record<string, ProxyEntry> | undefined, base: string | undefined, vuetify = false;
  if (cra) {
    if (existsSync(join(root, "src/setupProxy.js"))) {
      proxy = craProxy(text("src/setupProxy.js"));
      if (!proxy) notes.push("src/setupProxy.js: port its proxies to server.proxy in vite.config.ts.");
    }
    const svgr = code.filter((f) => /ReactComponent\s+as\b/.test(text(f)));
    if (svgr.length) notes.push(`SVGs imported as components in ${list(svgr)}: add vite-plugin-svgr.`);
    const conf = ["jsconfig.json", "tsconfig.json"].find((f) => existsSync(join(root, f)) && /"baseUrl"\s*:\s*"\.?\/?src"/.test(text(f)));
    if (conf) notes.push(`${conf} sets baseUrl to src (absolute imports): add vite-tsconfig-paths, or aliases in vite.config.ts.`);
    if (existsSync(join(root, "src/react-app-env.d.ts"))) notes.push(`src/react-app-env.d.ts references react-scripts types; for TypeScript, point it at vite/client.`);
  } else {
    const vc = ["vue.config.js", "vue.config.ts", "vue.config.cjs"].find((f) => existsSync(join(root, f)));
    if (vc) {
      const conf = text(vc);
      // Top-level keys only: the indent of the first one.
      const pad = conf.match(/^([ \t]+)\w+\s*:/m)?.[1] ?? "  ";
      const keys = [...conf.matchAll(new RegExp(`^${pad}(\\w+)\\s*:`, "gm"))].map((m) => m[1]!);
      const pub = conf.match(/^\s*publicPath\s*:\s*(["'])([^"']*)\1/m)?.[2];
      if (pub !== undefined) base = pub;
      proxy = vueCliProxy(conf);
      // devServer is done when proxy was all it held.
      const dev = braces(conf, conf.indexOf("{", Math.max(0, conf.search(/\bdevServer\s*:/))));
      const devDone = !!proxy && !!dev && !/\w+\s*:/.test(dev.replace(/\bproxy\s*:\s*\{[\s\S]*\}/, ""));
      const left = keys.filter((k) => !(k === "publicPath" && pub !== undefined) && !(k === "devServer" && devDone));
      if (left.length || (!keys.length)) notes.push(`${vc} isn't read: port ${left.length ? left.join(", ") : "its settings"} by hand (devServer.proxy -> server.proxy, publicPath -> base).`);
      else notes.push(`${vc} isn't read after this: publicPath and devServer.proxy are in vite.config.ts; remove it when nothing else uses it.`);
    }
    if (deps["vuetify-loader"]) {
      vuetify = true;
      devDependencies["unplugin-vue-components"] = "^0.27.5";
    }
  }
  const tilde = src.filter((f) => /@(import|use)\s+["']~/.test(text(f)));
  if (tilde.length) notes.push(`~ in Sass/Less imports (${list(tilde)}): Vite doesn't strip it; drop the ~.`);

  return {
    writes: {
      "vite.config.ts": viteConfig({ stack, vue2, jsxInJs, require: requires.length > 0,
        langHtml: !cra && src.some((f) => f.endsWith(".vue") && /<template[^>]*\slang=["']html["']/.test(text(f))),
        vuetify, base: base && base !== "/" ? base : undefined, proxy }),
      "index.html": out,
      "package.json": JSON.stringify(next, null, indentOf(raw)) + "\n",
    },
    remove: ["public/index.html"],
    notes,
  };
}

const list = (fs: string[]) => fs.length > 3 ? `${fs.slice(0, 3).join(", ")} and ${fs.length - 3} more` : fs.join(", ");
const indentOf = (json: string) => json.match(/^\{\n([ \t]+)"/)?.[1] ?? 2;
