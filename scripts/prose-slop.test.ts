import { expect, test } from "bun:test";
import { commitMessages, proseSlop } from "./prose-slop.ts";

test.each([
  ["Add a robust, seamless retry", ["filler"]],
  ["Ship it 🚀", ["emoji"]],
  ["Faster tests — half the time", ["em-dash"]],
  ["It's worth noting the cache is cold", ["throat-clearing"]],
  ["Closes QuinnsCode/rustybuns-manual#12", ["manual-close"]],
  ["Part of QuinnsCode/rustybuns-manual#12, closes #5953", []],
  ["Probe: a game's state as JSON from headless Chrome", []],
  ["Rename `leverage()` to `lift()`", []],
])("%s", (text, rules) => {
  expect(proseSlop(text).map((f) => f.rule)).toEqual(rules);
});

test("a PR body: code fences and the attribution line are skipped, findings keep their line", () => {
  const body = "## Summary\nA comprehensive fix.\n\n```\nconst x = \"—\"; // 🚀\n```\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  expect(proseSlop(body).map((f) => [f.line, f.rule])).toEqual([[2, "filler"]]);
});

test("commit messages split per commit", () => {
  const git = () => "abc123\x00Fix the cache\n\nbody — here\n\x01\ndef456\x00Second\n\x01\n";
  const msgs = commitMessages(git, "origin/main");
  expect(msgs.map(([sha]) => sha)).toEqual(["abc123", "def456"]);
  expect(proseSlop(msgs[0]![1]).map((f) => f.rule)).toEqual(["em-dash"]);
});
