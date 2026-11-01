import { expect, test } from "bun:test";
import { BODY, COMMENT, brief, cut, tidy, type Issue } from "./issue.ts";

const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 3046, title: "Spike: a party kit", state: "OPEN", url: "https://github.com/QuinnsCode/RustyBuns/issues/3046", createdAt: "2026-10-31T04:00:00Z", updatedAt: "2026-11-01T05:00:00Z",
  body: "<!-- template -->\nFirst paragraph.\n\n\n\n## Why\n\nBecause.", author: { login: "QuinnsCode" }, labels: [{ name: "manual run" }], assignees: [], closedByPullRequestsReferences: [{ number: 3112 }],
  comments: [], ...over,
});

test("the brief is a header, the tidied body and the last three comments, each cut", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of the body, long enough to matter here.`).join("\n\n");
  const comments = Array.from({ length: 5 }, (_, i) => ({ author: { login: `u${i}` }, createdAt: `2026-11-0${i + 1}T00:00:00Z`, body: i === 4 ? "w ".repeat(COMMENT) : `comment ${i}` }));
  const out = brief(issue({ body: long, comments })).join("\n");
  expect(out.split("\n")[0]).toBe("#3046 OPEN Spike: a party kit");
  expect(out.split("\n")[1]).toBe("  by QuinnsCode 2026-10-31, updated 2026-11-01, labels manual run, closed by #3112, 5 comments");
  expect(out).toContain("Paragraph 0 of the body");
  expect(out).not.toContain("Paragraph 39");
  expect(out).toMatch(/… \d+ more characters \(--full\)/);
  expect(out).toContain("… 2 earlier comments (--full)");
  expect(out).not.toContain("-- u0 ");
  expect(out).toContain("-- u2 2026-11-03\ncomment 2");
  expect(out).toContain("-- u4 2026-11-05\n" + "w ".repeat(COMMENT).slice(0, COMMENT - 1).trimEnd());
  expect(out.length).toBeLessThan(BODY + 3 * COMMENT + 600);
  const full = brief(issue({ body: long, comments }), true).join("\n");
  expect(full).toContain("Paragraph 39");
  expect(full).toContain("-- u0 ");
  expect(full).not.toContain("--full");
});

test("the body loses HTML comments and runs of blank lines; a short one is whole", () => {
  expect(tidy(issue().body)).toBe("First paragraph.\n\n## Why\n\nBecause.");
  expect(cut("short", 100)).toBe("short");
  expect(cut("one two three four five six", 12)).toBe("one two\n… 20 more characters (--full)");
});
