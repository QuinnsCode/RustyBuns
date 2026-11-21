// Two friends in one room (together-kit.ts), and a contract told by someone the room can't vouch for (#3800): it goes
// nowhere until a friend the room trusts walks up beside them.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath } from "../../../scripts/chrome.ts";
import { noise, settle, stride, together, until } from "./together-kit.ts";

setDefaultTimeout(240_000);

test.skipIf(!chromePath())("a contract read after a jump goes nowhere until a friend the room trusts walks up", () => together(async ({ open }) => {
  const a = await open("hodag");
  const b = await open("squonk");
  // Both by the campfire 559 m from region 1's other board. A jumps straight onto the board's town door (no road takes you there
  // that fast, so the room stops vouching for A), walks in and reads the board: the contract goes nowhere. B runs over to A, who stands
  // still; once B is beside A the room trusts A again, and A's page tells the contract. B runs at 7.5 m/s by the clock, under
  // the room's RUN_MPS (8, party.ts): any faster and B is a jump too, and nobody vouches for anybody (a minute's run).
  const other = "1.20002.6206", stage = `mythicMasters.journey.state()?.hunts?.["${other}"] ?? null`;
  // No wild one jumps either of them on the way: a lost fight opens the Book and holds the page's poses back.
  await Promise.all([a.eval(`(async () => { mythicMasters.world.peace(true); mythicMasters.world.teleport(20185, 5674); ${settle} })()`), b.eval(`(async () => { mythicMasters.world.peace(true); mythicMasters.world.teleport(20165, 5674); ${settle} })()`)]);
  await a.eval(`(async () => { mythicMasters.world.teleport(20002, 6206); ${settle} mythicMasters.world.standInside(4.6, -7.9); ${settle} })()`);
  await until(() => a.eval<number | null>(stage), (s) => s === 0);
  await Bun.sleep(1000);
  expect(await b.eval<number | null>(stage)).toBeNull();
  await stride(b, 20002, 6206, 15);
  await until(() => b.eval<number | null>(stage), (s) => s === 0);
  expect(noise(a, b)).toEqual([]);
}));
