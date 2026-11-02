import { expect, test } from "bun:test";
import { kitClass } from "../src/ui/kit.ts";

// A button stub: `matches` tests the class list the way the kit's selector does, enough to tell which look a button gets.
const button = (cls: string, attrs: string[] = []) => ({
  matches: (sel: string) => sel.split(",").some((s) => { const m = s.trim().match(/^\.([\w-]+)$/); return m ? cls.split(" ").includes(m[1]) : s.includes("gc-") && cls.includes("gc-"); }),
  hasAttribute: (a: string) => attrs.includes(a),
}) as unknown as HTMLButtonElement;

test.each([
  ["plain lobby button", "", [], "ui-btn"],
  ["primary submit", "primary", [], "ui-btn"],
  ["zone or hat pick", "", ["aria-pressed"], "ui-chip"],
  ["the sign-board Play", "play", [], ""],
  ["menu text link", "link", [], ""],
  ["controls panel key", "gc-key", [], ""],
  ["already kit", "ui-btn", [], ""],
])("%s", (_n, cls, attrs, want) => expect(kitClass(button(cls, attrs))).toBe(want));
