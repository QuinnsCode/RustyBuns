// `bun run new-game`: the starter copied under a new game's names, and its probe row.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyStarter, withCiRow, withHandle } from "./new-game.ts";
import { starterNames } from "../apps/codesplitter/src/starter.ts";

const root = join(import.meta.dir, "..");

test("names from an id", () => {
  expect(starterNames("rocket-golf")).toEqual({ id: "rocket-golf", handle: "rocketGolf", title: "Rocket Golf", prefix: "rocket_golf" });
  expect(starterNames("3d-golf", " Golf 3D ")).toEqual({ id: "3d-golf", handle: "game3dGolf", title: "Golf 3D", prefix: "game_3d_golf" });
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
    expect(read("src/main.ts")).toContain('PREFIX = "rocket_golf"'); // its page commands: rocket_golf_how_to_play, _start, _state
    expect(read("index.html")).toContain("<title>Rocket Golf</title>");
    for (const f of files) expect(read(f)).not.toMatch(/starter-game|starterGame|Starter Game|starter_game/);
  } finally { rmSync(to, { recursive: true, force: true }); }

  const probe = readFileSync(join(root, "scripts/probe.ts"), "utf8"), added = withHandle(probe, n);
  expect(added).toContain(`"rocket-golf": { state: "rocketGolf.state()"`);
  expect(withHandle(added, n)).toBe(added);

  const ci = readFileSync(join(root, "scripts/ci-apps.ts"), "utf8"), withRow = withCiRow(ci, n);
  expect(withRow).toContain('\n  "starter-game":      { test: "bun test test", drop: false },\n  "rocket-golf":       { test: "bun test test", drop: false },\n');
  expect(withCiRow(withRow, n)).toBe(withRow);
});
