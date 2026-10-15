import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mask, webpackHint } from "../src/glue/webpack-hint.ts";

/** The hint for an app made of these files. */
function hint(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "wp-hint-"));
  for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), c); }
  return webpackHint(dir);
}
const cfg = (body: string, more: Record<string, string> = {}) => hint({ "webpack.config.js": body, ...more });

test("mask: comments, strings and regexes can't fake braces or keys", () => {
  const m = mask(`a({ /* alias: {x} */ k: "}{", r: /[}"]/, // devServer: {}\n z: 1 })`);
  expect(m.st).not.toContain("alias");
  expect(m.st).not.toContain("devServer");
  expect(m.st.match(/[{}]/g)).toHaveLength(2);
  expect(m.code).toContain('"}{"');
});

test("webpack hint: comments are not config", () => {
  const out = cfg(`module.exports = { /* alias: { fake: 1 } */\n // devServer: { proxy: {} }\n };`);
  expect(out).not.toMatch(/alias|devServer/);
});

test("webpack hint: braces inside strings don't end an object", () => {
  expect(cfg(`module.exports = { resolve: { alias: { "a}": "b", c: "{" } }, devServer: { proxy: { "/x": "y" } } };`))
    .toContain("resolve.alias -> resolve.alias (a}, c)");
});

test("webpack hint: values held in variables are followed", () => {
  const out = cfg(`const alias = { "@": "src", lib: "lib" }; const defs = { A: 1, ...more }; const more = { B: 2 };
    const entry = { main: "./a.js", admin: "./b.js" };
    module.exports = { entry, resolve: { alias }, plugins: [new webpack.DefinePlugin(defs)] };`);
  expect(out).toContain("resolve.alias -> resolve.alias (@, lib)");
  expect(out).toContain("DefinePlugin -> define (A, B)");
  expect(out).toContain("index.html at the root, with <script type=\"module\" src=\"/your/entry\"> for each page (main, admin)");
  expect(out).toContain('input: { main: "main.html", admin: "admin.html" }');
});

test("webpack hint: entry as a string or an array is one page", () => {
  expect(cfg(`module.exports = { entry: "./src/index.js" };`)).toContain("for each page (./src/index.js)");
  const arr = cfg(`module.exports = { entry: ["./polyfill", "./src/i.js"] };`);
  expect(arr).toContain("for each page (./src/i.js)");
  expect(arr).not.toContain("several entries");
});

test("webpack hint: array-form proxy and alias are named", () => {
  const out = cfg(`module.exports = { resolve: { alias: [{ name: "a", alias: "b" }] }, devServer: { port: 9000, proxy: [{ context: ["/api", "/ws"], target: "x" }] } };`);
  expect(out).toContain("resolve.alias -> resolve.alias (a)");
  expect(out).toContain("devServer.proxy -> server.proxy (/api, /ws); devServer.port 9000 -> server.port");
  expect(out).toContain('server: { port: 9000, proxy: { "/api": "/* target */", "/ws": "/* target */" } }');
});

test("webpack hint: merged configs are read across files, merge() and spreads included", () => {
  const out = hint({
    "package.json": JSON.stringify({ scripts: { build: "webpack --config build/webpack.prod.js" } }),
    "build/webpack.prod.js": `const { merge } = require("webpack-merge"); const common = require("./webpack.common"); module.exports = merge(common, { devtool: false, plugins: [new CompressionPlugin()] });`,
    "build/webpack.common.js": `module.exports = { entry: "./src/main.ts", resolve: { alias: { "@": "src" } }, module: { rules: [{ test: /\\.vue$/, loader: "vue-loader" }] } };`,
  });
  expect(out).toContain("read: build/webpack.common.js, build/webpack.prod.js");
  expect(out).toContain("resolve.alias -> resolve.alias (@)");
  expect(out).toContain("vue-loader -> @vitejs/plugin-vue");
  expect(out).toContain("CompressionPlugin -> vite-plugin-compression");
  expect(out).toContain("for each page (./src/main.ts)");
});

