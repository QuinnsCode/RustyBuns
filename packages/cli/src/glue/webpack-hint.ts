// The guided Vite port for a custom webpack build (#849): what `webpack.config.*` does that vite.config.ts must too,
// with the names found in it, and a draft vite.config.ts. Text scanning, no parser: comments and strings are masked so
// braces and keys match only real code, local `require`d / imported config files are read too, and a value held in a
// variable is followed to its `const`. Reads only; the port stays by hand because configs grow custom loaders.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

interface Src { file: string; code: string; st: string }
type Val = { kind: "object" | "array"; src: Src; start: number; end: number } | { kind: "string"; text: string } | { kind: "expr" };

/** Comments blanked (code), and also string and regex bodies replaced by `_` (st), both the same length as the input. */
export function mask(input: string): { code: string; st: string } {
  const code = input.split(""), st = input.split("");
  const blank = (arr: string[], a: number, b: number, ch?: string) => { for (let k = a; k < b; k++) if (arr[k] !== "\n") arr[k] = ch ?? " "; };
  let i = 0, prev = "";
  while (i < input.length) {
    const c = input[i]!, n = input[i + 1];
    if (c === "/" && n === "/") { const e = input.indexOf("\n", i); const end = e < 0 ? input.length : e; blank(code, i, end); blank(st, i, end); i = end; continue; }
    if (c === "/" && n === "*") { const e = input.indexOf("*/", i + 2); const end = e < 0 ? input.length : e + 2; blank(code, i, end); blank(st, i, end); i = end; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < input.length && input[j] !== c) j += input[j] === "\\" ? 2 : 1;
      blank(st, i + 1, Math.min(j, input.length), "_"); i = j + 1; prev = c; continue;
    }
    // A regex literal: a / where a value can start.
    if (c === "/" && (prev === "" || "(,=:[!&|?{};".includes(prev))) {
      let j = i + 1, cls = false;
      while (j < input.length && input[j] !== "\n" && (cls || input[j] !== "/")) { if (input[j] === "\\") j++; else if (input[j] === "[") cls = true; else if (input[j] === "]") cls = false; j++; }
      blank(st, i + 1, Math.min(j, input.length), "_"); i = j + 1; prev = "/"; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { code: code.join(""), st: st.join("") };
}

/** Index of the bracket closing the one at `open`, in masked text. */
function closeOf(st: string, open: number): number {
  let depth = 0;
  for (let i = open; i < st.length; i++) {
    if ("{[(".includes(st[i]!)) depth++;
    else if ("}])".includes(st[i]!) && --depth === 0) return i;
  }
  return st.length;
}

/** The value starting at/after `i` (following a variable to its declaration, a few hops). */
function valueAt(src: Src, srcs: Src[], i: number, hops = 3): Val {
  const { st, code } = src;
  while (i < st.length && /\s/.test(st[i]!)) i++;
  const c = st[i];
  if (c === "{" || c === "[") return { kind: c === "{" ? "object" : "array", src, start: i + 1, end: closeOf(st, i) };
  if (c === '"' || c === "'" || c === "`") { const e = st.indexOf(c, i + 1); return { kind: "string", text: code.slice(i + 1, e < 0 ? undefined : e) }; }
  const id = /^[A-Za-z_$][\w$]*/.exec(st.slice(i))?.[0];
  if (id && hops > 0 && !/^\s*[(.]/.test(st.slice(i + id.length))) {
    for (const s of [src, ...srcs]) {
      const d = new RegExp(`\\b(?:const|let|var)\\s+${id.replace(/\$/g, "\\$")}\\s*=\\s*`).exec(s.st);
      if (d) return valueAt(s, srcs, d.index + d[0].length, hops - 1);
    }
  }
  return { kind: "expr" };
}

/** Top-level comma-separated items of a bracketed value, as [start, end) in its source. */
function items(v: Val & { kind: "object" | "array" }): [number, number][] {
  const out: [number, number][] = [];
  let depth = 0, at = v.start;
  for (let i = v.start; i <= v.end; i++) {
    const c = v.src.st[i];
    if (c && "{[(".includes(c)) depth++;
    else if (c && "}])".includes(c) && i < v.end) depth--;
    else if ((c === "," && depth === 0) || i === v.end) { if (v.src.st.slice(at, i).trim()) out.push([at, i]); at = i + 1; }
  }
  return out;
}

/** Keys of an object value (spread variables followed; shorthand keys included). */
function keysOf(v: Val, srcs: Src[], hops = 2): string[] {
  if (v.kind !== "object") return [];
  const out: string[] = [];
  for (const [a, b] of items(v)) {
    const t = v.src.code.slice(a, b).trim();
    const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)\s*$/.exec(t);
    if (spread && hops > 0) { out.push(...keysOf(valueAt(v.src, srcs, a + v.src.code.slice(a, b).indexOf(spread[1]!)), srcs, hops - 1)); continue; }
    const k = /^(?:(["'`])(.*?)\1|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(t);
    if (k) out.push((k[2] ?? k[3])!);
  }
  return out;
}

/** String literals anywhere in a value's text. */
const stringsIn = (v: Val): string[] => v.kind === "string" ? [v.text]
  : v.kind === "expr" ? [] : [...v.src.code.slice(v.start, v.end).matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]!);

/** The value of `key` (`key: v`, or shorthand `key,`) in one source, first match. */
function valueOf(s: Src, srcs: Src[], key: string): Val | null {
  const m = new RegExp(`(?<![\\w$.])${key}\\s*:\\s*`).exec(s.st);
  if (m) return valueAt(s, srcs, m.index + m[0].length);
  const sh = new RegExp(`(?<![\\w$.:])${key}\\s*[,}]`).exec(s.st);
  return sh ? valueAt(s, srcs, sh.index) : null;
}

const CONFIG_NAMES = ["webpack.config", "webpack.common", "webpack.base", "webpack.dev", "webpack.prod", "webpack.development", "webpack.production", "webpack.client"];
const EXTS = ["", ".js", ".cjs", ".mjs", ".ts", ".babel.js", "/index.js", "/index.ts"];

/** The webpack config files for an app: named at the root, in config/ or webpack/, or by a script's --config; plus what they require. */
export function findConfigs(root: string): Src[] {
  const rel = new Set<string>();
  for (const dir of ["", "config", "webpack", "build", "tools"])
    for (const n of CONFIG_NAMES) for (const e of [".js", ".ts", ".cjs", ".mjs", ".babel.js"]) {
      const f = join(dir, n + e);
      if (existsSync(join(root, f)) && (dir === "" ? n === "webpack.config" : true)) rel.add(f);
    }
  try {
    const scripts = Object.values(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}) as string[];
    for (const s of scripts) for (const m of s.matchAll(/(?:--config|-c)[ =]+["']?([^\s"']+)/g)) if (existsSync(join(root, m[1]!)) && /\.[cm]?[jt]s$/.test(m[1]!)) rel.add(m[1]!.replace(/^\.\//, ""));
  } catch { /* no package.json */ }
  const out: Src[] = [], seen = new Set<string>();
  const read = (f: string, depth: number) => {
    if (seen.has(f) || out.length > 12) return;
    seen.add(f);
    const m = mask(readFileSync(join(root, f), "utf8"));
    out.push({ file: f, ...m });
    if (depth > 3) return;
    for (const r of m.code.matchAll(/(?:require\(\s*|from\s+|import\(\s*)["'](\.[^"']*)["']/g)) {
      const base = join(dirname(f), r[1]!);
      const hit = EXTS.map((e) => base + e).find((p) => /\.[cm]?[jt]s$/.test(p) && existsSync(join(root, p)));
      if (hit && !hit.startsWith("..") && !/node_modules/.test(hit)) read(hit, depth + 1);
    }
  };
  for (const f of rel) read(f, 0);
  return out;
}

/** Rows that need only the word in the config: [pattern, advice, package the draft's plugins line names]. */
const ROWS: [RegExp, string, string?][] = [
  [/ProvidePlugin/, "ProvidePlugin -> explicit imports, or @rollup/plugin-inject", "@rollup/plugin-inject"],
  [/\bextensions\s*:/, "resolve.extensions -> resolve.extensions"],
  [/\bmodules\s*:\s*\[/, "resolve.modules (absolute imports) -> vite-tsconfig-paths, or aliases", "vite-tsconfig-paths"],
  [/\bmainFields\s*:/, "resolve.mainFields -> resolve.mainFields"],
  [/\bfallback\s*:|node-polyfill|NodePolyfill|process\/browser|buffer\//, "node polyfills (resolve.fallback, process, Buffer) -> vite-plugin-node-polyfills", "vite-plugin-node-polyfills"],
  [/worker-loader|workerize|\bnew Worker\(/, "workers: worker-loader! imports -> new Worker(new URL(...), { type: \"module\" }) or ?worker"],
  [/sass-loader|less-loader|stylus-loader/, "Sass/Less/Stylus: install sass, less or stylus; drop ~ from imports"],
  [/postcss-loader/, "postcss-loader: Vite reads postcss.config.js itself; drop the loader"],
  [/raw-loader|asset\/source|html-loader|text-loader/, "raw-loader / html-loader / asset/source -> import x from \"./f?raw\""],
  [/url-loader|file-loader|asset\/resource|asset\/inline|\bassetModuleFilename/, "url-loader / file-loader / asset modules -> Vite's asset imports (?url, ?inline); small files inline by default"],
  [/svgr|svg-loader|svg-inline|svg-sprite/, "SVG loaders -> vite-plugin-svgr (components) or ?raw / ?url", "vite-plugin-svgr"],
  [/yaml-loader|json5-loader|toml-loader|csv-loader/, "yaml / json5 / toml / csv loaders -> a Vite plugin for the format (@modyfi/vite-plugin-yaml, vite-plugin-json5, ...)"],
  [/mdx-js\/loader|\.mdx/, "MDX -> @mdx-js/rollup", "@mdx-js/rollup"],
  [/graphql-tag\/loader|graphql-loader/, "GraphQL loader -> vite-plugin-graphql-loader", "vite-plugin-graphql-loader"],
  [/vue-loader|VueLoaderPlugin/, "vue-loader -> @vitejs/plugin-vue (or plugin-vue2 for Vue 2.7)", "@vitejs/plugin-vue"],
  [/ts-loader|fork-ts-checker/, "ts-loader / fork-ts-checker: Vite transpiles TS only; keep `tsc --noEmit` as the type check"],
  [/babel-loader/, "babel-loader: Vite transpiles TS/JSX itself; keep only real Babel plugins (via @vitejs/plugin-react's babel option)", "@vitejs/plugin-react"],
  [/MiniCssExtractPlugin|style-loader|css-loader|CssMinimizer/, "css-loader / style-loader / MiniCssExtractPlugin: Vite handles and extracts CSS itself; drop them"],
  [/CopyWebpackPlugin|copy-webpack-plugin|CopyPlugin/, "CopyWebpackPlugin -> public/ (copied as is), or vite-plugin-static-copy for renamed paths"],
  [/ModuleFederation/, "ModuleFederationPlugin -> @module-federation/vite (an app that shares modules at runtime needs it at both ends)", "@module-federation/vite"],
  [/Workbox|GenerateSW|InjectManifest|WebpackPwaManifest/, "Workbox / PWA manifest plugins -> vite-plugin-pwa", "vite-plugin-pwa"],
  [/CompressionPlugin|BrotliPlugin/, "CompressionPlugin -> vite-plugin-compression (or let the host compress)", "vite-plugin-compression"],
  [/BundleAnalyzer/, "BundleAnalyzerPlugin -> rollup-plugin-visualizer", "rollup-plugin-visualizer"],
  [/Dotenv|EnvironmentPlugin/, "Dotenv / EnvironmentPlugin -> VITE_* env vars (import.meta.env), or loadEnv + define for other names"],
  [/splitChunks|optimization\s*:|TerserPlugin|runtimeChunk/, "optimization (splitChunks, Terser, runtimeChunk) -> build.rollupOptions.output.manualChunks / build.minify; Vite's defaults often do"],
  [/\bexternals\s*:/, "externals -> build.rollupOptions.external (plus output.globals for a library)"],
  [/libraryTarget|library\s*:|libraryExport/, "output.library: a library build -> build.lib, not an app (init ships web apps)"],
  [/target\s*:\s*["'`](?:electron|node|webworker|async-node)/, "target is not the web (electron / node / webworker): Vite needs build.ssr or a different tool for that part"],
  [/historyApiFallback/, "devServer.historyApiFallback: Vite's dev server falls back to index.html already"],
  [/IgnorePlugin|NormalModuleReplacementPlugin|ContextReplacementPlugin/, "IgnorePlugin / ContextReplacementPlugin -> an alias to an empty module, or build.rollupOptions.external"],
  [/BannerPlugin|LicenseWebpackPlugin|SourceMapDevToolPlugin|devtool\s*:/, "devtool / BannerPlugin / source-map plugins -> build.sourcemap and rollupOptions.output.banner"],
];

/** webpack features used in the app's source, not its config. */
const SOURCE_NOTES: [RegExp, string][] = [
  [/require\.context\(/, "require.context -> import.meta.glob"],
  [/__webpack_public_path__|__webpack_require__|__webpack_/, "__webpack_* globals -> import.meta.env.BASE_URL, or drop"],
  [/module\.hot|import\.meta\.webpackHot/, "module.hot -> import.meta.hot"],
  [/\/\*\s*webpack(?:Chunk|Prefetch|Preload|Mode|Ignore)/, "webpack magic comments on import() -> remove (Vite names chunks itself)"],
  [/require\.ensure\(/, "require.ensure -> import()"],
  [/["'`]!!?[\w-]+-loader!/, "inline loader imports (\"raw-loader!./f\") -> ?raw, ?url, ?worker suffixes"],
];

/**
 * A custom webpack build: no automatic port (the config grows custom loaders), but a guided one. What the config
 * does that vite.config.ts must too, the names it found, and a draft vite.config.ts to start from.
 */
export function webpackHint(root: string): string {
  const srcs = findConfigs(root);
  const lines = [`--port-vite only ports Create React App and Vue CLI. This is a custom webpack build; port it by hand (https://github.com/QuinnsCode/RustyBuns/issues/849):`];
  if (!srcs.length) lines.push("  (no webpack.config.* at the root, in config/ or webpack/, or named by a --config in package.json scripts; look where your build runs)");
  else lines.push(`  read: ${srcs.map((s) => s.file).join(", ")}`);
  const all = srcs.map((s) => s.code).join("\n");
  const has = (re: RegExp) => re.test(all);
  const uniq = <T,>(a: T[]) => [...new Set(a)];
  /** Values of `key` in every config file read. */
  const vals = (key: string) => srcs.flatMap((s) => { const v = valueOf(s, srcs, key); return v ? [v] : []; });
  const names = (key: string): string[] => uniq(vals(key).flatMap((v) => v.kind === "array"
    // array form: { name: "a", alias } or { context: ["/api"], target }
    ? items(v).flatMap(([a, b]) => [...v.src.code.slice(a, b).matchAll(/\b(?:context|name)\s*:\s*(\[[^\]]*\]|["'`][^"'`]*["'`])/g)].flatMap((m) => [...m[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map((x) => x[1]!)))
    : keysOf(v, srcs)));
  const named = (what: string, ks: string[]) => ks.length ? `${what} (${ks.slice(0, 6).join(", ")}${ks.length > 6 ? ", ..." : ""})` : what;

  const aliasKeys = names("alias");
  // DefinePlugin({ ... }) / EnvironmentPlugin([...]): the call's first argument.
  const callArg = (name: string): Val[] => srcs.flatMap((s) => [...s.st.matchAll(new RegExp(`${name}\\s*\\(\\s*`, "g"))].map((m) => valueAt(s, srcs, m.index + m[0].length)));
  const defines = uniq(callArg("DefinePlugin").flatMap((v) => keysOf(v, srcs)));
  const envNames = uniq(callArg("EnvironmentPlugin").flatMap(stringsIn));
  const entryVals = vals("entry");
  const entries = uniq(entryVals.flatMap((v) => v.kind === "object" ? keysOf(v, srcs) : []));
  // An array entry is one bundle (polyfills first, the app last), not several pages.
  const entryFiles = uniq(entryVals.flatMap((v) => v.kind === "object" ? [] : stringsIn(v).slice(-1)));
  const proxies = names("proxy");
  const publicPath = vals("publicPath").flatMap((v) => v.kind === "string" ? [v.text] : [])[0];
  const devPort = vals("devServer").flatMap((v) => v.kind === "object" ? [/\bport\s*:\s*(\d+)/.exec(v.src.code.slice(v.start, v.end))?.[1]] : []).find(Boolean);
  const pages = uniq(srcs.flatMap((s) => [...s.code.matchAll(/HtmlWebpackPlugin\s*\(\s*\{([^}]*)\}/g)])
    .flatMap((m) => /filename\s*:\s*["'`]([^"'`]+)/.exec(m[1]!)?.[1] ?? []));
  const htmlCount = srcs.reduce((n, s) => n + (s.code.match(/new\s+HtmlWebpackPlugin|HtmlWebpackPlugin\s*\(/g)?.length ?? 0), 0);

  const todo: [boolean, string][] = [
    [true, named("index.html at the root, with <script type=\"module\" src=\"/your/entry\"> for each page", entries.length ? entries : entryFiles)],
    [entries.length > 1 || entryFiles.length > 1, "several entries: one HTML page each, listed in build.rollupOptions.input; shared code goes through normal imports"],
    [htmlCount > 1, "several HtmlWebpackPlugin pages: list them in build.rollupOptions.input"],
    [htmlCount > 0, "HtmlWebpackPlugin templates: <%= %> tags aren't filled; write the values into index.html"],
    [has(/DefinePlugin/), named("DefinePlugin -> define", defines)],
    [envNames.length > 0, named("EnvironmentPlugin -> define / VITE_* env", envNames)],
    [has(/\balias\b/), named("resolve.alias -> resolve.alias", aliasKeys)],
    ...ROWS.map(([re, t]): [boolean, string] => [has(re), t]),
    [has(/devServer/), named("devServer.proxy -> server.proxy", proxies) + (devPort ? `; devServer.port ${devPort} -> server.port` : "")],
    [!!publicPath, `output.publicPath ${publicPath} -> base: "${publicPath}"`],
    [/module\.exports\s*=\s*\[|export default\s*\[/.test(all), "the config exports an array (several builds): each one is its own Vite build or mode"],
    [/module\.exports\s*=\s*(?:async\s*)?(?:\(|function|[\w$]+\s*=>)|export default\s*(?:async\s*)?(?:\(|function)/.test(all), "the config is a function of (env, argv): defineConfig(({ mode, command }) => ...) takes the same branches"],
    [/process\.env\.NODE_ENV|argv\.mode|env\.production|isProd|isDev/.test(all), "the config branches on mode (production / development): use mode and command in defineConfig"],
  ];
  for (const [on, t] of todo) if (on) lines.push(`  - ${t}`);

  const pkgs = uniq(ROWS.flatMap(([re, , p]) => p && has(re) ? [p] : []));
  const draft = [
    `import { defineConfig } from "vite";`, ``, `export default defineConfig({`,
    ...(publicPath ? [`  base: "${publicPath}",`] : []),
    ...(pkgs.length ? [`  plugins: [/* ${pkgs.join(", ")} */],`] : []),
    ...(aliasKeys.length ? [`  resolve: { alias: { ${aliasKeys.map((k) => `${JSON.stringify(k)}: "/* path */"`).join(", ")} } },`] : []),
    ...(defines.length ? [`  define: { ${defines.map((k) => `${JSON.stringify(k)}: "/* value */"`).join(", ")} },`] : []),
    ...(proxies.length || devPort ? [`  server: { ${[devPort ? `port: ${devPort}` : "", proxies.length ? `proxy: { ${proxies.map((k) => `${JSON.stringify(k)}: "/* target */"`).join(", ")} }` : ""].filter(Boolean).join(", ")} },`] : []),
    ...((pages.length > 1 || entries.length > 1) ? [`  build: { rollupOptions: { input: { ${(pages.length > 1 ? pages.map((p) => p.replace(/\.html$/, "")) : entries).map((k) => `${/^[\w$]+$/.test(k) ? k : JSON.stringify(k)}: "${k.replace(/\.html$/, "")}.html"`).join(", ")} } } },`] : []),
    `});`,
  ];
  lines.push("Start vite.config.ts from this (plugins for the loaders above go in `plugins`):", ...draft.map((l) => `  ${l}`));

  // The app's own source: webpack-only features no config port covers.
  const srcNotes = sourceNotes(root);
  if (srcNotes.length) lines.push("In the app's source:", ...srcNotes.map((n) => `  - ${n}`));
  lines.push("Then `rustybuns init` reads it as a Vite app.");
  return lines.join("\n");
}

/** SOURCE_NOTES hits in src/ (a bounded walk of JS/TS files). */
function sourceNotes(root: string): string[] {
  const dir = join(root, "src");
  if (!existsSync(dir)) return [];
  const hits = new Map<string, string[]>();
  const stack = [dir];
  let seen = 0;
  while (stack.length && seen < 3000) {
    const d = stack.pop()!;
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) { stack.push(p); continue; }
      if (!/\.(m?[jt]sx?|vue)$/.test(e)) continue;
      seen++;
      const text = readFileSync(p, "utf8");
      for (const [re, note] of SOURCE_NOTES) if (re.test(text)) hits.set(note, [...(hits.get(note) ?? []), relative(root, p)]);
    }
  }
  return [...hits].map(([n, fs]) => `${n} (${fs.slice(0, 3).join(", ")}${fs.length > 3 ? ` and ${fs.length - 3} more` : ""})`);
}
