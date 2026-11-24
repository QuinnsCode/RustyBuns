// The jam room's "What you can do here" (#5395) as a first-time player walks it: in the door, up to the keys, sat
// down, then over to the desk. The card and the key strip follow where you are, and Tab (the instrument's panel) is on
// both the moment you sit. The menu's keys table reads the same list.
import { expect, test } from "bun:test";
import { NOT_YET, card, keysTable, strip } from "../src/studio/actions.ts";
import { newJam, sit, spotOf, stand, walkTo } from "../src/studio/jam.ts";
import { LIVE_ROOM } from "../src/studio/rooms/index.ts";

const keysOf = (xs: { key: string }[]) => xs.map((a) => a.key);

test("the card and the key strip follow you from the door to a seat to the desk", () => {
  const j = newJam(LIVE_ROOM), kind = () => spotOf(j, j.me.seat)?.kind ?? null;

  // Walking in: the strip says sit, plug in your guitar, help and the menu; the card opens on Walking.
  expect(keysOf(strip(kind()))).toEqual(["E", "I", "Space", "V", "?", "Esc"]);
  const walking = card(kind());
  expect(walking[0]).toMatchObject({ where: "walk", here: true });
  expect(walking.filter((g) => g.here)).toHaveLength(1);
  // what isn't here yet is said, with where it is today
  expect(NOT_YET.map((n) => n.what)).toContain("Pedals, amps and cables");

  // Up to the keys and sit: Tab is the first key on the strip, and the card opens on the seated group with Tab in it.
  walkTo(j, 2.6, 1.4);
  expect(sit(j, "keys")).toEqual({ ok: true });
  expect(keysOf(strip(kind()))).toEqual(["Tab", "Z / X", "/", "?", "Space", "Esc"]);
  const seated = card(kind());
  expect(seated[0]).toMatchObject({ where: "seat", here: true });
  expect(seated[0].actions.find((a) => a.key === "Tab")?.does).toContain("panel");
  expect(keysOf(seated[0].actions)).toContain("Z / X");
  expect(keysOf(seated[0].actions)).not.toContain("A to L");   // that's the kit's

  // At the kit: drums, no octave.
  stand(j); walkTo(j, -0.6, 1.4);
  expect(sit(j, "drums")).toEqual({ ok: true });
  expect(keysOf(strip(kind()))).toEqual(["Tab", "?", "Space", "Esc"]);
  expect(keysOf(card(kind())[0].actions)).toEqual(expect.arrayContaining(["Tab", "A to L"]));

  // Into the control room, to the desk: the groove and how you hear the band, and standing up.
  stand(j);
  for (const [x, z] of [[1, -0.8], [3.6, -0.8], [3.6, -2.2], [1.8, -3.2], [0.3, -3.2]]) walkTo(j, x, z);   // through the control room's door, round behind the desk
  expect(sit(j, "desk")).toEqual({ ok: true });
  expect(keysOf(strip(kind()))).toEqual(["P", "C", "?", "Space", "Esc"]);
  expect(card(kind())[0]).toMatchObject({ where: "desk", here: true });

  // The menu's keys table is the same list: every key once, the seated ones marked.
  const table = keysTable();
  expect(table).toContainEqual(["Tab (seated)", "The instrument's panel: patch, EQ, mixer strip, notes"]);
  expect(new Set(table.map(([k]) => k)).size).toBe(table.length);
});
