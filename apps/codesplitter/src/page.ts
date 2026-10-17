// Your page: a profile you rebuild however you like (#profile-page).
//
//   GET /api/users/:name/page[/path]   the page, served as a site: files from the public repo `page`
//                                      (index.html by default), else the HTML saved with PUT /api/me
//   POST /api/me/page/revert {to}       put the page back: to "hour" (as every file of it stood an hour ago) or
//                                      "default" (the starter world below, other files emptied). It is edits like
//                                      any other, so the log keeps what it replaced and "hour" again goes further back.
//
//   PUT /api/me/page/assets/:name       one binary file of the page (image, audio, model, font; up to 5 MB) into R2, served
//                                      at /api/users/:name/page/assets/:file under the same sandbox (needs LEVEL_CHUNKS)
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

import { esc } from "./util.ts";
import { json, readBody, type Env } from "./env.ts";
import { toFile } from "./archive.ts";
import type { Applied, Line, Op } from "./lines.ts";
import { repoRow } from "./repos.ts";
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

/** Binary files a page may carry in R2 (the repo is text only). */
const ASSET_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
  glb: "model/gltf-binary", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf",
};
export const ASSET_MAX = 5_000_000;
/** Files of assets one account keeps, and the text of one page file. */
export const ASSET_FILES = 50, TEXT_MAX = 1_000_000;
const assetKey = (owner: string, file: string) => `page/${owner}/${file}`;
const assetName = (file: string | undefined) => (file && /^[\w][\w.-]{0,79}$/.test(file) && ASSET_TYPES[file.split(".").pop()!.toLowerCase()] ? file : null);

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
  return (await repoRow(env, name, PAGE_REPO, "visibility", { liveAt: Date.now() }))?.visibility === "public";
}

/** The text of `path` in the public page repo, as the public sees it, or null when there is no such file. */
async function repoFile(env: Env, name: string, path: string) {
  if (!(await hasPage(env, name))) return null;
  const res = await toFile(env, name, PAGE_REPO, path, "anon", "file", { headers: { "x-codesplitter-crew": "0" } }).catch(() => null);
  if (!res?.ok) return null;
  const doc = await res.json().catch(() => null) as { lines?: { text: string }[] } | null;
  return doc?.lines?.length ? doc.lines.map((l) => l.text).join("\n") : null;
}

/** Every public file of the page with the rev it is at, or "" when there is no page repo: the same string until a file changes. */
async function pageVersion(env: Env, name: string) {
  if (!(await hasPage(env, name))) return "";
  const { results } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ? ORDER BY path").bind(name, PAGE_REPO).all();
  const revs = await Promise.all((results as { path: string }[]).map(async ({ path }) => {
    const res = await toFile(env, name, PAGE_REPO, path, "anon", "file", { headers: { "x-codesplitter-crew": "0" } }).catch(() => null);
    return `${path}:${res?.ok ? ((await res.json().catch(() => null)) as { rev?: number } | null)?.rev ?? 0 : 0}`;
  }));
  return revs.join(" ");
}

const note = (text: string, status: number) => new Response(`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><body style="font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0;opacity:.6">${text}`, { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP, "x-frame-options": "SAMEORIGIN" } });

