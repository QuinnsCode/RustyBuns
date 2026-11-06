// scripts/move-resources.ts's parseAuthToken, which release.ts and fresh-check.ts read wrangler's login with.
// The rest of that script was the one-time codesplitters rename (#825), done on 2026-10-11.

import { describe, expect, test } from "bun:test";
import { parseAuthToken } from "../scripts/move-resources.ts";

const TOKEN = "Xq3v8mN0pLkJ7hGfDsA1zYwTr5eB2cVuI9oP4n6M";

describe("parseAuthToken", () => {
  test("reads `wrangler auth token --json`: JSON.stringify({ type, token }, null, 2), no banner", () => {
    expect(parseAuthToken(JSON.stringify({ type: "oauth", token: TOKEN }, null, 2) + "\n")).toBe(TOKEN);
  });
  test("not logged in: wrangler's error is no token", () => {
    expect(parseAuthToken("✘ [ERROR] Not logged in. Please run `wrangler login` to authenticate.\n")).toBeNull();
    expect(parseAuthToken("")).toBeNull();
  });
});
