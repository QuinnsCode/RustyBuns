// The second config the cloud deploy reads: TerraViz's own, with Shared Sphere laid over it and the original left alone.
import { expect, test } from "bun:test";
import type { RustyBunsConfig } from "../../../packages/cli/src/config.ts";
import { sphereConfigFile } from "../cloud.ts";
import { withSphere } from "../sphere/stage.ts";

const base: RustyBunsConfig = {
  name: "terraviz",
  worker: { compatibilityDate: "2024-12-01", main: ".rustybuns/pages/index.ts", build: "vite build", assets: "dist", compatibilityFlags: ["allow_eval_during_startup"] },
  bindings: { CATALOG_KV: { type: "kv" } },
  targets: { edge: { provider: "cloudflare" } },
};

test("Shared Sphere swaps the entry, binds the room and skips TerraViz's build, keeping the rest", () => {
  const c = withSphere(base);
  expect(c.worker).toEqual({ compatibilityDate: "2024-12-01", main: ".rustybuns/sphere/entry.ts", assets: "dist", compatibilityFlags: ["allow_eval_during_startup"] });
  expect(c.bindings).toEqual({ CATALOG_KV: { type: "kv" }, SPHERE: { type: "durable_object", className: "SphereRoom" } });
  expect(base.worker?.main).toBe(".rustybuns/pages/index.ts"); // the clone's own config is not touched
  expect(base.bindings).not.toHaveProperty("SPHERE");
});

test("the config file it writes loads back as that config", async () => {
  const text = sphereConfigFile(base);
  expect(text).toContain("RUSTYBUNS_CONFIG=rustybuns.sphere.config.ts");
  const json = JSON.parse(text.slice(text.indexOf("defineConfig(") + "defineConfig(".length, text.lastIndexOf(");")));
  expect(json).toEqual(withSphere(base));
});
