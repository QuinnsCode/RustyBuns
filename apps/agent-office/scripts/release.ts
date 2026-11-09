// The Agent Office release rustybunsify.ts builds from, and its tarball, fetched once into .cache and checked every time.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

export const PINNED = { tag: "v0.1.211", sha256: "d9b3af07a55005239550ca0cec9c0f1f86aee409d8122b12d99794ee0f18231a" };
export const REPO = "AgentSystemLabs/agent-office";

/** GitHub's release downloads answered 5xx on every try: an outage, not a wrong pin (that's a 404). */
export class ReleaseDown extends Error {
  constructor(readonly tag: string, readonly status: number) {
    super(`download of ${tag} failed: GitHub answered ${status} on every try`);
  }
}

type Fetch = (url: string) => Promise<Response>;
export type Download = { fetch?: Fetch; tries?: number; waitMs?: number };

/** `url` fetched, asked again with a growing wait on a 5xx or a network error; any other answer comes back as it is. */
async function fetchRetrying(tag: string, url: string, { fetch: get = fetch, tries = 3, waitMs = 1000 }: Download) {
  for (let i = 1; ; i++) {
    const res = await get(url).catch((e: unknown) => (i < tries ? undefined : Promise.reject(e)));
    if (res && res.status < 500) return res;
    if (i >= tries) throw new ReleaseDown(tag, res?.status ?? 0);
    await Bun.sleep(waitMs * i);
  }
}

/** The path of the release's agent-office.tgz in `cache`, downloaded if it isn't there yet. */
export async function releaseTarball(tag: string, sha256: string, cache: string, download: Download = {}) {
  const tgz = path.join(cache, `agent-office-${tag}.tgz`);
  if (!existsSync(tgz)) {
    mkdirSync(cache, { recursive: true });
    const res = await fetchRetrying(tag, `https://github.com/${REPO}/releases/download/${tag}/agent-office.tgz`, download);
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