export async function pageRoutes(req: Request, env: Env, p: string[], user?: string | null): Promise<Response | null> {
  if (p[1] === "me" && p[2] === "page" && p[3] === "revert" && !p[4] && req.method === "POST") {
    if (!user) return json({ error: "sign in first" }, 401);
    const b = await readBody<"to">(req);
    return revertPage(env, user, b.to);
  }
  if (p[1] === "me" && p[2] === "page" && !p[3] && req.method === "PUT") {
    if (!user) return json({ error: "sign in first" }, 401);
    const b = await readBody<"path" | "content">(req), path = pagePath(typeof b.path === "string" ? b.path.split("/") : [""]);
    if (!path || !TYPES[path.split(".").pop()!.toLowerCase()]) return json({ error: `path: a text file of the page (${Object.keys(TYPES).join(", ")})` }, 400);
    if (typeof b.content !== "string") return json({ error: "content: the file's whole text" }, 400);
    if (b.content.length > TEXT_MAX) return json({ error: `content: up to ${TEXT_MAX / 1e6} MB of text` }, 413);
    if (!(await hasPage(env, user))) return json({ error: "no page repo yet: make a public repo named page" }, 404);
    return json({ path, changed: await setText(env, user, path, b.content) });
  }
  if (p[1] === "me" && p[2] === "page" && p[3] === "assets" && p[4] && !p[5] && req.method === "PUT") {
    if (!user) return json({ error: "sign in first" }, 401);
    const file = assetName(p[4]);
    if (!file) return json({ error: `name: letters, digits, . _ -, ending in ${Object.keys(ASSET_TYPES).join(", ")}` }, 400);
    if (!env.LEVEL_CHUNKS) return json({ error: "binary files need R2, which this server has not got" }, 501);
    if (!(await hasPage(env, user))) return json({ error: "no page repo yet: make a public repo named page" }, 404);
    // Turn a big body away before reading it, then count what the account already keeps (a rewrite of a file it has is free).
    if (Number(req.headers.get("content-length")) > ASSET_MAX) return json({ error: `body: the file's bytes, up to ${ASSET_MAX / 1e6} MB` }, 413);
    const held = (await env.LEVEL_CHUNKS.list({ prefix: assetKey(user, ""), limit: ASSET_FILES + 1 })).objects;
    if (held.length >= ASSET_FILES && !held.some((o) => o.key === assetKey(user, file))) return json({ error: `an account keeps up to ${ASSET_FILES} asset files: replace one or delete another` }, 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > ASSET_MAX) return json({ error: `body: the file's bytes, up to ${ASSET_MAX / 1e6} MB` }, 413);
    await env.LEVEL_CHUNKS.put(assetKey(user, file), bytes);
    return json({ path: `assets/${file}`, bytes: bytes.length });
  }
  if (p[1] === "users" && p[2] && p[3] === "page" && p[4] === "assets" && p[5] && !p[6] && (req.method === "GET" || req.method === "HEAD")) {
    const file = assetName(p[5]), obj = file && env.LEVEL_CHUNKS && (await hasPage(env, p[2])) ? await env.LEVEL_CHUNKS.get(assetKey(p[2], file)) : null;
    if (!file || !obj) return json({ error: "no such file" }, 404);
    return new Response(req.method === "HEAD" ? null : await obj.arrayBuffer(), { headers: {
      "content-type": ASSET_TYPES[file.split(".").pop()!.toLowerCase()], "content-security-policy": PAGE_CSP, "x-frame-options": "SAMEORIGIN",
      "cache-control": "no-cache", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
  }
  // GET /api/users/:name/page-version, changes whenever a file of the page does, so an open page knows when to reload.
  if (p[1] === "users" && p[2] && p[3] === "page-version" && !p[4] && req.method === "GET") return json({ version: await pageVersion(env, p[2]) });
  if (p[1] !== "users" || !p[2] || p[3] !== "page" || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const name = p[2], path = pagePath(p.slice(4));
  if (!path) return json({ error: "no such file" }, 404);
  const ext = path.split(".").pop()!.toLowerCase();
  const type = TYPES[ext];
  if (!type) return json({ error: `a page is text: ${Object.keys(TYPES).join(", ")}` }, 415);
  let body = await repoFile(env, name, path);
  // No page repo (or no index in it): the HTML saved on the profile is the index.
  if (body === null && path === "index.html") body = ((await env.DB.prepare("SELECT theme_html FROM users WHERE name = ?").bind(name).first()) as { theme_html: string | null } | null)?.theme_html || null;
  if (body === null) return path === "index.html" ? note(`@${esc(name)} hasn't made a page yet`, 404) : json({ error: "no such file" }, 404);
  if (type === "text/html" && path === "index.html") body = withData(body, await visible(env, name));
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "content-type": `${type}; charset=utf-8`, "content-security-policy": PAGE_CSP, "x-frame-options": "SAMEORIGIN", "cache-control": "no-cache",
      // The page's origin is opaque, so its module scripts and fetches are cross-origin to its own files.
      "access-control-allow-origin": "*",
    },
  });
}

/** What a page looks like before anyone has touched it: a tower per public repo. */
export const STARTER: Record<string, string> = {
  "index.html": `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#111}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script>
<script type="module" src="world.js"></script>`,
  "world.js": `import * as THREE from "three";
const { repos } = JSON.parse(document.getElementById("profile").textContent);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 4, 10);
scene.add(new THREE.HemisphereLight(0xffffff, 0x222244, 2));
// A tower per public repo.
const towers = repos.map((r, i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + (r.length % 5), 1), new THREE.MeshStandardMaterial({ color: 0xff6a00 }));
  m.position.x = (i - repos.length / 2) * 2;
  scene.add(m);
  return m;
});
renderer.setAnimationLoop((t) => { towers.forEach((m, i) => (m.rotation.y = t / 1000 + i)); renderer.render(scene, camera); });
`,
};

const asDoc = async (res: Response) => (await res.json()) as { lines: Line[] };

/** Make `path` in the owner's page repo say `content` ("" empties it), as edits: its lines go, the new ones come in at the top, last first. */
async function setText(env: Env, owner: string, path: string, content: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, PAGE_REPO, path).run();
  const now = await asDoc(await toFile(env, owner, PAGE_REPO, path, owner, "file"));
  if (now.lines.map((l) => l.text).join("\n") === content) return false;
  const ops: Op[] = now.lines.map((l) => ({ kind: "delete", line: l.id, base: l.rev }));
  if (content) for (const text of content.split("\n").reverse()) ops.push({ kind: "insert", after: null, text });
  await toFile(env, owner, PAGE_REPO, path, owner, "ops", { method: "POST", body: JSON.stringify({ ops }) });
  return true;
}

