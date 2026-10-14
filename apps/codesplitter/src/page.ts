// Your page: a profile you rebuild however you like (#profile-page).
//
//   GET /api/users/:name/page[/path]   the page, served as a site: files from the public repo `page`
//                                      (index.html by default), else the HTML saved with PUT /api/me
//
// The page is the owner's own code, so it runs, but only in a box with nothing in it:
//   sandbox      the response's CSP carries `sandbox allow-scripts`, so it runs with an opaque origin even
//                when opened on its own: no cookies, no storage, no reach into the app or the API as anyone
//   no network   connect-src is 'self' (its own files); forms go nowhere; frames and plugins are off
//   code         scripts from the page's own files, inline, or a library CDN (three.js, htmx, ...)
//   data         only what a signed-out visitor sees (public repos), so the page can't carry a viewer's
//                private data off to its author through an image URL
// Files are read like any file in the repo: the lines of the file's Durable Object, as the public sees them
// (private lines come back blank). Text only; the repo is the page's storage, so its history, its line
// claims and its conflict handling are the page's too, and an agent edits it with the tools it has already.

import { json, type Env } from "./env.ts";
import { toFile } from "./archive.ts";

/** The public repo whose files are the page. */
export const PAGE_REPO = "page";

/** Where a page may load libraries from: pinned versions are the author's job. */
export const LIBRARY_HOSTS = ["https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://esm.sh"];

export const PAGE_CSP = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-pointer-lock",
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' ${LIBRARY_HOSTS.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

const TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  svg: "image/svg+xml", txt: "text/plain", md: "text/plain", glsl: "text/plain", vert: "text/plain", frag: "text/plain", obj: "text/plain",
};

/** A path inside the page, or null when it climbs out, hides, or is empty. `""` is the index. */
export function pagePath(rest: string[]): string | null {
  const path = rest.join("/") || "index.html";
  if (rest.some((s) => !s || s === "." || s === ".." || s.includes("\\") || s.startsWith("."))) return null;
  return path;
}

/** What a signed-out visitor may be told about the owner: their handle, bio and public repos. */
async function visible(env: Env, name: string) {
  const user = await env.DB.prepare("SELECT name, bio FROM users WHERE name = ?").bind(name).first() as { name: string; bio: string | null } | null;
  const { results } = await env.DB.prepare("SELECT name FROM repos WHERE owner = ? AND visibility = 'public' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC").bind(name, Date.now()).all();
  return { name, bio: user?.bio ?? "", repos: (results as { name: string }[]).map((r) => r.name) };
}

/** A JSON block the page reads with JSON.parse(document.getElementById("profile").textContent). `<` is escaped so the data can't close it. */
export const dataBlock = (data: unknown) => `<script type="application/json" id="profile">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

/** The block goes inside <head> (else before </body>, else first), so a doctype stays first. */
export function withData(html: string, data: unknown) {
  const block = dataBlock(data), at = html.search(/<\/head\s*>/i);
  if (at >= 0) return html.slice(0, at) + block + html.slice(at);
  const end = html.search(/<\/body\s*>/i);
  return end >= 0 ? html.slice(0, end) + block + html.slice(end) : html + block;
}

/** Whether `name` has a page to show: HTML saved on the profile, or a public `page` repo. */
export async function hasPage(env: Env, name: string, themeHtml?: string | null) {
  if (themeHtml) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ? AND visibility = 'public' AND (expires_at IS NULL OR expires_at > ?)").bind(name, PAGE_REPO, Date.now()).first());
}

/** The text of `path` in the public page repo, as the public sees it, or null when there is no such file. */
async function repoFile(env: Env, name: string, path: string) {
  if (!(await hasPage(env, name))) return null;
  const res = await toFile(env, name, PAGE_REPO, path, "anon", "file", { headers: { "x-codesplitter-crew": "0" } }).catch(() => null);
  if (!res?.ok) return null;
  const doc = await res.json().catch(() => null) as { lines?: { text: string }[] } | null;
  return doc?.lines?.length ? doc.lines.map((l) => l.text).join("\n") : null;
}

const note = (text: string, status: number) => new Response(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><body style="font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0;opacity:.6">${text}`, { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP, "x-frame-options": "SAMEORIGIN" } });

export async function pageRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
  if (p[1] !== "users" || !p[2] || p[3] !== "page" || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const name = p[2], path = pagePath(p.slice(4));
  if (!path) return json({ error: "no such file" }, 404);
  const ext = path.split(".").pop()!.toLowerCase();
  const type = TYPES[ext];
  if (!type) return json({ error: `a page is text: ${Object.keys(TYPES).join(", ")}` }, 415);
  let body = await repoFile(env, name, path);
  // No page repo (or no index in it): the HTML saved on the profile is the index.
  if (body === null && path === "index.html") body = ((await env.DB.prepare("SELECT theme_html FROM users WHERE name = ?").bind(name).first()) as { theme_html: string | null } | null)?.theme_html || null;
  if (body === null) return path === "index.html" ? note(`@${name} hasn't made a page yet`, 404) : json({ error: "no such file" }, 404);
  if (type === "text/html" && path === "index.html") body = withData(body, await visible(env, name));
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "content-type": `${type}; charset=utf-8`, "content-security-policy": PAGE_CSP, "x-frame-options": "SAMEORIGIN", "cache-control": "no-cache",
      // The page's origin is opaque, so its module scripts and fetches are cross-origin to its own files.
      "access-control-allow-origin": "*",
    },
  });
}
