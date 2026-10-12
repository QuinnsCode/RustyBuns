import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli.ts";
import { splittersContext } from "../triage/context.ts";

test("the context says who the token signs in as, never the token", async () => {
  const seen: string[] = [];
  const send = (async (u: string, init?: RequestInit) => {
    seen.push(`${u} ${new Headers(init?.headers).get("authorization") ?? "-"}`);
    return u.endsWith("/session") ? Response.json({ mode: "token", user: "ryan", token: { id: "t1", label: "laptop", scope: "write", expires_at: 0 } }) : new Response("<html>");
  }) as typeof fetch;
  const md = await splittersContext({ url: "https://cs.example", urlFrom: "--url", token: "cst_secret123", tokenFrom: "CODESPLITTER_TOKEN", configPath: "/h/.config/codesplitter/config.json", send });
  expect(md).toContain("- Site: https://cs.example (from --url)");
  expect(md).toContain("an API token (from CODESPLITTER_TOKEN; never print it)");
  expect(md).toContain("- Site answers: 200");
  expect(md).toContain('- whoami: ryan, token "laptop" scope write');
  expect(md).not.toContain("cst_secret123");
  expect(seen).toContain("https://cs.example/api/session Bearer cst_secret123");

  const out = await splittersContext({ url: "https://cs.example", urlFrom: "--url", configPath: "/x", send: (async () => Response.json(null)) as any });
  expect(out).toContain("- whoami: not signed in");
  expect(await splittersContext({ configPath: "/x" })).toContain("- Site: none");
});

test("codesplitter triage --print writes the playbook and the facts under the config dir", async () => {
  const home = mkdtempSync(join(tmpdir(), "cs-home-"));
  const r = await run(["triage", "--print", "--url", "http://127.0.0.1:9"], { HOME: home, PATH: "" });
  expect(r.code).toBe(0);
  const dir = join(home, ".config/codesplitter/triage");
  const [one] = readdirSync(dir);
  expect(readFileSync(join(dir, one!, "prompt.md"), "utf8")).toContain("# codeSplitter triage playbook");
  expect(readFileSync(join(dir, one!, "context.md"), "utf8")).toContain("- Site answers: no answer");
});
