import { expect, test } from "bun:test";
import { configReference } from "./config-reference.ts";
import { type Source, worktree } from "./lib.ts";

const from = (text: string): Source => ({ version: "t", ref: "t", read: () => text });

test("every RustyBunsConfig key in config.ts is on the page", () => {
  const md = configReference(worktree())!.md;
  expect(md).toContain("## RustyBunsConfig");
  expect(md).toContain("| `worker.compatibilityDate` | `string` |");
  expect(md).toContain("## Binding: d1");
});

test("keys, nesting, optional marks, docs and defaults come from the types", () => {
  const md = configReference(from(`
    export interface RustyBunsConfig {
      name: string;
      /** The Workers side. @default 1 */
      worker?: { /** Entry. */ main?: string };
    }
    export type Binding = /** A KV. */ { type: "kv"; protect?: boolean } | { type: "ai" };
  `))!.md;
  expect(md).toContain("| `name` | `string` |  |");
  expect(md).toContain("| `worker?` | `object` | The Workers side. Default: `1`. |");
  expect(md).toContain("| `worker.main?` | `string` | Entry. |");
  expect(md).toContain("## Binding: kv\n\nA KV.");
  expect(md).toContain("| `protect?` | `boolean` |");
  expect(md).not.toContain("Binding: ai");
});

test("a version without config.ts gets no page", () => {
  expect(configReference({ version: "t", ref: "t", read: () => undefined })).toBeUndefined();
});
