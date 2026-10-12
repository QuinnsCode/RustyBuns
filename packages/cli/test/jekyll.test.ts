import { test, expect } from "bun:test";
import { jekyllPlan, JEKYLL_IMAGE, type JekyllEnv } from "../src/glue/jekyll.ts";

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
