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
export function staticBuild(s: StaticSite, out: string, opts: { jekyllConfig?: string; exec: (bin: string) => string }): string {
  switch (s.kind) {
    // rustybuns jekyll: the local Jekyll on Ruby 3+, else the same build in Docker.
    case "jekyll": return `${opts.exec("rustybuns")} jekyll build --config ${opts.jekyllConfig ?? "_config.yml"},_config.rustybuns.yml --destination ${out}`;
    case "hugo": return `hugo --destination ${out} --baseURL /`;
    case "mkdocs": return `mkdocs build --site-dir ${out}`;
    case "html": return `${opts.exec("rustybuns")} copy-site ${s.dir} ${out}`;
  }
}

/** A GitHub Pages default plugin a Gemfile-less Jekyll site leans on, which plain Jekyll doesn't run. */
export interface PagesPluginUse {
  plugin: string;
  /** What breaks without it, for the init warning. */
  what: string;
  files: string[];
}

// jekyll-optional-front-matter leaves these alone (jekyll-readme-index takes README).
const NOT_OPTIONAL_PAGE = /^(README|LICENSE|LICENCE|COPYING|CODE_OF_CONDUCT|CONTRIBUTING|ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)$/i;

/**
 * The rest of GitHub Pages' default plugins (beyond jekyll-default-layout, which jekyllDefaults covers)
 * that this site's Markdown looks like it needs. `files` are the site's paths ("/"-separated, excludes,
 * dotfiles and _folders already left out) and `read` gives one's text.
 */
export function jekyllPagesPlugins(files: string[], read: (f: string) => string): PagesPluginUse[] {
  const md = files.filter((f) => /\.(md|markdown)$/i.test(f));
  const base = (f: string) => f.split("/").pop()!.replace(/\.[^.]+$/, "");
  const dir = (f: string) => f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
  const noMatter: string[] = [], links: string[] = [], titles: string[] = [];
  for (const f of md) {
    const text = read(f);
    const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    if (!fm && !NOT_OPTIONAL_PAGE.test(base(f))) noMatter.push(f);
    // [x](other.md), [x](../a/b.md#part), [x]: other.md; not a URL, an absolute path or a #fragment.
    if (/(\]\(|^\[[^\]]+\]:[ \t]*)(?![a-z][\w+.-]*:|\/|#)[^)\s]+\.(md|markdown)(#[^)\s]*)?(\)|\s|$)/im.test(text)) links.push(f);
    const body = fm ? text.slice(fm[0].length) : text;
    if (!(fm && /^title\s*:/m.test(fm[1]!)) && /^\s*(#{1,6}[ \t]+\S|[^\n]+\r?\n(=+|-+)[ \t]*(\r?\n|$))/.test(body)) titles.push(f);
  }
  const hasIndex = (d: string) => files.some((f) => dir(f) === d && /^index\.(md|markdown|html?)$/i.test(f.split("/").pop()!));
  // As on GitHub, a README in a top-level docs/ is the root's index.
  const readmes = md.filter((f) => /^readme$/i.test(base(f)) && !hasIndex(dir(f) === "docs" ? "" : dir(f)));
  return [
    { plugin: "jekyll-optional-front-matter", what: "Markdown with no front matter is copied raw here, not rendered", files: noMatter },
    { plugin: "jekyll-relative-links", what: "links to .md files 404 here, Pages points them at the .html", files: links },
    { plugin: "jekyll-titles-from-headings", what: "a page with no title takes its first heading on Pages, and has none here", files: titles },
    { plugin: "jekyll-readme-index", what: "a README is its folder's index on Pages, with no index.md; not here", files: readmes },
  ].filter((u) => u.files.length);
}

/**
 * `plugins` for the layer, so a Gemfile-less build turns on the Pages plugins the site leans on, as Pages does.
 * A layered config replaces a list rather than merging it, so the site's own plugins come first.
 * Empty when there's nothing to add.
 */
export function jekyllPlugins(uses: PagesPluginUse[], own: unknown): string[] {
  const mine = Array.isArray(own) ? own.map(String) : [];
  const add = uses.map((u) => u.plugin).filter((p) => !mine.includes(p));
  return add.length ? [...mine, ...add] : [];
}
