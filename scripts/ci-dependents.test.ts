import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { changedPackages, dependents, gitUsers } from "./ci-dependents.ts";

const root = new URL("..", import.meta.url).pathname;
const apps = (files: string[]) => dependents(changedPackages(files), (n) => gitUsers(n, root));

test("a package's change tests the apps that use it on this tree, and its docs test none", async () => {
  const all = readdirSync(`${root}apps`).length;
  // a model's code: the apps that draw with it, not every app
  const models = await apps(["packages/models/src/gear.ts"]);
  expect(models.has("fm-daw")).toBe(true);
  expect(models.has("codesplitter")).toBe(false);
  expect(models.size).toBeLessThan(all / 3);
  // reference photos and notes are no app's code
  expect((await apps(["packages/models/docs/gear-refs/shot.jpg", "packages/rig/README.md"])).size).toBe(0);
  // util is nearly everyone's, imported by name or by a relative path
  expect((await apps(["packages/util/src/http.ts"])).size).toBeGreaterThan(all / 2);
});

test("an app using a package only through another package is tested too", async () => {
  // game uses engine, engine uses core; tool uses core itself
  const said: Record<string, string[]> = { core: ["packages/engine/src/a.ts", "apps/tool/src/x.ts"], engine: ["apps/game/src/main.ts", "packages/engine/package.json"] };
  const got = await dependents(changedPackages(["packages/core/src/a.ts"]), async (names) => names.flatMap((n) => said[n] ?? []));
  expect([...got].sort()).toEqual(["game", "tool"]);
});
