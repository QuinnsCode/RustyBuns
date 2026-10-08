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
// Uploads with wrangler. Env: DROP_SECRET, R2_BUCKET, R2_PUBLIC_URL (no trailing
// slash), and wrangler's CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID. GITHUB_SHA in CI.
import { createHmac, createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const { values: o, positionals: files } = parseArgs({
  allowPositionals: true,
  options: { app: { type: "string" }, version: { type: "string" }, dry: { type: "string" } },
});
const env = (k: string) => process.env[k] || (o.dry ? `dry-${k}` : fail(`${k} is not set`));
function fail(msg: string): never { console.error(`drop: ${msg}`); process.exit(1); }

const app = o.app ?? fail("--app is required");
const version = o.version ?? fail("--version is required");
if (!files.length) fail("no files to drop");
const sha = process.env.GITHUB_SHA || (await Bun.$`git rev-parse HEAD`.text()).trim();
const hmac = createHmac("sha256", env("DROP_SECRET")).update(`${app}/${version}/${sha}`).digest("hex").slice(0, 20);
const dir = `${app}/${version}-${hmac}`;
const url = `${env("R2_PUBLIC_URL")}/${dir}`;

const bucket = env("R2_BUCKET");
const tmp = await mkdtemp(join(tmpdir(), "drop-"));
async function put(name: string, data: Uint8Array | string, type: string, disposition?: string) {
  if (o.dry) {
    await mkdir(join(o.dry, dir), { recursive: true });
    await writeFile(join(o.dry, dir, name), data);
  } else {
    const file = join(tmp, name);
    await writeFile(file, data);
    const cd = disposition ? ["--content-disposition", disposition] : [];
    await Bun.$`bunx wrangler@4.149.0 r2 object put ${`${bucket}/${dir}/${name}`} --remote --file ${file} --content-type ${type} ${cd}`.quiet();
  }
  console.log(`  ${name}`);
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

if (process.env.GITHUB_STEP_SUMMARY) {
  await Bun.write(process.env.GITHUB_STEP_SUMMARY, [
    `## ${app} ${version}`, "", `Share: ${url}/index.html`, "",
    ...rows.map((r) => `- [${r.name}](${url}/${r.name}) (${mb(r.bytes)})`), "",
  ].join("\n"));
}

function mb(n: number) { return `${(n / 1048576).toFixed(1)} MB`; }
function page() {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const label = (n: string) =>
    n.includes("darwin-arm64") ? "Mac (Apple silicon)" : n.includes("darwin-x64") ? "Mac (Intel)"
    : n.includes("windows") ? "Windows" : n.includes("linux-arm64") ? "Linux (ARM)" : n.includes("linux") ? "Linux" : n;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(app)} ${esc(version)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#222;background:#fff}
a.dl{display:block;padding:.8rem 1rem;margin:.5rem 0;border:1px solid #ccc;border-radius:8px;text-decoration:none;color:inherit}
a.dl:hover{border-color:#888}small,code{color:#666}code{font-size:.85em;word-break:break-all}
@media(prefers-color-scheme:dark){body{color:#ddd;background:#161616}a.dl{border-color:#444}small,code{color:#999}}</style>
<h1>${esc(app)} <small>${esc(version)}</small></h1>
<p><small>Built from ${esc(sha.slice(0, 7))} on ${new Date().toISOString().slice(0, 10)}.</small></p>
${rows.map((r) => `<a class="dl" href="${esc(r.name)}" download><b>${esc(label(r.name))}</b> <small>${esc(r.name)} · ${mb(r.bytes)}</small></a>`).join("\n")}
<h3>Opening it</h3>
<p><b>Mac:</b> in Terminal, <code>cd ~/Downloads && chmod +x ${esc(app)}-darwin-* && xattr -d com.apple.quarantine ${esc(app)}-darwin-*</code>, then run it. It isn't signed, so macOS blocks a double click.</p>
<p><b>Windows:</b> SmartScreen may warn about an unknown app: More info, then Run anyway.</p>
<p><b>Linux:</b> <code>chmod +x ${esc(app)}-linux-*</code> and run it.</p>
<p><small><a href="SHA256SUMS">SHA256SUMS</a></small></p>
`;
}
