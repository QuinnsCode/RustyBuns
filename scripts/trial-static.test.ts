import { expect, test } from "bun:test";
import { staticBuild, staticTool, toolchainError } from "./trial-static.ts";

const cfg = (clientBuild: string) => `export default defineConfig({\n  "targets": { "desktop": { "mode": "spa", "clientBuild": ${JSON.stringify(clientBuild)}, "clientDir": "dist/ui" } }\n});`;

test("staticBuild: init's static builds, not an app's", () => {
  expect(staticBuild(cfg("bundle exec jekyll build --config _config.yml,_config.rustybuns.yml --destination dist/ui"))).toStartWith("bundle exec jekyll");
  expect(staticBuild(cfg("hugo --destination dist/ui --baseURL /"))).toStartWith("hugo");
  expect(staticBuild(cfg("mkdocs build --site-dir dist/ui"))).toStartWith("mkdocs");
  expect(staticBuild(cfg("pnpm exec rustybuns copy-site docs dist/ui"))).toContain("copy-site");
  expect(staticBuild(cfg("pnpm run build"))).toBeUndefined();
  expect(staticBuild(cfg("vite build --outDir dist/ui"))).toBeUndefined();
  expect(staticBuild(`{ "mode": "worker" }`)).toBeUndefined();
});

test("staticTool: the generator to find on PATH; none for plain HTML", () => {
  expect(staticTool("bundle exec jekyll build")).toBe("bundle");
  expect(staticTool("jekyll build --destination dist/ui")).toBe("jekyll");
  expect(staticTool("hugo --destination dist/ui")).toBe("hugo");
  expect(staticTool("mkdocs build --site-dir dist/ui")).toBe("mkdocs");
  expect(staticTool("bunx rustybuns copy-site . dist/ui")).toBeUndefined();
});

test("toolchainError: a missing generator or runtime, not a broken site", () => {
  expect(toolchainError("sh: jekyll: command not found")).toBe(true);
  expect(toolchainError("bash: line 1: hugo: command not found")).toBe(true);
  expect(toolchainError("Could not find gem 'github-pages' in locally installed gems.")).toBe(true);
  expect(toolchainError("jekyll-4.3.3 requires Ruby version >= 2.7.0.")).toBe(true);
  expect(toolchainError("Liquid Exception: undefined method in _layouts/post.html")).toBe(false);
  expect(toolchainError("Error: Cannot find module './App'")).toBe(false);
});
