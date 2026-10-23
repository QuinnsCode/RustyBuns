import { expect, test } from "bun:test";
import { defineConfig, type EnvOf } from "../src/config.ts";

const config = defineConfig({
  name: "shop",
  worker: { main: "src/index.ts", compatibilityDate: "2026-01-01", compatibilityFlags: [] },
  bindings: {
    DB: { type: "d1", databaseName: "shop-db" },
    NAME: { type: "var", value: "x" },
    KEY: { type: "secret" },
    HOOK: { type: "secret", optional: true },
  },
  targets: { edge: { provider: "cloudflare" } },
});

type Bindings = EnvOf<typeof config, { d1: { prepare(sql: string): unknown } }>;

// Never run: `bun run typecheck` is the assertion, and a ts-expect-error that stops erroring fails it.
function typed(b: Bindings) {
  const name: string = b.NAME;
  const key: string = b.KEY;
  const hook: string | undefined = b.HOOK;
  b.DB.prepare("select 1");
  // @ts-expect-error not a binding in the config
  b.MISSING;
  // @ts-expect-error a secret that may be absent isn't always a string
  const hookString: string = b.HOOK;
  // @ts-expect-error a var is a string, not a database
  b.NAME.prepare;
  return [name, key, hook, hookString];
}

test("a config keeps its bindings as written", () => {
  expect(Object.keys(config.bindings)).toEqual(["DB", "NAME", "KEY", "HOOK"]);
  expect(typeof typed).toBe("function");
});
