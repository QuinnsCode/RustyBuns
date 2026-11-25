import { expect, test } from "bun:test";
import { resolve } from "node:path";

// One journey through the server as Claude Code drives it: start it, list its tool, run a program that explores, and
// have the guard turn away a secret read and a push to main inside a program.
test("repo code mode: one program reads, greps and lists, and the guard still holds", async () => {
  const p = Bun.spawn(["bun", resolve(import.meta.dir, "codemode-mcp.ts")], { cwd: resolve(import.meta.dir, ".."), stdin: "pipe", stdout: "pipe" });
  const call = (id: number, code: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "execute", arguments: { code } } });
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    call(3, `const hits = grep("^## Tools", "AGENTS.md"); console.log("seen"); return { hits: hits.length, first: read("AGENTS.md", 1, 1), mine: files("scripts").includes("scripts/codemode-mcp.ts") }`),
    call(4, `return read(".env")`),
    call(5, `return sh("git push origin HEAD:main")`),
    call(6, `return [typeof process, typeof Bun, typeof require].join()`),
  ];
  p.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");
  p.stdin.end();
  const out = (await new Response(p.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
  const res = (id: number) => out.find((m) => m.id === id).result;
  expect(res(2).tools.map((t: { name: string }) => t.name)).toEqual(["execute"]);
  expect(res(3)).toEqual({ content: [{ type: "text", text: `{"hits":1,"first":"# RustyBuns","mine":true}\nseen` }], isError: false });
  expect(res(4).isError).toBe(true);
  expect(res(4).content[0].text).toContain("read .env");
  expect(res(5).isError).toBe(true);
  expect(res(5).content[0].text).toContain("push to main");
  expect(res(6).content[0].text).toBe("undefined,undefined,undefined");
}, 30_000);
