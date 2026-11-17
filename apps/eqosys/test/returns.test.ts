// Where sign-in may send someone back. The page client returns to `location.origin + location.pathname`, and
// Cloudflare serves an app's `jam.html` at `/jam`, so the clean path is the one a live sign-in asks for.
import { expect, test } from "bun:test";
import { APPS, returnTo } from "../src/apps.ts";

const fmDaw = APPS.find((a) => a.id === "fm-daw")!;
const live = fmDaw.origins[0];

test.each([
  [`${live}/jam`, true],
  [`${live}/jam.html`, true],
  [`${live}/`, true],
  ["https://elsewhere.example/jam", false],
])("fm-daw sign-in returns to %s: %p", (url, ok) => {
  expect(returnTo(fmDaw, url) !== null).toBe(ok);
});
