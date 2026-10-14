import { expect, test } from "bun:test";
import { allImages, imagesIn, touchedImages } from "./ci-containers.ts";

const config = `
  bindings: {
    ...(agents ? { AGENT_SANDBOX: { type: "container", className: "AgentSandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2 } as const } : {}),
    DEPLOY_RUNNER: { type: "container", className: "DeployRunner", dockerfile: "deploy-sandbox/Dockerfile" } as const,
    CI_RUNNER: { type: "container", className: "CiRunner", dockerfile: "deploy-sandbox/ci.Dockerfile" } as const,
    DB: { type: "d1", databaseName: "x" },
  }`;

test("images are read from a config's text, and only the ones whose context changed are touched", () => {
  const images = imagesIn("codesplitter", config);
  expect(images.map((i) => i.binding)).toEqual(["AGENT_SANDBOX", "DEPLOY_RUNNER", "CI_RUNNER"]);
  const names = (changed: string[]) => touchedImages(images, changed).map((i) => i.binding);
  // the two deploy-sandbox images share a context; sandbox/ is left alone
  expect(names(["apps/codesplitter/deploy-sandbox/server.mjs"])).toEqual(["DEPLOY_RUNNER", "CI_RUNNER"]);
  expect(names(["apps/codesplitter/src/egress.ts", "README.md"])).toEqual([]);
  expect(names(["packages/cli/src/gen/alchemy.ts"])).toHaveLength(3);
});

test("the repo's real configs yield codeSplitter's three images", () => {
  expect(allImages().filter((i) => i.app === "codesplitter").map((i) => i.dockerfile).sort())
    .toEqual(["deploy-sandbox/Dockerfile", "deploy-sandbox/ci.Dockerfile", "sandbox/Dockerfile"]);
});
