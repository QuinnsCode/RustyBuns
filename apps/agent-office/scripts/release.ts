// The Agent Office release rustybunsify.ts builds from, and its tarball, fetched once into .cache and checked every time.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

export const PINNED = { tag: "v0.1.211", sha256: "d9b3af07a55005239550ca0cec9c0f1f86aee409d8122b12d99794ee0f18231a" };
export const REPO = "AgentSystemLabs/agent-office";

/** The path of the release's agent-office.tgz in `cache`, downloaded if it isn't there yet. */
export async function releaseTarball(tag: string, sha256: string, cache: string) {
  const tgz = path.join(cache, `agent-office-${tag}.tgz`);
  if (!existsSync(tgz)) {
    mkdirSync(cache, { recursive: true });
    const res = await fetch(`https://github.com/${REPO}/releases/download/${tag}/agent-office.tgz`);
    if (!res.ok) throw new Error(`download of ${tag} failed (${res.status})`);
    await Bun.write(`${tgz}.part`, res);
    renameSync(`${tgz}.part`, tgz);
  }
  const got = new Bun.CryptoHasher("sha256").update(readFileSync(tgz)).digest("hex");
  if (got !== sha256.replace(/^sha256:/, "").toLowerCase()) {
    rmSync(tgz, { force: true });
    throw new Error(`Agent Office ${tag} tarball has sha256 ${got}, expected ${sha256}; refusing to build from it`);
  }
  return tgz;
}
