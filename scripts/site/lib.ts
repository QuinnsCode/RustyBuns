// The docs site generator: markdown already in the repo in, a static site out, one folder per version.
// A site (rustybuns.ts, and codeSplitter's next) only says which pages it has; this file reads them
// from the working tree or a git tag, renders them with Bun.markdown, rewrites repo links into site
// links (or GitHub links at that version), and checks that every link inside the site lands.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";

// Where a version's files come from: the working tree for `latest`, `git show <tag>:<path>` for a tag.
export type Source = { version: string; ref: string; read(path: string): string | undefined };

export function worktree(): Source {
  return {
    version: "latest",
    ref: "main",
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  };
}

export function atTag(tag: string): Source {
  return {
    version: tag,
    ref: tag,
    read: (path) => {
      const out = Bun.spawnSync(["git", "show", `${tag}:${path}`], { stderr: "ignore" });
      return out.exitCode === 0 ? out.stdout.toString() : undefined;
    },
  };
}

export function tags(pattern: string): string[] {
  const out = Bun.spawnSync(["git", "tag", "-l", pattern, "--sort=-v:refname"]).stdout.toString();
  return out.split("\n").filter(Boolean);
}

export type Page = {
  path: string; // where it's served, e.g. "features/one-config.html"
  title: string;
  md: string;
  from: string; // the repo file it came from, so its relative links resolve
  anchor?: string; // set when the page is one heading of `from` (a README feature)
  section?: string; // sidebar group; none means it sits at the top
};

export type Site = {
  name: string;
  tagline: string;
  repo: string; // owner/name on GitHub
  pages(src: Source): Page[];
};

// GitHub's heading ids, so `FILE.md#anchor` links keep working: lowercase, punctuation dropped,
// spaces to hyphens (the same rule scripts/docs.ts checks anchors with).
export const slug = (heading: string) =>
  heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/ /g, "-");

// The first `# Heading` of a doc, as its title.
export const titleOf = (md: string, fallback: string) => md.match(/^# (.+)$/m)?.[1]?.replace(/`/g, "") ?? fallback;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Rewrites one page's href/src attributes. A link to a repo file the site has a page for becomes a
// relative link to that page; any other repo path goes to GitHub at this version's ref.
function rewrite(html: string, page: Page, site: Site, src: Source, byFile: Map<string, string>, problems: string[]) {
  const here = posix.dirname(page.path);
  const toPage = (target: string) => posix.relative(here, target) || posix.basename(target);
  return html.replace(/(href|src)="([^"]*)"/g, (m, attr: string, url: string) => {
    if (/^([a-z]+:|#|\/\/)/.test(url)) return m;
    const [path = "", hash] = url.split("#");
    if (path.endsWith(".html")) return m; // already a site link (the home page's "More" links)
    const file = posix.normalize(posix.join(posix.dirname(page.from), decodeURI(path)));
    if (file.startsWith("..")) {
      problems.push(`${src.version}/${page.path}: link ${url} leaves the repo`);
      return m;
    }
    // A heading with its own page (a README feature) links to that page's top.
    const own = hash ? byFile.get(`${file}#${hash}`) : undefined;
    if (own) return `${attr}="${esc(toPage(own))}"`;
    const target = byFile.get(file);
    if (target) return `${attr}="${esc(toPage(target))}${hash ? `#${hash}` : ""}"`;
    const base = attr === "src" ? `https://raw.githubusercontent.com/${site.repo}/${src.ref}` : `https://github.com/${site.repo}/blob/${src.ref}`;
    return `${attr}="${base}/${file}${hash ? `#${hash}` : ""}"`;
  });
}

// Bun's heading ids differ from GitHub's in places ("Hide & Seek" is hide--seek on GitHub), so redo
// them from the heading text, numbering repeats the way GitHub does (-1, -2).
function githubIds(html: string) {
  const seen = new Map<string, number>();
  return html.replace(/<h([1-6]) id="[^"]*">([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    const base = slug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `<h${level} id="${esc(n ? `${base}-${n}` : base)}">${inner}</h${level}>`;
  });
}

