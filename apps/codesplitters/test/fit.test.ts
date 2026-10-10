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
