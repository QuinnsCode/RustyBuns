import { expect, test } from "bun:test";
import { loadZoneData, ZONES } from "../src/zones/zone.ts";
import { Room, TICK_MS } from "../src/room.ts";
import { fromSearch, roleOf, toSearch } from "../src/scenario.ts";

// Not Zion's: bun shares module state across test files, and hunt.test.ts needs that ground still unfetched.
const here = ZONES.filter((z) => z.id !== "zion");
await Promise.all(here.map((z) => loadZoneData(z.id)));

// The link a MANUAL RUN gives the owner: one person lands in a round as the hider or the seeker, against bots.
test.each(["hider", "seeker"] as const)("?role=%s lands the player in round one in that role", (role) => {
  const s = fromSearch(`?role=${role}&bots=4&level=hard`)!;
  expect([s.bots, s.level, toSearch(s)]).toEqual([4, "hard", `?role=${role}&bots=4&level=hard`]);
  const g = new Room(11).game;
  let now = 1_000_000;
  g.join("you", "You", now, { host: true });
  g.handle("you", { t: "settings", zone: here[0].id }, now);
  g.firstRole = { id: "you", role: roleOf(s) };
  for (let i = 0; i < s.bots; i++) g.handle("you", { t: "bot", level: s.level }, now);
  g.handle("you", { t: "start" }, now);
  g.tick(now += TICK_MS);
  expect(g.phase).toBe("drop");
  expect(g.view("you", now).round?.you?.role).toBe(role === "seeker" ? "ranger" : "camper");
});

test("no role, or a live room, is no scenario; nonsense is fitted", () => {
  expect(fromSearch("")).toBeNull();
  expect(fromSearch("?room=ABCD&role=seeker")).toBeNull();
  const s = fromSearch("?role=banana&bots=99&level=x")!;
  expect([s.role, s.bots, s.level]).toEqual(["hider", 7, "normal"]);
});
