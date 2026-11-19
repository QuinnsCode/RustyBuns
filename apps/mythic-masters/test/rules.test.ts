import { expect, test } from "bun:test";
import { join } from "node:path";
import { bindBelow, INK, MAULED, OWN_MAX, PARTY_FIRST, PARTY_MAX, SECTIONS, START_LEVEL, toNext } from "../src/journey.ts";
import { RULES, rulesMd } from "../src/rules.ts";
import { ROAM_WEIGHT, TIER_LEVEL } from "../src/tiers.ts";
import { FORAGE_MEND } from "../src/world/nature.ts";
import { WILD_EVERY } from "../src/world/world.ts";

test("the rules sheet: twenty rules whose numbers are the code's own, each one said in its words, and docs/RULES.md written from it", async () => {
  expect(RULES.map((r) => r.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  const numbers = (n: number) => RULES[n - 1]!.numbers;
  expect(numbers(3)).toMatchObject({ START_LEVEL });
  expect(numbers(4)["toNext per level"]).toBe(toNext(1));
  expect(numbers(5)["FORAGE_MEND %"]).toBe(FORAGE_MEND * 100);
  expect(numbers(7)).toMatchObject({ INK, "bindBelow(false) %": bindBelow(false) * 100, "bindBelow(true) %": bindBelow(true) * 100 });
  expect(numbers(8)).toMatchObject({ PARTY_FIRST, PARTY_MAX, OWN_MAX });
  expect(numbers(9)).toMatchObject({ SECTIONS });
  expect(numbers(11)).toMatchObject({ "ROAM_WEIGHT.rare": ROAM_WEIGHT.rare, "TIER_LEVEL.mythic": TIER_LEVEL.mythic });
  expect(numbers(12)["MAULED %"]).toBe(MAULED * 100);
  expect(numbers(19)).toMatchObject({ WILD_EVERY });
  // a number a rule reads is a number its words say
  for (const r of RULES) for (const [name, v] of Object.entries(r.numbers)) expect(`${r.n} ${name}: ${r.says.join(" ").includes(String(v))}`).toBe(`${r.n} ${name}: true`);
  // the page is the sheet: `bun run rules` after a change
  expect(await Bun.file(join(import.meta.dir, "../docs/RULES.md")).text()).toBe(rulesMd());
});
