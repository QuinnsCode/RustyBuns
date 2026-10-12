import { test, expect } from "bun:test";
import { jekyllPlan, JEKYLL_IMAGE, type JekyllEnv } from "../src/glue/jekyll.ts";
import { jekyllPagesPlugins, jekyllPlugins } from "../src/glue/static-site.ts";

const env = (ruby: string, bins: string[], gemfile = false): JekyllEnv => ({ ruby, has: (b) => bins.includes(b), gemfile, cwd: "/w/site" });
const args = ["build", "--destination", "dist/ui"];

test("jekyll: Ruby 3+ runs the local jekyll, or bundle exec with a Gemfile", () => {
  expect(jekyllPlan(args, env("3.3.0", ["jekyll", "docker"]))).toEqual({ how: "local", argv: ["jekyll", ...args] });
  expect(jekyllPlan(args, env("3.3.0", ["bundle", "docker"], true))).toEqual({ how: "local", argv: ["bundle", "exec", "jekyll", ...args] });
});

test("jekyll: macOS's Ruby 2.6 falls back to Docker, even with jekyll on PATH", () => {
  const plan = jekyllPlan(args, env("2.6.10", ["jekyll", "bundle", "docker"]));
  if (plan.how !== "docker") throw new Error(plan.how);
  expect(plan.image).toBe(JEKYLL_IMAGE);
  expect(plan.argv).toContain("/w/site:/site");
  expect(plan.argv.at(-1)).toContain("gem install --no-document jekyll) && jekyll build --destination dist/ui");
  const bundled = jekyllPlan(args, env("", ["docker"], true));
  if (bundled.how !== "docker") throw new Error(bundled.how);
  expect(bundled.argv).toContain(JEKYLL_IMAGE);
  expect(bundled.argv.at(-1)).toBe("bundle install --quiet && bundle exec jekyll build --destination dist/ui");
});

test("jekyll: Ruby 3 without jekyll uses Docker; arguments are quoted for the container's shell", () => {
  const plan = jekyllPlan(["build", "--config", "a b.yml"], env("3.2.1", ["docker"]));
  expect(plan.how === "docker" && plan.argv.at(-1)).toContain("jekyll build --config 'a b.yml'");
});

test("jekyll: no usable Ruby and no Docker says what to install", () => {
  const old = jekyllPlan(args, env("2.6.10", []));
  expect(old.how === "none" && old.why).toMatch(/ruby 2\.6\.10 is too old.*install Docker/);
  const missing = jekyllPlan(args, env("3.3.0", [], true));
  expect(missing.how === "none" && missing.why).toMatch(/bundle is not on PATH.*bundle install/);
});

test("jekyll: spots a site leaning on GitHub Pages' other default plugins", () => {
  const site: Record<string, string> = {
    "index.md": "---\nlayout: default\ntitle: Home\n---\nSee [the guide](guide.md#setup) and [docs](https://x.dev/a.md).\n",
    "guide.md": "# Guide\n\nNo front matter here.\n",
    "about.md": "---\nlayout: page\n---\n\nAbout us\n========\n",
    "docs/README.md": "# Docs\n\n[back]: ../index.md\n",
    "guides/README.md": "---\ntitle: Guides\n---\nAll of them.\n",
    "LICENSE.md": "MIT",
    "styles.css": "",
  };
  const uses = jekyllPagesPlugins(Object.keys(site), (f) => site[f]!);
  expect(Object.fromEntries(uses.map((u) => [u.plugin, u.files]))).toEqual({
    "jekyll-optional-front-matter": ["guide.md"],
    "jekyll-relative-links": ["index.md", "docs/README.md"],
    "jekyll-titles-from-headings": ["guide.md", "about.md", "docs/README.md"],
    // docs/README.md would index the root, which has index.md.
    "jekyll-readme-index": ["guides/README.md"],
  });
  // A site written for plain Jekyll needs none of them.
  const plain: Record<string, string> = { "index.html": "---\nlayout: default\n---\nhi", "about.md": "---\ntitle: About\n---\n# About\n[home](/)" };
  expect(jekyllPagesPlugins(Object.keys(plain), (f) => plain[f]!)).toEqual([]);
});

test("jekyll: a Gemfile-less site's plugins come along, locally only when their gems are there (#1123)", () => {
  const plugins = ["jekyll-relative-links", "jekyll-readme-index"];
  const withGems = (installed: string[]): JekyllEnv => ({ ...env("3.3.0", ["jekyll", "docker"]), plugins, gem: (g) => installed.includes(g) });
  expect(jekyllPlan(args, withGems(plugins))).toEqual({ how: "local", argv: ["jekyll", ...args] });
  const docker = jekyllPlan(args, withGems(["jekyll-relative-links"]));
  expect(docker.how === "docker" && docker.plugins).toBe(2);
  const script = docker.how === "docker" ? docker.argv.at(-1)! : "";
  for (const g of ["jekyll", ...plugins]) expect(script).toContain(`(gem list -i '^${g}$' >/dev/null || gem install --no-document ${g})`);
  expect(script).toEndWith("jekyll build --destination dist/ui");
  const none = jekyllPlan(args, { ...withGems([]), has: (b) => b === "jekyll" });
  expect(none.how === "none" && none.why).toMatch(/plugins aren't installed \(jekyll-relative-links, jekyll-readme-index\).*gem install jekyll-relative-links jekyll-readme-index/);
  // With a Gemfile, Bundler owns the plugins; a name that isn't a gem never reaches the shell.
  expect(jekyllPlan(args, { ...withGems([]), gemfile: true, has: (b) => b === "bundle" }).how).toBe("local");
  const odd = jekyllPlan(args, { ...env("2.6.10", ["docker"]), plugins: ["x; rm -rf /"] });
  expect(odd.how === "docker" && odd.argv.at(-1)).not.toContain("rm -rf");
});

test("jekyll: the layer's plugins keep the site's own first, and add only what's missing", () => {
  const use = (plugin: string) => ({ plugin, what: "", files: ["a.md"] });
  expect(jekyllPlugins([use("jekyll-relative-links")], ["jekyll-feed", "jekyll-relative-links"])).toEqual([]);
  expect(jekyllPlugins([use("jekyll-relative-links")], ["jekyll-feed"])).toEqual(["jekyll-feed", "jekyll-relative-links"]);
  expect(jekyllPlugins([], undefined)).toEqual([]);
});
