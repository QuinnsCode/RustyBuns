// What one job costs an AI through each door, in estimated tokens (session.ts, counted by scripts/mcp-session.ts):
// what it reads (the tool list, skill or prompt once, and every reply), what it writes (each call's arguments) and how
// many calls it makes. No network, no key. The default door (the fewest tokens; within 5%, the fewest calls) must stay
// within tokens.json's budget. The budget only goes down.
import { expect, test } from "bun:test";
import { int, obj, str } from "@rustybuns/util/guard";
import { measure, table, TALLER } from "./session.ts";

const { door, budget } = obj({ door: str(20), budget: int(1, 1_000_000) })(await Bun.file(new URL("./tokens.json", import.meta.url)).json());

test("each door builds the village, and the default door is the cheapest and within its budget", async () => {
  const rows = await measure();
  console.log(table(rows));
  // A refused call would make a cheap session that built nothing.
  expect(rows.flatMap((r) => r.refused)).toEqual([]);
  expect(rows.map((r) => r.world)).toEqual(rows.map(() => TALLER));
  const least = Math.min(...rows.map((r) => r.total));
  const [winner] = rows.filter((r) => r.total <= least * 1.05).sort((a, b) => a.trips - b.trips || a.total - b.total);
  expect(winner!.door).toBe(door);
  expect(winner!.total).toBeLessThanOrEqual(budget);
});
