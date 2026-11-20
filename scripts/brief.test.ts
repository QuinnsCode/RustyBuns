import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief, index } from "./brief.ts";

test("an app's brief comes from its own files", () => {
  const root = mkdtempSync(join(tmpdir(), "brief-"));
  const app = join(root, "apps", "skate-tech-park");
  mkdirSync(join(app, "test"), { recursive: true });
  writeFileSync(join(app, "README.md"), `# Skate\n\n<img src="x.png">\n\n> **What it proves:** a [pure](x.md) sim runs in the page and in tests.\n\n## Run it\n\n## How it's built\n`);
  writeFileSync(join(app, "TRICKS.md"), "# The trick audit\n\nbody");
  writeFileSync(join(app, "AGENTS.md"), "# A note\n\nUnder the PolyForm Noncommercial License.");
  writeFileSync(join(app, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "bun test" } }));
  writeFileSync(join(app, "test", "ride.test.ts"), "");
  const out = brief("skate-tech-park", root);
  expect(out).toContain("What it proves: a pure sim runs in the page and in tests.");
  expect(out).toContain("README sections: Run it · How it's built");
  expect(out).toContain("apps/skate-tech-park/AGENTS.md: A note");
  expect(out).toContain("apps/skate-tech-park/TRICKS.md: The trick audit");
  expect(out).toContain("License:");
  expect(out).toContain("Scripts (bun run …, in apps/skate-tech-park): dev, test");
  expect(out).toContain("cd apps/skate-tech-park && bun test test/ride.test.ts");
  expect(out).toContain("bun run probe skate-tech-park (reads skateTechPark.state())");
  expect(index(root)).toStartWith("skate-tech-park");
  expect(() => brief("nope", root)).toThrow("no apps/nope");
});
