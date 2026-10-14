import { describe, expect, test } from "bun:test";

import { local, git, upstream, settled, fakeGitHub, tooBig } from "./tarball-kit.ts";

describe("past the Artifacts import cap", () => {
  // Without a token it never touches the API, which is usually spent on a shared IP (#386).
  test.each([["without a token", { GH_CLI: "off" }], ["with one", { GH_CLI: "off", GITHUB_TOKEN: "t" }]])("a dig comes in from GitHub's tarball, the same tree git has, %s", async (_, env) => {
    const { sha, tree, tgz } = upstream();
    const call = await local(env);
    call.artifacts.import = tooBig(call.artifacts) as any;
    const restore = fakeGitHub(sha, tgz, { limited: true });
    try {
      await call("ana", "/api/login", { method: "POST", body: JSON.stringify({ name: "ana" }) });
      await call.artifacts.create("ana--big");   // an orphan from a dig cut off halfway: no row owns it
      const res = await call("ana", "/api/github/dig", { method: "POST", body: JSON.stringify({ repo: "o/big" }) });
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).commit).toBe(sha);
      const [tip] = await (await call.artifacts.get("ana--big")).log();
      expect(tip!.treeHash).toBe(tree);
      expect(tip!.message).toStartWith("the tip");
      expect(tip!.author).toEqual({ name: "Up Stream", email: "up@stream.dev" });
      const repo = await call.artifacts.get("ana--big");
      expect(await (await repo.readFile({ ref: "main", path: "link.ts" }))!.text()).toBe("src/a.ts");
    } finally { restore(); }
  });

  test("without a token, its submodules come from github.com too (#394)", async () => {
    const subs = { "vendor/zig": "a".repeat(40), "deps/sub": "b".repeat(40) };
    const { sha, tree, tgz, dir } = upstream(subs);
    const call = await local({ GH_CLI: "off" });
    call.artifacts.import = tooBig(call.artifacts) as any;
    const restore = fakeGitHub(sha, tgz, { dir, limited: true });
    try {
      await call("ana", "/api/login", { method: "POST", body: JSON.stringify({ name: "ana" }) });
      expect((await call("ana", "/api/github/dig", { method: "POST", body: JSON.stringify({ repo: "o/big" }) })).status).toBe(201);
      // The same tree as git's, gitlinks and all.
      expect((await (await call.artifacts.get("ana--big")).log())[0]!.treeHash).toBe(tree);
    } finally { restore(); }
  });

  test("a folder's URL digs up just that folder, as the root of a repo named for it (#381)", async () => {
    const { sha, tgz, dir } = upstream();
    const call = await local({ GH_CLI: "off" });
    // Not too big: a folder skips the Artifacts import, which can only take the whole repo.
    const imports: unknown[] = [];
    call.artifacts.import = (async (o: unknown) => { imports.push(o); throw new Error("not this way"); }) as any;
    const restore = fakeGitHub(sha, tgz, { limited: true });
    try {
      await call("ana", "/api/login", { method: "POST", body: JSON.stringify({ name: "ana" }) });
      const dig = (repo: string) => call("ana", "/api/github/dig", { method: "POST", body: JSON.stringify({ repo }) });
      const res = await dig("https://github.com/o/big/tree/main/src");
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ owner: "ana", name: "src", upstream: "github:o/big/tree/main/src", commit: sha });
      expect(imports).toEqual([]);
      const [tip] = await (await call.artifacts.get("ana--src")).log();
      expect(tip!.treeHash).toBe(git(dir, "rev-parse", "HEAD:src"));
      expect(tip!.message).toContain("o/big's src at");
      // A folder that isn't there makes no repo.
      expect((await dig("github.com/o/big/tree/main/nope")).status).toBe(502);
      expect((await call("ana", "/api/repos/ana/nope")).status).toBe(404);
    } finally { restore(); }
  });

  test("a level does too, and stays read-only", async () => {
    const { sha, tree, tgz } = upstream();
    const call = await local({ GH_CLI: "off", ADMINS: "boss" });
    call.artifacts.import = tooBig(call.artifacts) as any;
    const restore = fakeGitHub(sha, tgz);
    // The level's repo, pointed at the fake.
    const { LEVELS } = await import("../src/levels.ts");
    const alchemy = LEVELS.find((l) => l.slug === "alchemy")!, was = alchemy.repo;
    alchemy.repo = "o/big";
    try {
      await call("boss", "/api/login", { method: "POST", body: JSON.stringify({ name: "boss" }) });
      expect((await call("boss", "/api/levels/alchemy/import", { method: "POST", body: "{}" })).status).toBe(202);
      expect((await settled(call, "alchemy")).status).toBe("ready");
      const handle = await call.artifacts.get("level-alchemy");
      expect((await handle.info()).readOnly).toBe(true);
      expect((await handle.log())[0]!.treeHash).toBe(tree);
      expect(await call.artifacts.get("level-alchemy-tip").then(() => "kept", () => "gone")).toBe("gone");
    } finally { restore(); alchemy.repo = was; }
  });

});
