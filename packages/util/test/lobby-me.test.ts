// Which member a lobby panel takes for the person looking (notes/SECURITY_AUDIT.md round 18c).
import { expect, test } from "bun:test";
import { meIn } from "../src/lobby.ts";

test("a namesake listed first is not you", () => {
  const members = [{ id: "u_mallory", name: "Ada" }, { id: "u_ada", name: "Ada" }];
  expect(meIn(members, "u_ada", "Ada")?.id).toBe("u_ada");
});
