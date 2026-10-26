import { expect, test } from "bun:test";
import { actingAs, queuedByToken } from "../src/identity.ts";
import { byToken } from "../src/tokens.ts";

// limits.ts replays a queued request to the app as the person (actingAs, so via "job");
// when an API token queued it, the gates that refuse tokens must still refuse it.
test("a replayed job queued by a token still counts as the token's", () => {
  const replay = (queued: boolean) => {
    const r = new Request("http://codesplitter.local/api/repos/o/r/deploy", { method: "POST" });
    actingAs.set(r, "o");
    if (queued) queuedByToken.add(r);
    return r;
  };
  expect(byToken(replay(true))).toBe(true);
  expect(byToken(replay(false))).toBe(false);
});
