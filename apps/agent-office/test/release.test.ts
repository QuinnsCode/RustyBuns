import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReleaseDown, releaseTarball } from "../scripts/release.ts";

const body = "a release tarball";
const sha = new Bun.CryptoHasher("sha256").update(body).digest("hex");

/** A fetch that answers each status in turn (0 = a network error), counting the calls. */
function answering(...statuses: number[]) {
  const seen = { calls: 0 };
  const fetch = async () => {
    const status = statuses[Math.min(seen.calls++, statuses.length - 1)]!;
    if (status === 0) throw new TypeError("fetch failed");
    return new Response(status === 200 ? body : "", { status });
  };
  return { seen, fetch };
}

test.each([
  ["a 504 then a 200 downloads on the second try", [504, 200], 2, "ok"],
  ["a dropped connection then a 200 downloads too", [0, 200], 2, "ok"],
  ["5xx on every try is an outage the tests can skip", [504, 502, 503], 3, "down"],
  ["a 404 fails at once: the pin is wrong", [404], 1, "error"],
] as const)("%s", async (_name, statuses, calls, outcome) => {
  const { seen, fetch } = answering(...statuses);
  const cache = mkdtempSync(path.join(tmpdir(), "rb-release-"));
  const got = releaseTarball("v0.0.1", sha, cache, { fetch, waitMs: 1 });
  if (outcome === "ok") expect(readFileSync(await got, "utf8")).toBe(body);
  else if (outcome === "down") await expect(got).rejects.toBeInstanceOf(ReleaseDown);
  else await got.then(() => { throw new Error("downloaded"); }, (e: unknown) => {
    expect(e).not.toBeInstanceOf(ReleaseDown);
    expect(String(e)).toContain("404");
  });
  await got.catch(() => {});
  expect(seen.calls).toBe(calls);
});