test("webpack hint: several HtmlWebpackPlugin pages give the input list from their filenames", () => {
  const out = cfg(`module.exports = { plugins: [new HtmlWebpackPlugin({ filename: "index.html", template: "a.ejs" }), new HtmlWebpackPlugin({ filename: "admin/index.html", template: "b.ejs" })] };`);
  expect(out).toContain("several HtmlWebpackPlugin pages");
  expect(out).toContain('"admin/index": "admin/index.html"');
});

test("webpack hint: config shapes and features that aren't a plain object", () => {
  expect(cfg(`module.exports = (env, argv) => ({ mode: argv.mode });`)).toContain("a function of (env, argv)");
  expect(cfg(`module.exports = [{ entry: "a" }, { entry: "b" }];`)).toContain("exports an array");
  expect(cfg(`module.exports = { output: { library: "L", libraryTarget: "umd" }, target: "electron-renderer" };`)).toMatch(/build\.lib[\s\S]*not the web/);
  const rules = cfg(`module.exports = { module: { rules: [{ use: "@mdx-js/loader" }, { use: "yaml-loader" }, { type: "asset/source" }, { use: "postcss-loader" }] }, plugins: [new ModuleFederationPlugin({}), new BundleAnalyzerPlugin(), new Dotenv()], resolve: { modules: ["src"], mainFields: ["module"] } };`);
  for (const t of ["@mdx-js/rollup", "yaml / json5", "?raw", "postcss.config.js", "@module-federation/vite", "rollup-plugin-visualizer", "VITE_* env", "resolve.modules", "resolve.mainFields"]) expect(rules).toContain(t);
});

test("webpack hint: webpack-only features in src/ are listed with their files", () => {
  const out = cfg(`module.exports = {};`, {
    "src/a.js": `const r = require.context("./pages", true, /\\.js$/); if (module.hot) module.hot.accept();`,
    "src/b.js": `import(/* webpackChunkName: "x" */ "./x"); __webpack_public_path__ = "/";`,
  });
  expect(out).toContain("In the app's source:");
  expect(out).toContain("require.context -> import.meta.glob (src/a.js)");
  expect(out).toContain("module.hot -> import.meta.hot (src/a.js)");
  expect(out).toContain("webpack magic comments on import() -> remove (Vite names chunks itself) (src/b.js)");
});

test("webpack hint: no config file found says where it looked", () => {
  expect(hint({ "package.json": "{}" })).toContain("no webpack.config.* at the root, in config/ or webpack/");
});

test("webpack hint: pages from HtmlWebpackPlugin keep index.html in the draft's input (AdGuard Home shape)", () => {
  const out = cfg(`module.exports = { entry: { main: "a", install: "b" }, plugins: [
    new HtmlWebpackPlugin({ chunks: ["main"], template: "p/index.html" }),
    new HtmlWebpackPlugin({ chunks: ["install"], filename: "install.html", template: "p/install.html" })] };`);
  expect(out).toContain('input: { index: "index.html", install: "install.html" }');
});

test("webpack hint: one page with several entries is not several pages (jellyfin-web shape)", () => {
  const out = cfg(`module.exports = { entry: { app: "a", serviceworker: "b" }, plugins: [new HtmlWebpackPlugin({ filename: "index.html", chunks: ["app", "serviceworker"] })] };`);
  expect(out).not.toContain("serviceworker.html");
  expect(out).not.toContain("input: {");
});

test("webpack hint: a Gruntfile that drives webpack is read, and run-time entries are flagged (CyberChef shape)", () => {
  const out = hint({
    "webpack.config.js": `module.exports = { resolve: { alias: { jquery: "x" } } };`,
    "Gruntfile.js": `const webpack = require("webpack");\ngrunt.config.set("webpack.web.entry", find());\nconst c = { plugins: [new webpack.DefinePlugin(K), new HtmlWebpackPlugin({ chunks: ["main"] })] };`,
  });
  expect(out).toContain("read: webpack.config.js, Gruntfile.js");
  expect(out).toContain("entries are built at run time");
  expect(out).toContain("DefinePlugin -> define");
});
