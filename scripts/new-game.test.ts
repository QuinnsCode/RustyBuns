// `bun run new-game`: the starter copied under a new game's names, and its probe row.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyStarter, withHandle } from "./new-game.ts";
import { starterNames } from "../apps/codesplitter/src/starter.ts";

const root = join(import.meta.dir, "..");

test("names from an id", () => {
  expect(starterNames("rocket-golf")).toEqual({ id: "rocket-golf", handle: "rocketGolf", title: "Rocket Golf" });
  expect(starterNames("3d-golf", " Golf 3D ")).toEqual({ id: "3d-golf", handle: "game3dGolf", title: "Golf 3D" });
  for (const bad of ["", "ab", "Rocket", "rocket--golf", "-rocket", "a".repeat(41)]) expect(starterNames(bad)).toBeNull();
});

test("the starter, copied as rocket-golf: its eqosys id, window handle, title and probe row", () => {
  const n = starterNames("rocket-golf")!, to = mkdtempSync(join(tmpdir(), "new-game-"));
  try {
    const files = copyStarter(join(root, "apps/starter-game"), to, n);
    expect(files).toContain("src/main.ts");
    expect(files.some((f) => f.startsWith("node_modules"))).toBe(false);
    const read = (f: string) => readFileSync(join(to, f), "utf8");
    expect(JSON.parse(read("package.json")).name).toBe("rocket-golf");
    expect(read("src/eqosys.ts")).toContain('APP = "rocket-golf"');
    expect(read("src/main.ts")).toContain("window.rocketGolf = harness");
    expect(read("index.html")).toContain("<title>Rocket Golf</title>");
    for (const f of files) expect(read(f)).not.toMatch(/starter-game|starterGame|Starter Game/);
  } finally { rmSync(to, { recursive: true, force: true }); }

  const probe = readFileSync(join(root, "scripts/probe.ts"), "utf8"), added = withHandle(probe, n);
  expect(added).toContain(`"rocket-golf": { state: "rocketGolf.state()"`);
  expect(withHandle(added, n)).toBe(added);
});
