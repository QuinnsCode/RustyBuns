import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engine, find } from "./engine.ts";

const put = (root: string, file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};

test("each part names the apps that import it, and a part nobody imports has no users", () => {
  const root = mkdtempSync(join(tmpdir(), "engine-"));
  put(root, "packages/dial/package.json", JSON.stringify({ name: "@rustybuns/dial", description: "One quality dial." }));
  put(root, "packages/dial/src/index.ts", "export const dial = 1;\n");
  put(root, "packages/spare/package.json", JSON.stringify({ name: "@rustybuns/spare", description: "Nobody needs this yet." }));
  put(root, "packages/spare/src/index.ts", "export const spare = 1;\n");
  put(root, "apps/kart/package.json", "{}");
  put(root, "apps/kart/src/main.ts", 'import { dial } from "@rustybuns/dial";\nimport { x } from "@rustybuns/dial/sub";\n');
  put(root, "apps/kart/scripts/bake.ts", 'import { dial } from "@rustybuns/dial";\n');
  // A test, or a copy in node_modules, isn't a user.
  put(root, "apps/kart/test/main.test.ts", 'import { spare } from "@rustybuns/spare";\n');
  put(root, "apps/kart/node_modules/x/index.ts", 'import { spare } from "@rustybuns/spare";\n');

  const parts = engine(root);
  expect(parts.map((p) => p.name)).toEqual(["dial", "spare"]);
  const dial = find(parts, "@rustybuns/dial/sub");
  expect(dial?.doc).toBe("One quality dial.");
  expect(dial?.users).toEqual([{ app: "kart", files: 2, imports: ["@rustybuns/dial", "@rustybuns/dial/sub"] }]);
  expect(find(parts, "spare")?.users).toEqual([]);
});
