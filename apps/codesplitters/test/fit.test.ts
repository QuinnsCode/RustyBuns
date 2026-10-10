import { afterAll, expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

async function repo(name: string, visibility: string, files: Record<string, string>) {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name, visibility });
  for (const [path, content] of Object.entries(files)) await send("ryan", `/api/repos/ryan/${name}/files`, { path, content });
  return call;
}

test("a Vite + React repo in TypeScript is ready, and anyone who can read it may ask", async () => {
  const call = await repo("shop", "public", {
    "package.json": JSON.stringify({ name: "shop", dependencies: { react: "19.0.0" }, devDependencies: { vite: "6.0.0" } }),
    "vite.config.ts": `import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };`,
    "src/main.tsx": "export {};",
  });
  const f = await (await call("ana", "/api/repos/ryan/shop/fit")).json();
  expect(f).toMatchObject({ verdict: "ready", stack: "vite-react", label: "Vite + React, TypeScript", typescript: true });
});

test("a SvelteKit repo needs work and links its issue; a private one stays hidden", async () => {
  const call = await repo("blog", "private", { "package.json": JSON.stringify({ name: "blog", devDependencies: { "@sveltejs/kit": "2.0.0", vite: "6.0.0" } }) });
  const f = await (await call("ryan", "/api/repos/ryan/blog/fit")).json();
  expect(f).toMatchObject({ verdict: "needs-work", stack: "sveltekit" });
  expect(f.issue).toMatch(/issues\/201$/);
  expect((await call("ana", "/api/repos/ryan/blog/fit")).status).toBe(404);
});

test("no package.json is a poor fit", async () => {
  const call = await repo("notes", "public", { "README.md": "# notes" });
  expect((await (await call("ryan", "/api/repos/ryan/notes/fit")).json()).verdict).toBe("poor");
});

test("the verdict is kept per commit and read again when main moves", async () => {
  const call = await repo("kept", "public", { "package.json": JSON.stringify({ name: "kept", dependencies: { react: "19.0.0" }, devDependencies: { vite: "6.0.0" } }) });
  const commit = (path: string) => call("ryan", `/api/repos/ryan/kept/do/commit?path=${encodeURIComponent(path)}`, { method: "POST", body: JSON.stringify({ message: path }) });
  const db = (call as any).env.DB;
  expect((await commit("package.json")).ok).toBe(true);
  const first = await (await call("ana", "/api/repos/ryan/kept/fit")).json();
  const row = await db.prepare("SELECT commit_hash FROM fit_cache WHERE owner = 'ryan' AND repo = 'kept'").first();
  expect(row.commit_hash).toMatch(/^v\d+:[0-9a-f]{40}$/);

  // Same commit: the kept verdict answers, nothing is read again.
  await db.prepare("UPDATE fit_cache SET data = ? WHERE owner = 'ryan' AND repo = 'kept'").bind(JSON.stringify({ ...first, label: "from the cache" })).run();
  expect((await (await call("ana", "/api/repos/ryan/kept/fit")).json()).label).toBe("from the cache");

  // A new commit on main: read again.
  await call("ryan", "/api/repos/ryan/kept/files", { method: "POST", body: JSON.stringify({ path: "vite.config.ts", content: `import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };` }) });
  expect((await commit("vite.config.ts")).ok).toBe(true);
  const after = await (await call("ana", "/api/repos/ryan/kept/fit")).json();
  expect(after.label).not.toBe("from the cache");
  expect(after).toMatchObject({ verdict: "ready", stack: "vite-react" });
  expect((await db.prepare("SELECT COUNT(*) AS n FROM fit_cache WHERE owner = 'ryan' AND repo = 'kept'").first()).n).toBe(1);
});

test("a monorepo root lists its apps with a verdict each, and ?dir= checks one", async () => {
  const call = await repo("mono", "public", {
    "package.json": JSON.stringify({ name: "mono", private: true, workspaces: ["apps/*", "packages/ui"] }),
    "apps/web/package.json": JSON.stringify({ name: "@mono/web", dependencies: { react: "19.0.0" }, devDependencies: { vite: "6.0.0" } }),
    "apps/web/src/main.tsx": "export {};",
    "apps/blog/package.json": JSON.stringify({ name: "@mono/blog", devDependencies: { astro: "5.0.0" } }),
    "apps/notes/README.md": "# not a package yet",
    "packages/ui/package.json": JSON.stringify({ name: "@mono/ui" }),
  });
  const root = await (await call("ana", "/api/repos/ryan/mono/fit")).json();
  expect(root.verdict).toBe("needs-work");
  expect(root.workspaces).toEqual([
    { dir: "apps/blog", name: "@mono/blog", verdict: "ready", stack: "astro", label: "Astro" },
    { dir: "apps/web", name: "@mono/web", verdict: "ready", stack: "vite-react", label: "Vite + React, TypeScript" },
    { dir: "packages/ui", name: "@mono/ui", verdict: "needs-work", stack: "unknown", label: "no framework" },
  ]);
  const web = await (await call("ana", "/api/repos/ryan/mono/fit?dir=apps/web/")).json();
  expect(web).toMatchObject({ dir: "apps/web", verdict: "ready", stack: "vite-react", typescript: true });
  expect(web.workspaces).toBeUndefined();
  expect((await call("ana", "/api/repos/ryan/mono/fit?dir=apps/nope")).status).toBe(404);
  expect((await call("ana", "/api/repos/ryan/mono/fit?dir=../x")).status).toBe(400);
});

test("pnpm-workspace.yaml names the workspaces too", async () => {
  const { workspaceGlobs } = await import("../src/fit.ts");
  expect(workspaceGlobs(null, "packages:\n  - 'apps/*'\n  - \"tools/cli\" # the cli\n  - '!apps/old'\ncatalog:\n  - nope\n")).toEqual(["apps/*", "tools/cli"]);
  expect(workspaceGlobs({ workspaces: { packages: ["./libs/*/"] } }, null)).toEqual(["libs/*"]);
});
