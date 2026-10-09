// Put a build's desktop binaries in R2 (bucket rustybuns-drops, shared by every
// app) under a folder nobody can guess, with an index.html to send people:
//   <R2_PUBLIC_URL>/<app>/<version>-<hmac>/index.html
// The hmac is keyed by DROP_SECRET over app, version and commit, so knowing the
// version isn't enough to find the folder. Every commit gets a new folder, so a
// CDN can cache it forever.
//
//   bun scripts/drop.ts --app motion-midi --version 0.2.0 dist/motion-midi-*
//   bun scripts/drop.ts ... --dry out/       write the folder locally instead
//
// Each app keeps three builds: the latest stable, the latest experimental, and the
// stable before that (historical). Older folders are deleted; past that, build it
// yourself. One more hidden folder per app, <app>/<hmac>/, holds channels.json (what
// is in each slot) and an index.html that always links all three: the link to share.
//
//   bun scripts/drop.ts ... --channel stable       (default: experimental)
//
// Uploads over R2's S3 API, so an R2 token scoped to the one bucket is enough.
// Env: DROP_SECRET, R2_BUCKET, R2_PUBLIC_URL (no trailing slash), CLOUDFLARE_ACCOUNT_ID,
// CLOUDFLARE_API_TOKEN (an R2 token; its S3 keys are derived from it). GITHUB_SHA in CI.
import { createHmac, createHash } from "node:crypto";
import { S3Client } from "bun";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const { values: o, positionals: files } = parseArgs({
  allowPositionals: true,
  options: { app: { type: "string" }, version: { type: "string" }, channel: { type: "string", default: "experimental" }, dry: { type: "string" } },
});
const env = (k: string) => process.env[k] || (o.dry ? `dry-${k}` : fail(`${k} is not set`));
function fail(msg: string): never { console.error(`drop: ${msg}`); process.exit(1); }

const app = o.app ?? fail("--app is required");
const version = o.version ?? fail("--version is required");
const channel = o.channel as Channel;
if (channel !== "stable" && channel !== "experimental") fail("--channel is stable or experimental");
if (!files.length) fail("no files to drop");
const sha = process.env.GITHUB_SHA || (await Bun.$`git rev-parse HEAD`.text()).trim();
const hmac = (s: string) => createHmac("sha256", env("DROP_SECRET")).update(s).digest("hex").slice(0, 20);
const dir = `${app}/${version}-${hmac(`${app}/${version}/${sha}`)}`;
const home = `${app}/${hmac(`${app}/channels`)}`;
const base = env("R2_PUBLIC_URL");
const url = `${base}/${dir}`;

const bucket = env("R2_BUCKET");
const s3 = new S3Client({ bucket, endpoint: `https://${env("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`, ...(await s3Keys()) });

// An R2 token's S3 keys: the token's id, and the SHA-256 of the token itself.
// https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token
async function s3Keys() {
  if (o.dry) return { accessKeyId: "dry", secretAccessKey: "dry" };
  const token = env("CLOUDFLARE_API_TOKEN");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/tokens/verify`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { success: boolean; result?: { id: string }; errors?: unknown };
  if (!body.success || !body.result) fail(`CLOUDFLARE_API_TOKEN didn't verify: ${JSON.stringify(body.errors)}`);
  return { accessKeyId: body.result.id, secretAccessKey: createHash("sha256").update(token).digest("hex") };
}
async function put(name: string, data: Uint8Array | string, type: string, disposition?: string, at = dir) {
  if (o.dry) {
    await mkdir(join(o.dry, at), { recursive: true });
    await writeFile(join(o.dry, at, name), data);
  } else {
    await s3.write(`${at}/${name}`, data, { type, contentDisposition: disposition });
  }
  console.log(`  ${at === dir ? "" : `${at}/`}${name}`);
}

console.log(`drop ${app} ${version} @ ${sha.slice(0, 7)} -> ${bucket}/${dir}/`);
const rows: { name: string; bytes: number; sum: string }[] = [];
for (const f of files) {
  const data = new Uint8Array(await Bun.file(f).arrayBuffer());
  const name = basename(f);
  rows.push({ name, bytes: data.length, sum: createHash("sha256").update(data).digest("hex") });
  await put(name, data, "application/octet-stream", `attachment; filename="${name}"`);
}
rows.sort((a, b) => a.name.localeCompare(b.name));
await put("SHA256SUMS", rows.map((r) => `${r.sum}  ${r.name}\n`).join(""), "text/plain; charset=utf-8");
await put("index.html", page(), "text/html; charset=utf-8");
console.log(`\n${url}/index.html`);

