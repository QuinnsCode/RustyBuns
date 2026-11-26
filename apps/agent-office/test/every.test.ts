import { expect, test } from "bun:test";
import { every } from "../live/every.ts";

test("a slow round is never doubled, a failed one is logged by name and the loop carries on, stop ends it", async () => {
  const warned: string[] = [];
  let rounds = 0, running = 0, most = 0;
  const stop = every(10, async () => {
    rounds++;
    running++;
    most = Math.max(most, running);
    if (rounds === 2) { running--; throw new Error("gh timed out"); }
    await Bun.sleep(35); // longer than three periods
    running--;
  }, { name: "ci loop", first: 0, warn: (l) => warned.push(l) });
  expect(rounds).toBe(1); // first: 0 runs before every returns
  await Bun.sleep(150);
  stop();
  const at = rounds;
  await Bun.sleep(60);
  expect(rounds).toBe(at);
  expect(rounds).toBeGreaterThan(2);
  expect(most).toBe(1);
  expect(warned).toEqual(["[rb] ci loop: gh timed out"]);
});
