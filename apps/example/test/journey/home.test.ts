// A journey test for `rustybuns test` (#4799): it runs against the app `rustybuns test` started
// (`rustybuns dev` by default, a throwaway stage with --stage) and reads its address from RUSTYBUNS_TEST_URL.
// A plain `bun test` has no app to talk to, so it skips.
import { test, expect } from "bun:test";

const url = process.env.RUSTYBUNS_TEST_URL;

test.skipIf(!url)("the home page loads", async () => {
  const r = await fetch(url!);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type") ?? "").toContain("text/html");
});
