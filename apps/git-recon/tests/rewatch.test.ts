import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60_000);
import { LEVELS } from "../src/levels/levels.ts";
import { rollTake, SET_PIECES, stageTake, type SetPieceId } from "../src/sim/rewatch.ts";

const dt = 1 / 30;
/** A page's frames, uneven: some fall between two of the sim's ticks, as the first one after a level loads often does. */
const frames = (i: number) => (i % 4 === 0 ? 0.004 : dt);

test.each(Object.keys(SET_PIECES) as SetPieceId[])("the %s restaged on its level plays to its end under the take's own input", (id) => {
  const def = LEVELS.find((l) => l.id === SET_PIECES[id].level)!;
  const take = stageTake(id, def);
  const seen = new Set<string>(), finished: string[] = [];
  for (let t = 0, i = 0; t < 90 && !take.done; t += frames(i++)) {
    rollTake(take, frames(i));
    if (take.director.beat) seen.add(take.director.beat.id);
    if (take.director.finished) finished.push(take.director.finished);
  }
  expect(take.done).toBe(true);
  // Only this beat played, and the director says it was seen to its end: the page remembers it the same way in a level.
  expect([...seen]).toEqual([id === "dropzone" ? "insertion" : id]);
  expect(finished).toContain(id);
  expect(take.game.you().alive).toBe(true);
});

test("a beat cut short isn't seen: going down mid-strike finishes nothing", () => {
  const def = LEVELS.find((l) => l.id === "kitchen")!;
  const take = stageTake("incoming", def);
  for (let t = 0; t < 3 && take.director.beat?.phase !== "thrown"; t += dt) rollTake(take, dt);
  expect(take.director.beat?.id).toBe("incoming");
  const you = take.game.you();
  take.game.hurt(you, you.hp + you.shield + 1, take.game.me);
  take.director.step(dt, take.game.events);
  expect(take.director.beat).toBeNull();
  expect(take.director.finished).toBeNull();
});
