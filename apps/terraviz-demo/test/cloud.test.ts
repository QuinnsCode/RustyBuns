// The second config the cloud deploy reads: TerraViz's own, with Shared Sphere laid over it and the original left alone.
import { expect, test } from "bun:test";
import type { RustyBunsConfig } from "../../../packages/cli/src/config.ts";
import { cloudSphere, sphereConfigFile } from "../cloud.ts";
import { withSphere } from "../sphere/stage.ts";

const base: RustyBunsConfig = {
  name: "terraviz",
  worker: { compatibilityDate: "2024-12-01", main: ".rustybuns/pages/index.ts", build: "vite build", assets: "dist", compatibilityFlags: ["allow_eval_during_startup"] },
  bindings: { CATALOG_KV: { type: "kv" }, FEEDBACK_DB: { type: "d1", databaseName: "sphere-feedback" }, CATALOG_DB: { type: "d1", databaseName: "sphere-feedback" }, CATALOG_R2: { type: "r2", bucketName: "terraviz-assets" } },
  targets: { edge: { provider: "cloudflare" } },
};

test("Shared Sphere swaps the entry, binds the room and skips TerraViz's build, keeping the rest", () => {
  const c = withSphere(base);
  expect(c.worker).toEqual({ compatibilityDate: "2024-12-01", main: ".rustybuns/sphere/entry.ts", assets: "dist", compatibilityFlags: ["allow_eval_during_startup"] });
  expect(c.bindings).toEqual({ ...base.bindings, SPHERE: { type: "durable_object", className: "SphereRoom" } });
  expect(base.worker?.main).toBe(".rustybuns/pages/index.ts"); // the clone's own config is not touched
  expect(base.bindings).not.toHaveProperty("SPHERE");
});

test("the config file it writes loads back as that config", async () => {
  const text = sphereConfigFile(base);
  expect(text).toContain("RUSTYBUNS_CONFIG=rustybuns.sphere.config.ts");
  const json = JSON.parse(text.slice(text.indexOf("defineConfig(") + "defineConfig(".length, text.lastIndexOf(");")));
  expect(json).toEqual(cloudSphere(base));
});

test("the cloud stage is the Worker shared-terraviz and shares no resource name with the plain site", () => {
  const c = cloudSphere(base);
  expect(c.targets.edge).toMatchObject({ workerName: "shared-terraviz", adopt: true });
  expect(c.bindings).toMatchObject({
    FEEDBACK_DB: { databaseName: "shared-terraviz-feedback-db" }, CATALOG_DB: { databaseName: "shared-terraviz-catalog-db" },
    CATALOG_R2: { bucketName: "shared-terraviz-catalog-r2" },
  });
});
