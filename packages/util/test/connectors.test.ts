import { expect, test } from "bun:test";
import { Bad } from "../src/guard.ts";
import { Connector, CONNECTOR_TYPES, CONNECTORS, End, fits } from "../src/connectors.ts";

test("every connector passes its own guard, under its own type", () => {
  for (const t of CONNECTOR_TYPES) expect(Connector(CONNECTORS[t])).toEqual(CONNECTORS[t]);
  expect(() => End({ type: "speakon", gender: "male" })).toThrow(Bad);
});

test.each([
  // plug, socket, refused?
  [{ type: "nl4", gender: "none" }, { type: "nl4", gender: "none" }, null],
  [{ type: "nl4", gender: "none" }, { type: "nl8", gender: "none" }, null],
  [{ type: "xlr3", gender: "male" }, { type: "xlr3", gender: "female" }, null],
  [{ type: "xlr3", gender: "male" }, { type: "combo", gender: "female" }, null],
  [{ type: "trs", gender: "male" }, { type: "combo", gender: "female" }, null],
  [{ type: "xlr3", gender: "female" }, { type: "xlr3", gender: "female" }, "turn the cable round"],
  [{ type: "nl4", gender: "none" }, { type: "xlr3", gender: "female" }, "speaker line"],
  [{ type: "xlr3", gender: "male" }, { type: "powercon-blue", gender: "none" }, "mains power"],
  [{ type: "powercon-grey", gender: "none" }, { type: "powercon-blue", gender: "none" }, "blue is power in"],
] as const)("%o into %o", (plug, socket, why) => {
  const said = fits(End(plug), End(socket));
  if (why === null) expect(said).toBeNull();
  else expect(said).toContain(why);
});
