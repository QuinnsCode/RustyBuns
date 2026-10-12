// Static sites with no JavaScript app: plain HTML, or a site generator (Jekyll, Hugo, MkDocs).
// GitHub Pages hosts thousands of these. Their build output is the whole UI, so Rusty Buns boxes
// it the way it boxes a static Astro site: the files in dist/ui on the desktop, an assets-only
// Worker on the web. Pure (a file list in), so fit() can ask without a filesystem; site-files.ts
// reads the disk.
export type StaticKind = "jekyll" | "hugo" | "mkdocs" | "html";

export interface StaticSite {
  kind: StaticKind;
  /** e.g. "Jekyll site" */
  label: string;
  /** Plain HTML: the folder holding index.html ("." or docs/, public/, site/, www/). */
  dir: string;
  /** The program the build needs on PATH; none for plain HTML. */
  tool?: string;
}

const LABEL: Record<StaticKind, string> = { jekyll: "Jekyll site", hugo: "Hugo site", mkdocs: "MkDocs site", html: "static HTML site" };
// Where GitHub Pages and the usual hosts look for a hand-written site.
const HTML_DIRS = [".", "docs", "public", "site", "www"];

/** The static site in a repo, from its paths (relative, "/"-separated), or null. */
export function staticSite(files: string[]): StaticSite | null {
  const has = (f: string) => files.includes(f);
  const under = (d: string) => files.some((f) => f.startsWith(d + "/"));
  const site = (kind: StaticKind, dir = ".", tool?: string): StaticSite => ({ kind, label: LABEL[kind], dir, ...(tool ? { tool } : {}) });
  // Jekyll: a _config.yml plus its own folders, or a Gemfile (github-pages, jekyll).
  if ((has("_config.yml") || has("_config.yaml")) && (has("Gemfile") || ["_layouts", "_includes", "_posts", "_sass", "_data"].some(under)))
    return site("jekyll", ".", "jekyll");
  if (has("hugo.toml") || has("hugo.yaml") || has("hugo.json")
    || (["config.toml", "config.yaml"].some(has) && ["content", "layouts", "themes", "archetypes"].some(under)))
    return site("hugo", ".", "hugo");
  if (has("mkdocs.yml") || has("mkdocs.yaml")) return site("mkdocs", ".", "mkdocs");
  const dir = HTML_DIRS.find((d) => has(d === "." ? "index.html" : `${d}/index.html`));
  return dir ? site("html", dir) : null;
}

// Never part of the site: Rusty Buns' own files, build output and the repo's plumbing.
export const NOT_SITE = new Set(["node_modules", "dist", "desktop", "package.json", "rustybuns.config.ts", "bun.lock", "bun.lockb",
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Gemfile", "Gemfile.lock", "vendor"]);

/** Jekyll's exclude list for a Rusty Buns build: the site's own, plus our files, which Jekyll would copy in as pages. */
export function jekyllExcludes(own: unknown): string[] {
  const mine = Array.isArray(own) ? own.map(String) : [];
  return [...new Set([...mine, ...NOT_SITE, ".rustybuns", "_config.rustybuns.yml"])];
}

/**
 * GitHub Pages' jekyll-default-layout, as front-matter defaults: on Pages a page with no `layout`
 * gets `page` (or `default`) and a post `post` (or `default`); plain Jekyll gives them none, so they
 * render bare. Front matter still wins, and the site's own defaults come after ours, so they win ties.
 * `layouts` are the names in _layouts/. Empty when there's nothing to add.
 */
export function jekyllDefaults(layouts: string[], own: unknown): unknown[] {
  const pick = (...names: string[]) => names.find((n) => layouts.includes(n));
  const ours = ([["pages", pick("page", "default")], ["posts", pick("post", "default")]] as const)
    .filter(([, layout]) => layout).map(([type, layout]) => ({ scope: { path: "", type }, values: { layout } }));
  return ours.length ? [...ours, ...(Array.isArray(own) ? own : [])] : [];
}

/** The build that puts the site in `out`, as a shell command. */
export function staticBuild(s: StaticSite, out: string, opts: { bundler?: boolean; jekyllConfig?: string; exec: (bin: string) => string }): string {
  switch (s.kind) {
    case "jekyll": return `${opts.bundler ? "bundle exec " : ""}jekyll build --config ${opts.jekyllConfig ?? "_config.yml"},_config.rustybuns.yml --destination ${out}`;
    case "hugo": return `hugo --destination ${out} --baseURL /`;
    case "mkdocs": return `mkdocs build --site-dir ${out}`;
    case "html": return `${opts.exec("rustybuns")} copy-site ${s.dir} ${out}`;
  }
}
