// The Steam lane (#2877): depot IDs, the depot layout per OS, app_build.vdf, and the pinned-hash download.
import { test, expect, setDefaultTimeout } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appBuildVdf, depotIds, depotLayout, fetchChecked, steamConfig } from "../src/steam.ts";
import { Effect } from "effect";
import { decodeConfig } from "../src/config-schema.ts";

const validateConfig = (c: unknown) => Effect.runSync(decodeConfig(c));

setDefaultTimeout(20_000);

test("depots default to appId + 1, 2, 3 and take the config's", () => {
  expect(depotIds({ appId: 480 })).toEqual({ windows: 481, darwin: 482, linux: 483 });
  expect(depotIds({ appId: 480, depots: { linux: 999 } }).linux).toBe(999);
});

test("each OS launches its own file, with the app under resources", () => {
  expect(depotLayout("windows-x64", "hippo-tycoon", "Hippo Tycoon")).toEqual({ launch: "hippo-tycoon.exe", appDir: "resources/app", host: "hippo-tycoon-windows-x64.exe" });
  expect(depotLayout("linux-x64", "hippo-tycoon", "Hippo Tycoon").launch).toBe("hippo-tycoon");
  expect(depotLayout("darwin-arm64", "hippo-tycoon", "Hippo Tycoon").appDir).toBe("Hippo Tycoon.app/Contents/Resources/app");
});

test("app_build.vdf maps each depot folder and sets only a named non-default branch live", () => {
  const v = appBuildVdf({ appId: 480, depots: { windows: 481, linux: 483 }, desc: `hippo "1.0"`, live: "beta" });
  expect(v).toContain(`"AppID" "480"`);
  expect(v).toContain(`"SetLive" "beta"`);
  expect(v).toContain(`"LocalPath" "windows/*"`);
  expect(v).toContain(`"Desc" "hippo \\"1.0\\""`);
  expect(v).not.toContain("darwin");
  expect(appBuildVdf({ appId: 480, depots: { linux: 483 }, desc: "x" })).not.toContain("SetLive");
  expect(() => appBuildVdf({ appId: 480, depots: {}, desc: "x", live: "default" })).toThrow(/default branch/);
  expect(() => appBuildVdf({ appId: 480, depots: {}, desc: "x", live: `beta" "x` })).toThrow(/bad branch/);
});

test("a download that doesn't match its pinned hash is refused and not cached", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-steam-"));
  const body = new TextEncoder().encode("electron");
  const sha256 = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  const fake = (async () => new Response(body)) as unknown as typeof fetch;
  expect(await fetchChecked("https://x.test/a/e.zip", { sha256 }, dir, fake)).toBe(join(dir, "e.zip"));
  await expect(fetchChecked("https://x.test/a/f.zip", { sha256: "0".repeat(64) }, dir, fake)).rejects.toThrow(/pinned hash/);
  expect(existsSync(join(dir, "f.zip"))).toBe(false);
});

test("targets.steam needs the desktop target, and the schema checks it", () => {
  const base = { name: "a", bindings: {}, targets: { steam: { appId: 480 } } } as any;
  expect(() => steamConfig(base)).toThrow(/targets.desktop/);
  expect(() => validateConfig({ ...base, targets: { desktop: {}, steam: { appId: 480, targets: ["windows-x64"] } } })).not.toThrow();
  expect(() => validateConfig({ ...base, targets: { desktop: {}, steam: { appId: 480, targets: ["windows-arm64"] } } })).toThrow();
});
