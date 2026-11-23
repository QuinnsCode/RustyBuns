import { expect, test } from "bun:test";
import { features, level, readSession } from "./task-specs.ts";

test.each([
  ["vague", "Add reorder to past orders."],
  ["decided", "Let customers reorder. It must prefill the new-order form and never place an order by itself. Only the signed-in customer's own orders."],
  ["agent-ready", `Let customers reorder a past order. Start in apps/shop/src/orders.ts. ${"It prefills the form, never submits. ".repeat(20)} Verify with apps/shop/test/orders.test.ts.`],
  ["thread", "Work on issue #4.\n[comment]\nmaybe one click?\n[comment]\nno, prefill only"],
])("%s", (want, text) => expect<string>(level(features(text))).toBe(want));

const typed = (t: string, at: string, extra = {}) => JSON.stringify({ type: "user", promptSource: "typed", timestamp: at, gitBranch: "office/a", message: { content: t }, ...extra });

test("a session's task is its first typed prompt; the owner's later words count as pings or steers, notices and relays don't", () => {
  const s = readSession([
    typed("Work on GitHub issue #12: fix the reorder button", "2026-11-20T10:00:00Z"),
    typed("<task-notification>done</task-notification>", "2026-11-20T10:05:00Z"),
    typed("[From PR agent, another agent] rebase please", "2026-11-20T10:06:00Z"),
    typed("done?", "2026-11-20T10:10:00Z"),
    typed("no, it should prefill the form and not place the order", "2026-11-20T10:20:00Z"),
  ]);
  expect(s).toMatchObject({ task: "Work on GitHub issue #12: fix the reorder button", branch: "office/a", pings: 1, steers: 1 });
  expect(s && s.end - s.start).toBe(20 * 6e4);
  expect(readSession([JSON.stringify({ type: "summary" })])).toBeNull();
});
