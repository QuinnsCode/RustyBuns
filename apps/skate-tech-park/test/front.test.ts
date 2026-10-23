// The title screen's choices: every one opens an address the game understands, and the old addresses skip the title.
import { expect, test } from "bun:test";
import { chaseOf } from "../src/chaser.ts";
import { carry, joinAddress, launch, PLAYS, showFront } from "../src/front/menu.ts";
import { needsStartScreen } from "../src/levels/index.ts";
import { pveMode, roomCode } from "../src/net/client.ts";

test("multiplayer choices open a room, single player ones never do", () => {
  for (const p of PLAYS.multi) expect(roomCode(launch(p))).not.toBeNull();
  for (const p of PLAYS.single) expect(roomCode(launch(p))).toBeNull();
  expect(chaseOf(launch(PLAYS.single.find((p) => p.id === "chase")!))).toBe("bear");
});

test("a typed code joins that room; nonsense makes a fresh one", () => {
  const free = PLAYS.multi[0]!;
  expect(roomCode(launch(free, "ab12"))).toBe("AB12");
  expect(roomCode(launch(free, "no!"))).not.toBe("NO!");
  expect(joinAddress("ab12")).toBe("?mode=free&room=AB12");
  expect(joinAddress("x")).toBeNull();
});

test("the title shows on a bare address only, and the park picker follows a choice", () => {
  expect(showFront("")).toBe(true);
  expect(showFront("?front")).toBe(true);
  for (const old of ["?level=plaza", "?room=ABCD", "?chase=bear", "?showroom", "?mode=free"]) expect(showFront(old)).toBe(false);
  const chosen = launch(PLAYS.single[0]!);
  expect(showFront(chosen)).toBe(false);
  expect(needsStartScreen(chosen)).toBe(true); // no level yet: pick a park
});

test("picking a park keeps the room, the mode and PvE", () => {
  const q = carry(`?mode=free&room=ABCD&pve=1&weather=rain&real`);
  expect(q.get("room")).toBe("ABCD");
  expect(pveMode(`?${q}`)).toBe(true);
  expect(q.has("weather")).toBe(false);
});
