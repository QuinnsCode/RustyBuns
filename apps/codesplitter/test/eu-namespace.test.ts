import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { handleFor } from "../src/archive.ts";

// A repo made with region "eu" keeps its git in the EU namespace; every other repo stays in the default one (#2301).

/** Cloudflare's Artifacts as far as repo creation and lookup use it, over a Map. */
function fakeNamespace(namespace: string) {
  const repos = new Map<string, string>();
  const remote = (name: string) => `https://acct.artifacts.cloudflare.net/git/${namespace}/${name}.git`;
  return {
    repos,
    async create(name: string) { repos.set(name, name); return { name, remote: remote(name), defaultBranch: "main" }; },
    async get(name: string) { if (!repos.has(name)) throw new Error("NOT_FOUND"); return { name, remote: remote(name), info: async () => ({ name }) }; },
  };
}

test("a repo made in the EU lives in the EU namespace, and one made without a region doesn't", async () => {
  const eu = fakeNamespace("codesplitter-eu");
  const call = await boot({ GH_CLI: "off", ARTIFACTS_EU: eu as any });
  const send = (path: string, body: unknown) => call("ryan", path, { method: "POST", body: JSON.stringify(body) });
  await send("/api/login", { name: "ryan" });
  expect((await send("/api/repos", { name: "berlin", region: "eu" })).status).toBe(201);
  expect((await send("/api/repos", { name: "home" })).status).toBe(201);

  expect([...eu.repos.keys()]).toEqual(["ryan--berlin"]);
  const rows = (await call.env.DB.prepare("SELECT name, namespace, artifact_remote FROM repos ORDER BY name").all()).results as { name: string; namespace: string | null; artifact_remote: string }[];
  expect(rows.map((r) => [r.name, r.namespace])).toEqual([["berlin", "eu"], ["home", null]]);
  expect(rows[0]!.artifact_remote).toContain("/codesplitter-eu/");
  expect(rows[1]!.artifact_remote).not.toContain("/codesplitter-eu/");

  // Later lookups read the namespace the repo was made in.
  const h = await handleFor(call.env, "ryan", "berlin");
  expect(h?.remote).toContain("/codesplitter-eu/");
  call.close();
});

test("a region that isn't eu is refused, and so is eu on an app with no EU storage", async () => {
  const call = await boot({ GH_CLI: "off" });
  const send = (body: unknown) => call("ryan", "/api/repos", { method: "POST", body: JSON.stringify(body) });
  await call("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
  expect((await send({ name: "a", region: "mars" })).status).toBe(400);
  expect((await send({ name: "b", region: "eu" })).status).toBe(501);
  expect(((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM repos").first()) as { n: number }).n).toBe(0);
  call.close();
});