function layout(site: Site, page: Page, pages: Page[], body: string, src: Source, versions: string[]) {
  const here = posix.dirname(page.path);
  const href = (p: Page) => esc(posix.relative(here, p.path) || posix.basename(p.path));
  const link = (p: Page) => `<a href="${href(p)}"${p === page ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`;
  const groups = new Map<string, Page[]>();
  for (const p of pages) groups.set(p.section ?? "", [...(groups.get(p.section ?? "") ?? []), p]);
  const nav = [...groups]
    .map(([section, ps]) => `${section ? `<h2>${esc(section)}</h2>` : ""}<ul>${ps.map((p) => `<li>${link(p)}</li>`).join("")}</ul>`)
    .join("");
  const root = posix.join(posix.relative(here, ".") || ".", ".."); // the site root, above the version folders
  const options = versions.map((v) => `<option value="${esc(v)}"${v === src.version ? " selected" : ""}>${esc(v)}</option>`).join("");
  const edit = `https://github.com/${site.repo}/blob/${src.ref}/${page.from}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title === site.name ? site.name : `${page.title} · ${site.name}`)}</title>
<meta name="description" content="${esc(site.tagline)}">
<script>try{var t=localStorage.getItem("theme");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){}</script>
<link rel="stylesheet" href="${esc(posix.join(root, "site.css"))}">
</head>
<body>
<header>
  <a class="brand" href="${href(pages[0]!)}">${esc(site.name)}</a>
  <button class="theme" type="button" aria-label="Day mode" title="Day mode"><svg viewBox="0 0 24 24" aria-hidden="true"><g class="rays"><path d="M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></g><path class="moon" d="M15.5 4.6A8 8 0 1 0 19.4 15.5 6.5 6.5 0 0 1 15.5 4.6Z"/><circle class="disc" cx="12" cy="12" r="8.2"/></svg></button>
  <label class="version">Version <select data-root="${esc(root)}" data-page="${esc(page.path)}">${options}</select></label>
</header>
<div class="wrap">
  <nav>${nav}</nav>
  <main>
${body}
    <footer>Built from <a href="https://github.com/${site.repo}/tree/${src.ref}">${esc(src.ref)}</a> · <a href="${esc(edit)}">Source on GitHub</a></footer>
  </main>
</div>
<script src="${esc(posix.join(root, "site.js"))}"></script>
</body>
</html>
`;
}

// Builds one version into `out/<version>/` and returns its page paths. Problems (a link inside the
// site to a page or heading that isn't there) are pushed, not thrown, so one run reports them all.
export function buildVersion(site: Site, src: Source, out: string, versions: string[], problems: string[]): string[] {
  const pages = site.pages(src);
  const byFile = new Map<string, string>();
  for (const p of pages) byFile.set(p.anchor ? `${p.from}#${p.anchor}` : p.from, p.path);
  const rendered = new Map<string, string>();
  for (const page of pages) {
    rendered.set(page.path, rewrite(githubIds(Bun.markdown.html(page.md, { headings: { ids: true } })), page, site, src, byFile, problems));
  }
  // Every relative link must land on a page, and its #anchor on a heading in that page.
  const ids = new Map([...rendered].map(([path, html]) => [path, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!))]));
  for (const [path, html] of rendered)
    for (const [, url] of html.matchAll(/href="([^"]+)"/g)) {
      if (/^([a-z]+:|\/\/)/.test(url!)) continue;
      const [rel, hash] = url!.split("#");
      const target = rel ? posix.normalize(posix.join(posix.dirname(path), rel)) : path;
      if (!ids.has(target)) problems.push(`${src.version}/${path}: no page ${rel}`);
      else if (hash && !ids.get(target)!.has(hash)) problems.push(`${src.version}/${path}: no heading #${hash} in ${target}`);
    }
  for (const page of pages) {
    const file = join(out, src.version, page.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, layout(site, page, pages, rendered.get(page.path)!, src, versions));
  }
  return pages.map((p) => p.path);
}

// The whole site: `latest/` from the working tree plus a folder per tag, the shared CSS and JS, a
// versions.json the version menu reads, and an index.html that sends you to latest.
export function buildSite(site: Site, out: string, sources: Source[]): string[] {
  const problems: string[] = [];
  const versions = sources.map((s) => s.version);
  const manifest: Record<string, string[]> = {};
  for (const src of sources) manifest[src.version] = buildVersion(site, src, out, versions, problems);
  const assets = join(import.meta.dir, "assets");
  mkdirSync(out, { recursive: true });
  for (const f of ["site.css", "site.js"]) writeFileSync(join(out, f), readFileSync(join(assets, f)));
  writeFileSync(join(out, "versions.json"), JSON.stringify(manifest));
  writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>${esc(site.name)}</title><meta http-equiv="refresh" content="0; url=latest/index.html"><a href="latest/index.html">${esc(site.name)} docs</a>\n`);
  return problems;
}

export const shown = (dir: string) => relative(process.cwd(), dir) || ".";
