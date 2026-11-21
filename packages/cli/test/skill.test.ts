import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_FILE, skillCommand } from "../src/skill.ts";

test("skill add copies the shipped skill into a project, and again only when it changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-"));
  const shipped = readFileSync(SKILL_FILE, "utf8");
  expect(shipped).toStartWith("---\nname: rustybuns\n");
  expect(skillCommand([], dir).text).toBe(shipped);
  const first = skillCommand(["add", "--dir", ".agents/skills"], dir);
  expect(first).toMatchObject({ path: join(dir, ".agents/skills/rustybuns/SKILL.md"), changed: true });
  expect(readFileSync(first.path!, "utf8")).toBe(shipped);
  expect(skillCommand(["add", "--dir", ".agents/skills"], dir).changed).toBe(false);
  expect(skillCommand(["add"], dir).path).toBe(join(dir, ".claude/skills/rustybuns/SKILL.md"));
  expect(() => skillCommand(["add", "--dir"], dir)).toThrow("--dir needs a folder");
  expect(() => skillCommand(["remove"], dir)).toThrow("unknown `skill remove`");
});
