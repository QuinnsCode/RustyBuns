import { expect, test } from "bun:test";
import { Train } from "../src/train.ts";

// The journey of two PRs that pass alone but break together runs through the office: apps/agent-office/test/train.test.ts.
import { fakeGitHub } from "./fake-gh.ts";

function trainOn(fake: ReturnType<typeof fakeGitHub>) {
  const told: [number, string][] = [];
  const said: string[] = [];
  const train = new Train({ gh: fake.gh, tell: (pr, text) => (told.push([pr, text]), true), say: (l) => said.push(l) });
  const drive = async (max = 30) => { for (let i = 0; i < max && train.moving; i++) await train.step(); };
  return { train, told, said, drive };
}

test("an updated branch merges once its required check passes on the new head, not on the quick checks before it", async () => {
  const fake = fakeGitHub({ defines: ["A"], uses: [] });
  fake.open(1, { add: ["B"] });
  fake.open(2, { use: ["B"] });
  fake.open(3, { add: ["C"] });
  const { train, told, said, drive } = trainOn(fake);
  // GitHub also turns one merge away for its own reasons: the train looks again instead of giving up
  fake.refuse(1);
  for (const n of [1, 2, 3]) train.join(n);
  await drive();

  // 2 uses what 1 adds: it only passes once it is updated onto 1, and it merges on that head
  expect([1, 2, 3].map((n) => fake.prs.get(n)!.state)).toEqual(["MERGED", "MERGED", "MERGED"]);
  expect(said.filter((l) => l.includes("refused"))).toHaveLength(1);
  expect(told).toEqual([]);
  expect(fake.mainGreen()).toBe(true);
});

test("a fork's PR is never merged by the train", async () => {
  const fake = fakeGitHub({ defines: [], uses: [] });
  fake.open(1, { add: ["A"] });
  const train = new Train({ gh: { ...fake.gh, pr: async (n) => ({ ...(await fake.gh.pr(n)), fork: true }) } });
  train.join(1);
  await train.step();
  expect([train.spot(1)?.state, fake.prs.get(1)!.state]).toEqual(["pulled", "OPEN"]);
});

test("a check that fails on main too holds the line and tells one worker, then the line moves once main is fixed", async () => {
  const fake = fakeGitHub({ defines: [], uses: ["GONE"] });
  fake.open(1, { add: ["A"] });
  fake.open(2, { add: ["B"] });
  const { train, told, drive } = trainOn(fake);
  train.join(1);
  train.join(2);
  await drive(10);

  expect(train.line().map((s) => s.state)).toEqual(["main-red", "waiting"]);
  expect(told).toHaveLength(1);
  expect(told[0]![1]).toContain("main is red");

  fake.fixMain({ add: ["GONE"] });
  await drive();
  expect([fake.prs.get(1)!.state, fake.prs.get(2)!.state]).toEqual(["MERGED", "MERGED"]);
  expect(told).toHaveLength(1);
  expect(fake.mainGreen()).toBe(true);
});
