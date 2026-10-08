// Downloads InteriorGS scenes into the scenes folder, picking up after the last
// one you already have.
//
//   bun scripts/fetch-scenes.ts               # the next scene
//   bun scripts/fetch-scenes.ts --next 5      # the next five
//   bun scripts/fetch-scenes.ts 0006_840125   # specific scenes
//   bun scripts/fetch-scenes.ts --list        # what's local, what's next
//
// The dataset is gated: accept the terms on its Hugging Face page, then put a
// read token in HF_TOKEN or ~/.cache/huggingface/token (what `hf auth login`
// writes). Files land as .part and are renamed when complete, so an
// interrupted run just resumes the missing files next time.
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "spatialverse/InteriorGS";
const API = `https://huggingface.co/api/datasets/${REPO}/tree/main`;
const FILE = (path: string) => `https://huggingface.co/datasets/${REPO}/resolve/main/${path}`;
const DIR = (process.env.SPLAT_ROOMS_DIR ?? "~/Documents/SplatRooms").replace(/^~/, homedir());

interface Entry { type: "file" | "directory"; path: string; size: number }

async function token(): Promise<string | null> {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN.trim();
  const home = process.env.HF_HOME ?? join(homedir(), ".cache", "huggingface");
  try { return (await readFile(join(home, "token"), "utf8")).trim() || null; } catch { return null; }
}

async function tree(path = "", auth: Record<string, string>): Promise<Entry[]> {
  const out: Entry[] = [];
  // The tree API pages with a Link header.
  let url: string | null = `${API}${path ? `/${path}` : ""}?limit=1000`;
  while (url) {
    const r: Response = await fetch(url, { headers: auth });
    if (!r.ok) throw new Error(`listing ${path || "dataset"}: HTTP ${r.status}`);
    out.push(...((await r.json()) as Entry[]));
    url = r.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return out;
}

const size = async (p: string) => { try { return (await stat(p)).size; } catch { return -1; } };
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

async function download(e: Entry, auth: Record<string, string>) {
  const dest = join(DIR, e.path);
  if ((await size(dest)) === e.size) return false;
  const r = await fetch(FILE(e.path), { headers: auth });
  if (r.status === 401 || r.status === 403) {
    throw new Error(`HTTP ${r.status} for ${e.path}. The dataset is gated: accept its terms at https://huggingface.co/datasets/${REPO} and check your token.`);
  }
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${e.path}`);
  const part = `${dest}.part`;
  const w = Bun.file(part).writer();
  let got = 0, last = 0;
  for await (const chunk of r.body) {
    w.write(chunk);
    got += chunk.byteLength;
    if (process.stdout.isTTY && got - last > 2e6) { last = got; process.stdout.write(`\r    ${e.path.split("/")[1]}  ${mb(got)} / ${mb(e.size)}   `); }
  }
  await w.end();
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  if ((await size(part)) !== e.size) throw new Error(`${e.path}: got ${got} bytes, expected ${e.size}`);
  await rename(part, dest);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const tok = await token();
  const auth: Record<string, string> = tok ? { Authorization: `Bearer ${tok}` } : {};

  await mkdir(DIR, { recursive: true });
  const local = new Set((await readdir(DIR)).filter((d) => /^\d{4}_\d+$/.test(d)));
  const remote = (await tree("", auth)).filter((e) => e.type === "directory").map((e) => e.path).sort();
  // A folder counts as "had" once its splats are down; a labels-only folder
  // is still in the queue.
  const complete = async (id: string) => local.has(id) && (await size(join(DIR, id, "3dgs_compressed.ply"))) > 0;
  const lastHad = (await Promise.all(remote.map(async (id) => ((await complete(id)) ? id : null)))).filter(Boolean).at(-1);
  const after = lastHad ? remote.indexOf(lastHad) + 1 : 0;

  if (args.includes("--list")) {
    console.log(`${DIR}\n  local: ${[...local].sort().join(", ") || "none"}`);
    console.log(`  next:  ${remote.slice(after, after + 5).join(", ")}  (${remote.length} in the dataset)`);
    return;
  }

  const i = args.indexOf("--next");
  const n = i >= 0 ? Number(args[i + 1] ?? 1) : 1;
  const named = args.filter((a, j) => !a.startsWith("--") && args[j - 1] !== "--next");
  const want = named.length ? named : remote.slice(after, after + n);
  for (const id of want) if (!remote.includes(id)) throw new Error(`${id} is not in ${REPO}`);
  if (!tok) console.warn("No Hugging Face token (HF_TOKEN or ~/.cache/huggingface/token); the files are gated, so this will likely fail.");

  for (const id of want) {
    const files = (await tree(id, auth)).filter((e) => e.type === "file");
    const total = files.reduce((s, e) => s + e.size, 0);
    console.log(`${id}  (${files.length} files, ${mb(total)})`);
    await mkdir(join(DIR, id), { recursive: true });
    // labels.json first: it's what makes the folder show up in the game.
    files.sort((a, b) => a.size - b.size);
    for (const f of files) {
      const fresh = await download(f, auth);
      console.log(`  ${fresh ? "got " : "have"}  ${f.path.split("/")[1]}  ${mb(f.size)}`);
    }
  }
  console.log(`Done. ${want.length} scene${want.length === 1 ? "" : "s"} in ${DIR}`);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
