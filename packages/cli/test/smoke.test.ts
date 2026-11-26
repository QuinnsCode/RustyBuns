import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp, installApp, packageManager, withMode } from "../src/smoke.ts";
import { buildEnv } from "../src/sandbox.ts";
import { declaredSecrets, fakeSecret, removeCommittedSecrets } from "../src/fake-secrets.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "smoke-test-"));

test("the lockfile picks the package manager, Bun when there is none", () => {
  const d = tmp();
  expect(packageManager(d)).toBe("bun");
  writeFileSync(join(d, "pnpm-lock.yaml"), "");
  expect(packageManager(d)).toBe("pnpm");
});

test("withMode points the desktop at this run's data and swaps to the Worker build", () => {
  const cfg = `{\n  "desktop": {\n    "mode": "spa",\n    "clientDir": "dist",\n    "builtMain": "x"\n  }\n}`;
  const w = withMode(cfg, "worker", "/d");
  expect(w).toContain(`"dataDir": "/d"`);
  expect(w).toContain(`"mode": "worker"`);
  expect(w).not.toContain("clientDir");
});

test("committed secrets are deleted, examples stay, and fakes are never real-looking credentials of the app's", () => {
  const d = tmp();
  writeFileSync(join(d, ".env"), "DATABASE_URL=postgres://real");
  writeFileSync(join(d, ".env.example"), "AUTH_SECRET=\n");
  writeFileSync(join(d, "a.ts"), "export const k = process.env.STRIPE_SECRET_KEY");
  expect(removeCommittedSecrets(d)).toEqual([".env"]);
  expect(declaredSecrets(d)).toEqual(["AUTH_SECRET", "STRIPE_SECRET_KEY"]);
  expect(fakeSecret("DATABASE_URL")).toContain("127.0.0.1:9");
  expect(fakeSecret("CLOUDFLARE_API_TOKEN")).toBeUndefined();
});

test("a workspace member is copied with its workspace and installs there, its workspace:* sibling linked", () => {
  const ws = tmp();
  const pkg = (dir: string, body: object) => { mkdirSync(join(ws, dir), { recursive: true }); writeFileSync(join(ws, dir, "package.json"), JSON.stringify(body)); };
  pkg(".", { name: "mono", private: true, workspaces: ["apps/*", "packages/*"] });
  pkg("apps/web", { name: "web", dependencies: { "@mono/ui": "workspace:*" } });
  pkg("packages/ui", { name: "@mono/ui", version: "1.0.0" });
  writeFileSync(join(ws, "apps/web/.env"), "DATABASE_URL=postgres://real");

  const { top, dir } = copyApp(join(ws, "apps/web"), join(tmp(), "app"));
  expect(dir).toBe(join(top, "apps/web"));
  expect(existsSync(join(dir, ".env"))).toBe(false);
  const r = installApp(top, buildEnv(process.env));
  expect(r.tail).not.toContain("failed to resolve");
  expect(r.ok).toBe(true);
  expect(existsSync(join(dir, "node_modules/@mono/ui/package.json")) || existsSync(join(top, "node_modules/@mono/ui/package.json"))).toBe(true);
}, 60_000);
