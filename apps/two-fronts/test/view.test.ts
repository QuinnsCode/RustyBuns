import { expect, test } from "bun:test";
import { View } from "../src/edge/view.ts";
import { fogged } from "../src/war/rules.ts";
import { newTable, waitingOn } from "../src/war/table.ts";

// What the campaign's object sends a seat is what the page's guard keeps, field for field.
test("a seat's view survives the page's guard, in the setup and the first turn", () => {
  for (const setup of [true, false]) {
    const t = newTable({ marines: "human", wooka: "human" }, "short", 7, setup);
    const sent = JSON.parse(JSON.stringify({ seat: "wooka", seats: t.seats, campaign: fogged(t.campaign, "wooka"), waiting: waitingOn(t), handedIn: false, vote: null }));
    expect(View(sent)).toEqual(sent);
  }
});

test("a reply of the wrong shape is refused, naming the field", () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "intro", 1);
  const bad = { seat: "marines", seats: t.seats, campaign: { ...t.campaign, systems: "none" }, waiting: [], handedIn: false, vote: null };
  expect(() => View(bad)).toThrow(/campaign\.systems/);
});
