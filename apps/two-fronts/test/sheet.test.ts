import { expect, test } from "bun:test";
import { sheet, type Sheet, type SheetIn } from "../src/war/sheet.ts";
import { presetDeployment } from "../src/war/fleet.ts";
import { handIn, newTable } from "../src/war/table.ts";
import { buildSpaceSpec, type Campaign } from "../src/war/rules.ts";

// A short war as the Marines against the AI, fleets placed: turn 1, orders open.
const start = () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "short", 7, true);
  const placed = handIn(t, "marines", { faction: "marines", orders: [], deployment: presetDeployment(t.campaign, "marines", "line") });
  if (!placed.ok) throw new Error(placed.error);
  return placed.table.campaign;
};
const at = (c: Campaign, x: Partial<SheetIn>) => sheet({ c, me: "marines", phase: 1, waiting: ["marines"], mode: "ai", ...x });

// Each state a seat sits in: the sheet's title, who the chip says we wait on, and the big button.
test("one sheet per phase and per wait, each with one button", () => {
  const c = start();
  // A space hero battle over Kessa, the Marines attacking, the hero on one side or the other.
  const spaceHero = (heroOf: "marines" | "wooka"): Campaign => ({ ...c, pending: { kind: "space", system: "kessa", landings: [], spec: buildSpaceSpec(c, "kessa", "wooka", 1, heroOf) } });
  const rows: [string, Sheet, string, Sheet["wait"], string, boolean][] = [
    ["muster, nothing picked", at(c, {}), "Muster: pick a world", "you", "Next phase", false],
    ["fleets from a world", at(c, { phase: 3, selected: "Lumen" }), "Send ships from Lumen", "you", "Next phase", false],
    ["battles, no hero", at(c, { phase: 5 }), "This turn's fights", "you", "Next turn", false],
    ["battles, hero picked", at(c, { phase: 5, heroAt: "Kessa" }), "This turn's fights", "you", "Fight at Kessa", false],
    ["battles online", at(c, { phase: 5, mode: "online" }), "This turn's fights", "you", "Send orders", false],
    ["orders in, online", at(c, { mode: "online", waiting: ["wooka"] }), "Your orders are in", "them", "Orders in", true],
    ["answering attacks", at({ ...c, attacks: [] }, { retreats: 1 }), "Answer the attacks", "you", "Confirm retreats", false],
    ["they answer attacks", at({ ...c, attacks: [] }, { waiting: ["wooka"] }), "Your orders are in", "them", "Orders in", true],
    ["deploying", at({ ...c, deploying: ["marines"] }, {}), "Move what you took", "you", "Stay put", false],
    ["their hero battle", at(spaceHero("wooka"), { waiting: ["wooka"] }), "Hero battle: Kessa orbit", "them", "Hero battle", true],
    ["our hero battle", at(spaceHero("marines"), {}), "Your hero battle: Kessa orbit", "you", "Fight at Kessa", false],
    ["busy", at(c, { busy: true }), "Muster: pick a world", "you", "Next phase", true],
    ["war over", at({ ...c, winner: "wooka", turn: 9 }, { waiting: [] }), "The war is over", "none", "New campaign", false],
  ];
  for (const [name, s, title, wait, label, disabled] of rows) {
    expect({ name, title: s.title, wait: s.wait, label: s.next.label, disabled: s.next.disabled }).toEqual({ name, title, wait, label, disabled });
  }
  expect(at(c, { phase: 2 }).next.small).toBe("Fleets");
  expect(at(c, { mode: "online", waiting: ["wooka"] }).chip).toBe("Waiting on the Wooka");
});
