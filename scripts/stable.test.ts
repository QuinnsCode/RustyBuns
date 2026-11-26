import { expect, test } from "bun:test";
import { nextVersion, pickStable, releaseNotes, releaseVersion } from "./stable.ts";
import type { Tested } from "./rings.ts";

const [a, b, c, d, e, f] = ["a", "b", "c", "d", "e", "f"].map((x) => x.repeat(40)) as [string, string, string, string, string, string];
const G = "SUCCESS", R = "FAILURE";

// History is newest first; commits the daily ring never ran (no state) sit between the ones it did.
test.each<[string, Tested[], string | undefined]>([
  ["three green days: the oldest of them has soaked", [{ sha: a, state: G }, { sha: b }, { sha: c, state: G }, { sha: d, state: G }, { sha: e, state: G }], d],
  ["a red yesterday: the last three greens before it", [{ sha: a, state: G }, { sha: b, state: R }, { sha: c, state: G }, { sha: d, state: G }, { sha: e, state: G }, { sha: f, state: G }], e],
  ["only two greens so far", [{ sha: a, state: G }, { sha: b, state: G }, { sha: c }], undefined],
  ["the daily ring hasn't run", [{ sha: a }, { sha: b }], undefined],
])("pickStable: %s", (_, history, want) => {
  expect(pickStable(history)).toBe(want);
});

test("nextVersion bumps the patch", () => {
  expect(nextVersion("0.1.11")).toBe("0.1.12");
  expect(() => nextVersion("1.0.0-beta")).toThrow();
});

// The version comes from the tag now (#4528), so main's packages trail the tags.
test.each<[string, string | undefined, string, string]>([
  ["main's packages trail the last tag", "v0.1.12", "0.1.12", "0.1.13"],
  ["main's packages trail by more than one release", "v0.1.14", "0.1.12", "0.1.15"],
  ["main's packages already name the next one", "v0.1.11", "0.1.12", "0.1.12"],
  ["a minor bump on main", "v0.1.11", "0.2.0", "0.2.0"],
  ["no tag yet", undefined, "0.1.0", "0.1.0"],
])("releaseVersion: %s", (_, tag, packages, want) => {
  expect(releaseVersion(tag, packages)).toBe(want);
});

test("releaseNotes groups squash titles by area without their #numbers, and counts what it cut", () => {
  const notes = releaseNotes(["eqosys home: spaces page (#3998)", "Mythic Masters: ledge hang (Part of #3300) (#3333)", "eqosys: login sky (Closes #2990, Closes #2991) (#3001)", "Fix a typo"], 3);
  expect(notes).toBe("**eqosys**\n- login sky\n\n**eqosys home**\n- spaces page\n\n**Mythic Masters**\n- ledge hang\n\nAnd 1 more (see the compare link).");
});