// The three slots. A new stable pushes the old one to historical (unless it's the same
// version rebuilt); a new experimental replaces the old one. What falls out is deleted.
type Channel = "stable" | "experimental";
type Build = { version: string; dir: string; sha: string; date: string; files: string[] };
type Slots = { stable?: Build; experimental?: Build; historical?: Build };
const build: Build = { version, dir, sha, date: new Date().toISOString().slice(0, 10), files: [...rows.map((r) => r.name), "SHA256SUMS", "index.html"] };
const old = await readSlots();
const slots: Slots = channel === "stable"
  ? { ...old, stable: build, historical: old.stable && old.stable.version !== version ? old.stable : old.historical }
  : { ...old, experimental: build };
const builds = (s: Slots) => Object.values(s).filter(Boolean) as Build[];
const kept = new Set(builds(slots).map((b) => b.dir));
const gone = builds(old).filter((b, i, all) => !kept.has(b.dir) && all.findIndex((x) => x.dir === b.dir) === i);
console.log(`\n${channel}: ${version}. Channels page:`);
await put("channels.json", JSON.stringify(slots, null, 2), "application/json", undefined, home);
await put("index.html", channelsPage(slots), "text/html; charset=utf-8", undefined, home);
for (const b of gone) {
  console.log(`  delete ${b.version} (${b.dir})`);
  if (!o.dry) for (const f of b.files) await s3.delete(`${b.dir}/${f}`);
}
console.log(`\n${base}/${home}/index.html`);

async function readSlots(): Promise<Slots> {
  if (o.dry) return Bun.file(join(o.dry, home, "channels.json")).json().catch(() => ({}));
  // Missing on an app's first drop. Any other error throws: we'd forget older folders.
  const f = s3.file(`${home}/channels.json`);
  return (await f.exists()) ? f.json() : {};
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await Bun.write(process.env.GITHUB_STEP_SUMMARY, [
    `## ${app} ${version} (${channel})`, "", `Share (always the latest): ${base}/${home}/index.html`, "", `This build: ${url}/index.html`, "",
    ...rows.map((r) => `- [${r.name}](${url}/${r.name}) (${mb(r.bytes)})`), "",
  ].join("\n"));
}

function mb(n: number) { return `${(n / 1048576).toFixed(1)} MB`; }
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`); }
function style() { return `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#222;background:#fff}
a.dl{display:block;padding:.8rem 1rem;margin:.5rem 0;border:1px solid #ccc;border-radius:8px;text-decoration:none;color:inherit}
a.dl:hover{border-color:#888}small,code{color:#666}code{font-size:.85em;word-break:break-all}
@media(prefers-color-scheme:dark){body{color:#ddd;background:#161616}a.dl{border-color:#444}small,code{color:#999}}</style>`; }
function channelsPage(s: Slots) {
  const row = (label: string, note: string, b?: Build) => b
    ? `<a class="dl" href="../../${esc(b.dir)}/index.html"><b>${label}</b> ${esc(b.version)} <small>${note} · ${esc(b.sha.slice(0, 7))} · ${b.date}</small></a>`
    : "";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(app)}</title>${style()}
<h1>${esc(app)}</h1>
${row("Stable", "the one to use", s.stable)}
${row("Experimental", "newest, may break", s.experimental)}
${row("Previous", "the stable before this one", s.historical)}
<p><small>Older versions aren't kept: build them from the source at that commit.</small></p>
`;
}
function page() {
  const label = (n: string) =>
    n.includes("darwin-arm64") ? "Mac (Apple silicon)" : n.includes("darwin-x64") ? "Mac (Intel)"
    : n.includes("windows") ? "Windows" : n.includes("linux-arm64") ? "Linux (ARM)" : n.includes("linux") ? "Linux" : n;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(app)} ${esc(version)}</title>${style()}
<h1>${esc(app)} <small>${esc(version)} · ${channel}</small></h1>
<p><small>Built from ${esc(sha.slice(0, 7))} on ${new Date().toISOString().slice(0, 10)}.</small></p>
${rows.map((r) => `<a class="dl" href="${esc(r.name)}" download><b>${esc(label(r.name))}</b> <small>${esc(r.name)} · ${mb(r.bytes)}</small></a>`).join("\n")}
<h3>Opening it</h3>
<p><b>Mac:</b> in Terminal, <code>cd ~/Downloads && chmod +x ${esc(app)}-darwin-* && xattr -d com.apple.quarantine ${esc(app)}-darwin-*</code>, then run it. It isn't signed, so macOS blocks a double click.</p>
<p><b>Windows:</b> SmartScreen may warn about an unknown app: More info, then Run anyway.</p>
<p><b>Linux:</b> <code>chmod +x ${esc(app)}-linux-*</code> and run it.</p>
<p><small><a href="SHA256SUMS">SHA256SUMS</a></small></p>
`;
}
