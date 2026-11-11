import { expect, test } from "bun:test";
import { inOrder } from "./readme-apps.ts";

test("a group lists eqosys's apps in eqosys's order, then the ones eqosys doesn't know as they were", () => {
  const app = (id: string) => ({ app: id, name: id, line: "" });
  const groups = [{ title: "Games", intro: "", apps: ["fixture", "two-fronts", "sample", "git-recon", "park-hide-seek"].map(app) }];
  const [games] = inOrder(groups, ["park-hide-seek", "git-recon", "skate-tech-park", "two-fronts"]);
  expect(games!.apps.map((e) => e.app)).toEqual(["park-hide-seek", "git-recon", "two-fronts", "fixture", "sample"]);
});