/** The file as it was at `cutoff` (ms), "" when it did not exist yet, or null when its history no longer reaches back that far. */
async function textAt(env: Env, owner: string, path: string, cutoff: number) {
  let rev = 0, since = 0;
  for (let i = 0; i < 100; i++) {
    const res = await toFile(env, owner, PAGE_REPO, path, owner, "log", {}, `?since=${since}`);
    if (!res.ok) return null;
    const page = (await res.json()) as { ops: Applied[]; next: number | null };
    for (const o of page.ops) if (o.at <= cutoff) rev = Math.max(rev, o.rev);
    if (page.next == null || page.next <= since) break;
    since = page.next;
  }
  if (!rev) return "";
  const res = await toFile(env, owner, PAGE_REPO, path, owner, "at", {}, `?rev=${rev}`);
  return res.ok ? (await asDoc(res)).lines.map((l) => l.text).join("\n") : null;
}

export const HOUR_MS = 3_600_000;

/** POST /api/me/page/revert {to: "hour" | "default"}: what each page file was changed to, and the ones history could not reach. */
export async function revertPage(env: Env, owner: string, to: unknown, now = Date.now()) {
  if (to !== "hour" && to !== "default") return json({ error: 'to: "hour" or "default"' }, 400);
  if (!(await hasPage(env, owner))) return json({ error: "no page repo yet: make a public repo named page" }, 404);
  const { results } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ?").bind(owner, PAGE_REPO).all();
  const paths = [...new Set([...(results as { path: string }[]).map((r) => r.path), ...(to === "default" ? Object.keys(STARTER) : [])])];
  const changed: string[] = [], unreachable: string[] = [];
  for (const path of paths) {
    const want = to === "default" ? STARTER[path] ?? "" : await textAt(env, owner, path, now - HOUR_MS);
    if (want === null) unreachable.push(path);
    else if (await setText(env, owner, path, want)) changed.push(path);
  }
  return json({ to, changed, unreachable });
}
