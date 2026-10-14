// The security model in REFERENCE.md can't drift from the code: every promise cites a test that
// exists under that name, and every DELETE the API offers is in the destruction table.
import { describe, expect, test } from "bun:test";
import { citedFiles, deleteRoutes, hasTest, promises, section } from "./trust-promises.ts";

describe("the security model in REFERENCE.md", () => {
  const list = promises();

  test("has promises under each of its four parts, and every one cites a test", () => {
    const parts = new Set(list.map((p) => p.part));
    expect([...parts]).toEqual(["Your code", "Your app", "Your provisioning", "Your destruction"]);
    for (const p of list) {
      expect(p.text.length).toBeGreaterThan(10);
      expect(p.cites.length).toBeGreaterThan(0);
    }
    expect(list.length).toBeGreaterThan(40);
  });

  test("every cited test is a real test, by that exact name", () => {
    const missing = list.flatMap((p) => p.cites.filter((c) => hasTest(c) !== true).map((c) => `${c.file}: "${c.name}" (for: ${p.text})`));
    expect(missing).toEqual([]);
    expect(citedFiles(list).length).toBeGreaterThan(10);
  });

  test("every DELETE route in the API is in the destruction table, and so is stopping an agent", () => {
    const table = section();
    const routes = deleteRoutes();
    expect(routes.length).toBeGreaterThan(10);
    const absent = routes.filter((r) => !table.includes(`\`${r}\``));
    expect(absent).toEqual([]);
    expect(table).toContain("`POST /api/repos/:o/:r/agents/stop`");
  });

  test("the gaps name the open security issues", () => {
    const gaps = section().split("**Not yet.**")[1] ?? "";
    for (const n of ["#1426", "#1427", "#1428", "#1429"]) expect(gaps).toContain(n);
  });
});
