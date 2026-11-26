// The story bible (content/story.json, docs/STORY.md): every beat names real things in the game, and the docs are
// what `bun run story` writes from it.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkStory } from "../src/story/check.ts";
import { storyMarkdown } from "../scripts/story.ts";
import { storyPage } from "../scripts/story-page.ts";
import { ALL, tapeOf } from "../src/world/poi.ts";
import json from "../content/story.json";

setDefaultTimeout(30_000);

describe("story bible", () => {
  const r = checkStory(json);
  test("no problems", () => expect(r.problems).toEqual([]));
  test("every playable region has all four kinds of beat", () => {
    for (const c of r.coverage) for (const k of ["main", "sub", "side", "unlock"] as const) expect(`${c.name} ${k} ${c.counts[k] > 0}`).toBe(`${c.name} ${k} true`);
  });
  test("a broken anchor, a missing need and a sacred fighter are caught", () => {
    const bad = structuredClone(json);
    const b: { at: string; needs?: string[]; fights?: string[] } = bad.arcs[0]!.beats[1]!;
    b.at = "section:1:40"; b.needs = ["no-such-beat"]; b.fights = ["skinwalker"];
    const p = checkStory(bad).problems.join("\n");
    expect(p).toContain("names nothing in the game");
    expect(p).toContain("no such beat");
    expect(p).toContain("held sacred");
  });
  test("a built beat's tape is found in its section, and one with no unmarked tape left there is caught", () => {
    const reel = ALL.find((p) => p.n === 8 && p.k === 8 && p.kind === "tape" && tapeOf(p).title === "Office reel 8, Texarkana");
    expect(reel && tapeOf(reel).lines[0]).toStartWith("Control: Office reel eight");
    const bad = structuredClone(json);
    bad.arcs.find((a) => a.id === "office-reels")!.beats[0]!.at = "section:5:0"; // Niagara: every tape there is written
    expect(checkStory(bad).problems.join("\n")).toContain("no unmarked tape is left in section:5:0");
  });
  test("docs/STORY.md and docs/story.html are up to date (bun run story)", () => {
    expect(readFileSync(new URL("../docs/STORY.md", import.meta.url), "utf8")).toBe(storyMarkdown(r));
    expect(readFileSync(new URL("../docs/story.html", import.meta.url), "utf8")).toBe(storyPage(r));
  });
});
