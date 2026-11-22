// The Play Store wrapper's parts that need no key and no Android SDK: Bubblewrap's config from the real web manifest,
// and the assetlinks.json that lets Android open the TWA with no URL bar.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkAssetLinks, PACKAGE_ID, twaManifest, withFingerprint } from "../scripts/twa.ts";

const app = join(import.meta.dir, "..");
const links = () => Bun.file(join(app, "public/.well-known/assetlinks.json")).json();
const KEY = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

test("Bubblewrap's config comes from the live manifest", async () => {
  const web = await Bun.file(join(app, "public/manifest.webmanifest")).json();
  const twa = twaManifest(new URL("https://dice.example.dev/manifest.webmanifest"), web, 29_000_000);
  expect(twa).toMatchObject({
    packageId: PACKAGE_ID, host: "dice.example.dev", name: "Pocket Dice", launcherName: "Dice", startUrl: "/",
    themeColor: "#e8590c", backgroundColor: "#fff8f0", appVersionCode: 29_000_000,
    iconUrl: "https://dice.example.dev/icons/512.png", maskableIconUrl: "https://dice.example.dev/icons/maskable-512.png",
  });
  expect(() => twaManifest(new URL("https://x.dev/m"), { icons: [] }, 1)).toThrow(/512 icon/);
});

test("assetlinks.json names the package, and takes the key's fingerprint", async () => {
  const committed = await links();
  expect(checkAssetLinks(committed, false)).toEqual([]);
  const signed = withFingerprint(withFingerprint(committed, KEY.toLowerCase()), KEY);
  expect(signed[0]!.target.sha256_cert_fingerprints).toEqual([KEY]);
  expect(checkAssetLinks(signed)).toEqual([]);
  expect(checkAssetLinks(committed)).toEqual([expect.stringMatching(/no signing key/)]);
  expect(checkAssetLinks("<!doctype html>")).toEqual(["assetlinks.json is not a JSON list"]);
  expect(checkAssetLinks([{ ...signed[0], target: { ...signed[0]!.target, package_name: "com.other" } }])[0]).toMatch(/no statement/);
  expect(() => withFingerprint(committed, "AB:CD")).toThrow(/not a SHA-256/);
});
