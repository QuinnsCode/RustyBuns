import { describe, expect, test } from "bun:test";
import { CAP, commentBody, decide, lastUrl, MARK, stale, TTL_MS, type Live } from "./preview.ts";

const at = 1_000_000_000_000;
const live = (pr: number, ago = 0): Live => ({ pr, app: "eqosys", stage: `pr-${pr}`, url: `https://x-pr-${pr}.workers.dev`, at: at - ago });

describe("preview on demand", () => {
  test("a PR with a preview refreshes it, a new one is made under the cap, and past the cap it is refused", () => {
    expect(decide([live(1)], 1)).toEqual({ do: "refresh" });
    expect(decide([live(1)], 2)).toEqual({ do: "create" });
    const full = Array.from({ length: CAP }, (_, i) => live(i + 1));
    expect(decide(full, 3)).toEqual({ do: "refresh" });
    const refused = decide(full, 99);
    expect(refused.do).toBe("refuse");
    expect("why" in refused && refused.why).toContain("#1 eqosys");
  });

  test("a sweep takes down closed or merged PRs and ones past 3 days, and keeps the rest", () => {
    const l = [live(1), live(2), live(3, TTL_MS + 1), live(4)];
    expect(stale(l, { 1: "OPEN", 2: "MERGED", 3: "OPEN", 4: "CLOSED" }, at).map((x) => x.pr)).toEqual([2, 3, 4]);
  });

  test("the URL is the last one a deploy prints, colours and punctuation off", () => {
    const out = "see https://alchemy.run/docs\n\x1b[32mhttps://eqosys-pr-12.me.workers.dev\x1b[0m.\n";
    expect(lastUrl(out)).toBe("https://eqosys-pr-12.me.workers.dev");
    expect(lastUrl("no url")).toBeNull();
  });

  test("the comment carries the marker, so the next run edits it in place", () => {
    expect(commentBody(live(7), "").startsWith(MARK)).toBe(true);
    expect(commentBody(null, "The PR is merged.").startsWith(MARK)).toBe(true);
  });
});
