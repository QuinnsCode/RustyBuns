import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { filteredRuns, workspacePrebuild } from "../src/glue/workspace-build.ts";

/** A temp repo from { "path": contents }; objects are written as JSON. */
function repo(files: Record<string, unknown>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rb-ws-")));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof c === "string" ? c : JSON.stringify(c));
  }
  return root;
}

const lib = (name: string, extra: object = {}) =>
  ({ name, main: "dist/index.js", scripts: { build: "mkdir -p dist && echo built > dist/index.js" }, ...extra });

test("workspacePrebuild: unbuilt workspace deps, deepest first, on pnpm", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    "pnpm-lock.yaml": "",
    "package.json": { name: "root", private: true },
    "apps/web/package.json": { name: "web", dependencies: { "@acme/ui": "workspace:*", "@acme/icons": "workspace:*", react: "^19" } },
    "packages/ui/package.json": lib("@acme/ui", { dependencies: { "@acme/tokens": "workspace:^" } }),
    "packages/tokens/package.json": lib("@acme/tokens"),
    // already built: left alone
    "packages/icons/package.json": lib("@acme/icons"),
    "packages/icons/dist/index.js": "",
  });
  expect(workspacePrebuild(join(root, "apps/web"))).toEqual([
    `(cd '${root}/packages/tokens' && pnpm run build)`,
    `(cd '${root}/packages/ui' && pnpm run build)`,
  ]);
});

test("workspacePrebuild: npm workspaces by name, exports targets, source-only packages skipped", () => {
  const root = repo({
    "package.json": { name: "root", workspaces: ["apps/*", "packages/*"] },
    "package-lock.json": "{}",
    "apps/site/package.json": { name: "site", dependencies: { core: "*", src: "*", "left-pad": "1.0.0" } },
    "packages/core/package.json": { name: "core", exports: { ".": { types: "./src/index.ts", import: "./dist/index.mjs" } }, scripts: { build: "tsup" } },
    // ships its source: nothing to build
    "packages/src/package.json": { name: "src", main: "src/index.ts", scripts: { build: "tsc" } },
    "packages/src/src/index.ts": "",
  });
  expect(workspacePrebuild(join(root, "apps/site"))).toEqual([`(cd '${root}/packages/core' && npm run build)`]);
});

test("workspacePrebuild: not in a workspace, nothing", () => {
  const root = repo({ "package.json": { name: "solo", dependencies: { a: "*" } } });
  expect(workspacePrebuild(root)).toEqual([]);
});

test("workspacePrebuild: the steps build the dependency", async () => {
  const root = repo({
    "package.json": { name: "root", workspaces: ["apps/*", "packages/*"] },
    "bun.lock": "",
    "apps/web/package.json": { name: "web", dependencies: { ui: "workspace:*" } },
    "packages/ui/package.json": lib("ui"),
  });
  for (const s of workspacePrebuild(join(root, "apps/web"))) await $`sh -c ${s}`.quiet();
  expect(await Bun.file(join(root, "packages/ui/dist/index.js")).text()).toBe("built\n");
  expect(workspacePrebuild(join(root, "apps/web"))).toEqual([]);
});

test("workspacePrebuild: a sibling's generate step from the app's predev, then its prebuild (Rat Stack)", async () => {
  const root = repo({
    "package.json": { name: "root", workspaces: ["apps/*"] },
    "bun.lock": "",
    // web imports site's generated file; site ships source, so nothing looks unbuilt
    "apps/web/package.json": {
      name: "web",
      dependencies: { site: "workspace:*" },
      scripts: { predev: "bun --filter site generate", prebuild: "echo pre > pre.txt", dev: "vite" },
    },
    "apps/site/package.json": { name: "site", exports: { ".": "./src/index.ts" }, scripts: { generate: "echo gen > src/content.generated.ts" } },
    "apps/site/src/index.ts": "",
  });
  const web = join(root, "apps/web");
  const steps = workspacePrebuild(web, "bunx vite build");
  expect(steps).toEqual([`(cd '${root}/apps/site' && bun run generate)`, `(cd '${web}' && bun run prebuild)`]);
  for (const s of steps) await $`sh -c ${s}`.quiet();
  expect(await Bun.file(join(root, "apps/site/src/content.generated.ts")).text()).toBe("gen\n");
  expect(await Bun.file(join(web, "pre.txt")).text()).toBe("pre\n");
  // the package manager's own build script runs prebuild itself
  expect(workspacePrebuild(web, "bun run build")).toEqual([`(cd '${root}/apps/site' && bun run generate)`]);
});

test("filteredRuns: only a predev made wholly of workspace script runs", () => {
  const members = new Map([["@rat-stack/site", 1], ["ui", 1]]);
  const table: [string, [string, string][]][] = [
    ["pnpm --filter @rat-stack/site generate", [["@rat-stack/site", "generate"]]],
    ["pnpm -F ui run icons && yarn workspace @rat-stack/site generate", [["ui", "icons"], ["@rat-stack/site", "generate"]]],
    ["npm run generate --workspace=ui", [["ui", "generate"]]],
    ["pnpm --filter @rat-stack/site generate && node scripts/dev.js", []],
    ["pnpm --filter left-pad generate", []],
  ];
  for (const [script, want] of table) expect(filteredRuns(script, members)).toEqual(want);
});
