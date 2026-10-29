import { expect, test } from "bun:test";
import { Train } from "../src/train.ts";

// The journey of two PRs that pass alone but break together runs through the office: apps/agent-office/test/train.test.ts.
import { fakeGitHub } from "./fake-gh.ts";

function trainOn(fake: ReturnType<typeof fakeGitHub>) {
  const told: [number, string][] = [];
  const train = new Train({ gh: fake.gh, tell: (pr, text) => (told.push([pr, text]), true) });
  const drive = async (max = 30) => { for (let i = 0; i < max && train.moving; i++) await train.step(); };
  return { train, told, drive };
}

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
