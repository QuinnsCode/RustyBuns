import { expect, test } from "bun:test";
import { EQOSYS } from "../src/board.ts";
import { setCommonHeaders } from "../src/app/headers.ts";

/** The sources the browser lets the page fetch(), read off the header the Worker sends. */
function connectSources(): string[] {
  const response = { headers: new Headers() };
  const run = setCommonHeaders() as (ctx: unknown) => void;
  run({ response, rw: { nonce: "n" } });
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src ")) ?? "";
  return directive.split(/\s+/).slice(1);
}

// The page's eqosys client calls these straight from the browser (src/app/account.ts).
test("the page may reach eqosys for sign-in, posts and votes", () => {
  const allowed = connectSources();
  for (const path of ["/api/exchange", "/q/posts", "/q/reactions"]) {
    expect(allowed).toContain(new URL(path, EQOSYS).origin);
  }
});
