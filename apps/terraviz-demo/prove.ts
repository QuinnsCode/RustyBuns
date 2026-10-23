// What a TerraViz node-in-a-box can do, checked rather than claimed (#2197). Boots TerraViz's own host twice from the
// clone `run.ts` built (two data dirs, two ports), then walks the node operator's path: provision identity, publish a
// dataset, search it, and have the second node look at the first. TerraViz's code is untouched; the only copy is
// of its built host file, with the data dir swapped. Exits 1 if a claim that should hold doesn't.
//
//   bun apps/terraviz-demo/run.ts     once, to clone and build
//   bun apps/terraviz-demo/prove.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const OUT = join(homedir(), "rustybuns-demos/terraviz");
const clone = join(OUT, "clones/zyra-project__terraviz");
const host = join(clone, ".rustybuns/dev/desktop.js");
if (!existsSync(host)) {
  console.error("run `bun apps/terraviz-demo/run.ts` first, to clone and build TerraViz");
  process.exit(1);
}
const baked = join(OUT, "data/zyra-project__terraviz/worker");
const work = mkdtempSync(join(tmpdir(), "terraviz-prove-"));

type Node = { name: string; url: string; token: string; cookie: string; stop: () => void };

async function boot(name: string, port: number): Promise<Node> {
  const data = join(work, name);
  const file = join(clone, `.rustybuns/dev/prove-${name}.js`);
  writeFileSync(file, readFileSync(host, "utf8").replaceAll(baked, data));
  const proc = Bun.spawn(["bun", file], {
    cwd: clone,
    stdout: "pipe",
    stderr: "inherit",
    env: {
      PATH: process.env.PATH, HOME: join(OUT, "home"), RB_NO_BROWSER: "1", RB_LISTEN: `127.0.0.1:${port}`,
      RUSTYBUNS_NO_UPDATE_CHECK: "1",
      // The two switches a local node needs: Access is bypassed on loopback, and embeddings come from TerraViz's own
      // feature-hashing stand-in because the desktop has no Workers AI.
      DEV_BYPASS_ACCESS: "true", MOCK_AI: "true",
    },
  });
  const stop = () => { proc.kill(); rmSync(file, { force: true }); };
  let log = "";
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    log += dec.decode(value);
    const m = log.match(/open (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
    if (m) {
      void (async () => { while (!(await reader.read()).done); })();
      const cookie = `rb_token_${port}=${m[2]}`;
      return { name, url: m[1], token: m[2], cookie, stop };
    }
  }
  stop();
  throw new Error(`node ${name} didn't start:\n${log}`);
}

const call = (n: Node, method: string, path: string, body?: unknown, cookie = n.cookie) =>
  fetch(n.url + path, {
    method, redirect: "manual",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  (${detail})` : ""}`);
};

const a = await boot("a", 18701);
const b = await boot("b", 18702);
try {
  console.log("\nPublish");
  const me = await (await call(a, "GET", "/api/v1/publish/me")).json() as any;
  check(me.role === "admin", "portal API signs you in as an admin with no Access setup", `DEV_BYPASS_ACCESS, ${me.email}`);
  const noIdentity = await call(a, "GET", "/api/v1/publish/datasets");
  check(noIdentity.status === 200, "portal lists datasets before any identity exists");
  for (const n of [a, b]) {
    // A fresh node has no identity row; TerraViz's `init-node` CLI does this PUT. Any 32-byte key is accepted.
    const key = "ed25519:" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const r = await call(n, "PUT", "/api/v1/publish/node-identity", { display_name: `Node ${n.name.toUpperCase()}`, base_url: n.url, public_key: key });
    check(r.status === 200, `node ${n.name} identity provisioned`);
  }
  const mk = async (n: Node, title: string, abstract: string) => {
    const r = await call(n, "POST", "/api/v1/publish/datasets", { title, abstract, format: "image/png", data_ref: "url:https://example.invalid/x.png", visibility: "public", license_spdx: "CC0-1.0" });
    const { dataset } = await r.json() as any;
    const p = await call(n, "POST", `/api/v1/publish/datasets/${dataset.id}/publish`);
    return { id: dataset.id as string, published: p.status === 200 };
  };
  const sst = await mk(a, "Sea Surface Temperature", "Global ocean warmth from satellites.");
  const hurricane = await mk(b, "Hurricane Tracks", "Storm paths over the Atlantic basin.");
  check(sst.published && hurricane.published, "a dataset published on each node");
  const catA = await (await call(a, "GET", "/api/v1/catalog")).json() as any;
  check(catA.datasets.length === 1 && catA.datasets[0].title === "Sea Surface Temperature", "it appears in that node's catalog", `${catA.datasets.length} dataset`);

  console.log("\nSearch");
  const hit = async (n: Node, q: string) => (await (await call(n, "GET", `/api/v1/search?q=${encodeURIComponent(q)}`)).json() as any).datasets as { id: string; score: number }[];
  const ocean = await hit(a, "ocean temperature");
  check(ocean[0]?.id === sst.id && ocean[0].score > 0, "words from the abstract find it through the local Vectorize twin", `score ${ocean[0]?.score.toFixed(2)}`);
  const none = await hit(a, "banana");
  check(!none[0] || none[0].score === 0, "an unrelated word scores 0", "feature hashing matches words, not meaning");
  const other = await hit(a, "hurricane");
  check(!other.some((d) => d.id === hurricane.id), "node A's search never shows node B's dataset");

  console.log("\nFederation");
  const wk = await (await call(a, "GET", "/.well-known/terraviz.json")).json() as any;
  check(wk.display_name === "Node A" && wk.endpoints.feed, "node A serves its well-known discovery document", wk.base_url);
  const bare = await fetch(a.url + "/.well-known/terraviz.json");
  check(bare.status === 403, "a peer without A's launch token is refused, even for the discovery document", "the shell gates every path");
  const feed = await call(a, "GET", "/api/v1/federation/feed");
  const hs = await call(a, "POST", "/api/v1/federation/handshake", {});
  check((feed.headers.get("content-type") ?? "").includes("text/html") && (hs.headers.get("content-type") ?? "").includes("text/html"),
    "feed and handshake, advertised in that document, are not implemented upstream", "they fall through to the web page");
  const seen = await (await call(a, "GET", "/api/v1/catalog", undefined, a.cookie)).json() as any;
  check(seen.datasets[0]?.originNode === wk.node_id, "with A's token, B can read A's catalog, stamped with A's node id", "pulling and merging it is not built");
} finally {
  a.stop(); b.stop(); rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks held");
process.exit(failed ? 1 : 0);
