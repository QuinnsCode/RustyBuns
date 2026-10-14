// The docs site generator: markdown already in the repo in, a static site out, one folder per version.
// A site (rustybuns.ts, and codeSplitter's next) only says which pages it has; this file reads them
// from the working tree or a git tag, renders them with Bun.markdown, rewrites repo links into site
// links (or GitHub links at that version), and checks that every link inside the site lands.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

// Wide code and tables scroll sideways, so a keyboard user has to be able to focus them to scroll.
const reachable = (html: string) =>
  html
    .replace(/<pre>/g, '<pre tabindex="0">')
    .replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="scroll" tabindex="0" role="region" aria-label="Table">${t}</div>`);

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
  const blob = (file: string) => `https://github.com/${site.repo}/blob/${src.ref}/${file}`;
  const edit = blob(page.from);
  // Legal links: a site page when the site has one for the file, else the file on GitHub.
  const legal = [["Privacy", "PRIVACY.md"], ["Security", "SECURITY.md"]]
    .map(([label, file]) => [label, pages.find((p) => p.from === file && !p.anchor)] as const)
    .filter(([label, p]) => p || label === "Security")
    .map(([label, p]) => ` · <a href="${esc(p ? href(p) : blob("SECURITY.md"))}">${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title === site.name ? site.name : `${page.title} · ${site.name}`)}</title>
<meta name="description" content="${esc(site.tagline)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${esc(posix.join(root, "favicon.svg"))}" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="${esc(posix.basename(page.path).replace(/\.html$/, ".md"))}">
<script>try{var d=document.documentElement,t=localStorage.getItem("theme");d.dataset.theme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=JSON.parse(localStorage.getItem("reading")||"{}");for(var k of["font","size","space"])if(typeof r[k]==="string")d.dataset[k]=r[k]}catch(e){}</script>
<link rel="stylesheet" href="${esc(posix.join(root, "site.css"))}">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header>
  <a class="brand" href="${href(pages[0]!)}">${esc(site.name)}</a>
  <button type="button" class="copy" data-md="${esc(posix.basename(page.path).replace(/\.html$/, ".md"))}" title="Copy this page as markdown, with a prompt, for your coding agent">Copy for agent</button>
  <span class="sr-only" role="status" aria-live="polite" id="status"></span>
  <details class="reading"><summary aria-label="Reading settings" title="Reading settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5c3.5-2 6.5-2 9-1v13c-2.500-1-5.500-1-9 1-3.500-2-6.500-2-9-1z"/><path d="M12 6.500v13"/></svg></summary>
    <form class="panel" aria-label="Reading settings">
      <label>Font <select name="font"><option value="">Site default</option><option value="atkinson">Atkinson Hyperlegible</option><option value="dyslexic">OpenDyslexic</option><option value="system">Your system font</option></select></label>
      <label>Text size <select name="size"><option value="">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label>
      <label>Spacing <select name="space"><option value="">Normal</option><option value="wide">Wide letters, words and lines</option></select></label>
      <button type="button" name="reset">Reset</button>
    </form>
  </details>
  <button class="theme" type="button" aria-label="Day mode" title="Day mode"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g class="rays"><path d="M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></g><path class="moon" d="M15.5 4.6A8 8 0 1 0 19.4 15.5 6.5 6.5 0 0 1 15.5 4.6Z"/><circle class="disc" cx="12" cy="12" r="8.2"/></svg></button>
  <label class="version">Version <select data-root="${esc(root)}" data-page="${esc(page.path)}">${options}</select></label>
</header>
<div class="wrap">
  <nav aria-label="Pages">${nav}</nav>
  <main id="content" tabindex="-1">
${body}
    <footer>
      <p>&copy; <span class="year">${new Date().getUTCFullYear()}</span> QuinnsCode (Ryan Quinn) · <a href="${esc(blob("LICENSE"))}">Apache-2.0</a>${legal}</p>
      <p>Built from <a href="https://github.com/${site.repo}/tree/${src.ref}">${esc(src.ref)}</a> · <a href="${esc(edit)}">Source on GitHub</a></p>
    </footer>
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
    writeFileSync(file, layout(site, page, pages, reachable(rendered.get(page.path)!), src, versions));
    // The same page as markdown beside it, for agents (and the copy button): no nav, no chrome.
    writeFileSync(file.replace(/\.html$/, ".md"), page.md);
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
  for (const f of ["site.css", "site.js", "favicon.svg"]) writeFileSync(join(out, f), readFileSync(join(assets, f)));
  mkdirSync(join(out, "fonts"), { recursive: true });
  for (const f of readdirSync(join(assets, "fonts"))) writeFileSync(join(out, "fonts", f), readFileSync(join(assets, "fonts", f)));
  writeFileSync(join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
  writeFileSync(join(out, "versions.json"), JSON.stringify(manifest));
  // llms.txt (the index) and llms-full.txt (everything) for the newest version, so an agent reads the
  // site in one fetch instead of crawling it.
  const latest = sources[0];
  if (latest) {
    const pages = site.pages(latest);
    const dir = latest.version;
    writeFileSync(join(out, "llms.txt"), `# ${site.name}\n\n> ${site.tagline}\n\n${pages.map((p) => `- [${p.title}](${dir}/${p.path.replace(/\.html$/, ".md")})`).join("\n")}\n`);
    writeFileSync(join(out, "llms-full.txt"), `# ${site.name}\n\n> ${site.tagline}\n\n${pages.map((p) => `<!-- ${dir}/${p.path.replace(/\.html$/, ".md")} -->\n${p.md.trim()}`).join("\n\n---\n\n")}\n`);
  }
  writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>${esc(site.name)}</title><meta http-equiv="refresh" content="0; url=latest/index.html"><a href="latest/index.html">${esc(site.name)} docs</a>\n`);
  return problems;
}

export const shown = (dir: string) => relative(process.cwd(), dir) || ".";
