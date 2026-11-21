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

test("\"how do I use this?\" is answered from the README's Play it or Use it section, or the brief says it's missing", () => {
  const root = mkdtempSync(join(tmpdir(), "brief-"));
  const write = (app: string, md: string) => { mkdirSync(join(root, "apps", app), { recursive: true }); writeFileSync(join(root, "apps", app, "README.md"), md); };
  write("golf", "# Golf\n\n> **What it proves:** wind data in a game.\n\n## Play it\n\n**Play:** https://golf.example\n**Controls:** Desktop: drag · Phone: swipe\n\n## Run it\n\nbun run dev\n");
  write("crm", "# CRM\n\nA CRM your agents can use, for a real place of business.\n\n## Use it\n\n**How to use:** open it and add a contact.\n\n**Account:** needed.\n\nThe long story of how the CRM was built.\n");
  write("bare", "# Bare\n\nA game with only build notes, no word on how to play.\n\n## Run it\n");
  const golf = brief("golf", root);
  expect(golf).toContain("Play it:\n**Play:** https://golf.example\n**Controls:** Desktop: drag · Phone: swipe");
  expect(golf).not.toContain("bun run dev");
  const crm = brief("crm", root);
  expect(crm).toContain("Use it:\n**How to use:** open it and add a contact.\n\n**Account:** needed.");
  expect(crm).not.toContain("long story");
  expect(brief("bare", root)).toContain("no \"## Play it\" or \"## Use it\"");
});
