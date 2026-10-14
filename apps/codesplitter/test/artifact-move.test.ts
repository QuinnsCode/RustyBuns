import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { namesOf } from "../src/artifact-move.ts";

// End to end (real git, in-process D1): copy a repo into a second namespace, then rewrite its stored remote (#823).
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

test("names of a repo's Artifacts: its own and its crew copy, once each", () => {
  expect(namesOf([{ artifact: "a--x", crew_artifact: "a--x.crew" }, { artifact: "a--x", crew_artifact: null }, { artifact: null, crew_artifact: null }])).toEqual(["a--x", "a--x.crew"]);
});

/** Cloudflare's Artifacts as far as the move uses it, over a Map: `import` records what it was handed. */
function fakeNamespace(namespace: string) {
  const repos = new Map<string, string>(), imported: { name: string; url: string }[] = [];
  const remote = (name: string) => `https://acct.artifacts.cloudflare.net/git/${namespace}/${name}.git`;
  return {
    repos, imported, remote,
    async get(name: string) { if (!repos.has(name)) throw new Error("NOT_FOUND"); return { info: async () => ({ name, defaultBranch: "main", remote: remote(name), readOnly: false, source: null }) }; },
    async import(p: { source: { url: string }; target: { name: string } }) { repos.set(p.target.name, p.source.url); imported.push({ name: p.target.name, url: p.source.url }); return { name: p.target.name, remote: remote(p.target.name), defaultBranch: "main" }; },
  };
}

test("copy brings each repo over once, and rewrite points the stored remotes at the copies", async () => {
  const next = fakeNamespace("codesplitter");
  const call = await boot({ GH_CLI: "off", ADMINS: "ryan", ARTIFACTS_NEXT: next as any });
  opened.push(call);
  const send = (user: string, url: string, body: unknown = {}) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab" });
  const row = () => call.env.DB.prepare("SELECT artifact, artifact_remote FROM repos WHERE owner = 'ryan' AND name = 'lab'").first() as Promise<{ artifact: string; artifact_remote: string }>;
  const before = await row();

  // Not an admin: refused, and nothing copied.
  await send("mia", "/api/login", { name: "mia" });
  expect((await send("mia", "/api/admin/artifacts/copy")).status).toBe(403);
  expect(next.imported).toEqual([]);

  const copied = (await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { copied: string[]; failed: unknown[]; next: string | null };
  expect(copied.failed).toEqual([]);
  expect(copied.copied).toEqual([before.artifact]);
  expect(copied.next).toBeNull();
  expect(next.imported).toHaveLength(1);
  // The source is the old remote with a read token in it.
  expect(next.imported[0]!.url).toMatch(/^https?:\/\/x:art_v1_[0-9a-f]+@/);

  const again = (await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { copied: string[]; skipped: string[] };
  expect(again.copied).toEqual([]);
  expect(again.skipped).toEqual([before.artifact]);
  expect(next.imported).toHaveLength(1);

  // The stored remote isn't touched until the binding has moved.
  expect((await row()).artifact_remote).toBe(before.artifact_remote);
  const done = (await (await send("ryan", "/api/admin/artifacts/rewrite")).json()) as { rewritten: { artifact_remote: number }; notCopied: string[] };
  expect(done.rewritten.artifact_remote).toBe(1);
  expect(done.notCopied).toEqual([]);
  expect((await row()).artifact_remote).toBe(next.remote(before.artifact));
});
