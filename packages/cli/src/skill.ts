// `rustybuns skill`: the agent skill for building with Rusty Buns, shipped in this package (skills/rustybuns/SKILL.md).
//   rustybuns skill               print it
//   rustybuns skill add [--dir d] write it to <d>/rustybuns/SKILL.md (default .claude/skills; .agents/skills for Codex)
// The copy is the package's own file, so `add` again after an upgrade brings it up to date.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SKILL_FILE = new URL("../skills/rustybuns/SKILL.md", import.meta.url).pathname;

export interface SkillResult { path?: string; text: string; changed?: boolean }

export function skillCommand(argv: string[], cwd = process.cwd(), source = SKILL_FILE): SkillResult {
  const text = readFileSync(source, "utf8");
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "print") return { text };
  if (sub !== "add") throw new Error(`unknown \`skill ${sub}\`: try \`rustybuns skill\` or \`rustybuns skill add [--dir .claude/skills]\``);
  const i = rest.indexOf("--dir");
  const dir = i >= 0 ? rest[i + 1] : ".claude/skills";
  if (!dir || dir.startsWith("--")) throw new Error("--dir needs a folder, like .agents/skills");
  const path = join(cwd, dir, "rustybuns", "SKILL.md");
  const changed = !existsSync(path) || readFileSync(path, "utf8") !== text;
  if (changed) { mkdirSync(join(cwd, dir, "rustybuns"), { recursive: true }); writeFileSync(path, text); }
  return { path, text, changed };
}
