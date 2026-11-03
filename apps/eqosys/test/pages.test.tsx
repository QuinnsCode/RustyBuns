import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Login } from "../src/app/Login.tsx";

const ask = { app: { id: "park-hide-seek", name: "Park" }, back: new URL("https://park.example/x"), challenge: "c", state: "s" } as never;

// A person who lands on sign-in can always press something: every form on the page ends in a submit button with words on it.
test("the sign-in page offers a labelled submit button on each form, signed out and signed in", () => {
  for (const me of [null, { id: "1", email: "a@example.com", name: "Ada" }] as const) {
    const html = renderToStaticMarkup(<Login ask={ask} me={me as never} social={["apple", "github"]} t0={0} />);
    const forms = html.split("<form").slice(1).map((f) => f.split("</form>")[0]!);
    expect(forms.length).toBeGreaterThan(1);
    for (const f of forms) expect(f).toMatch(/<button[^>]*type="submit"[^>]*>(<svg.*?<\/svg>)?[^<]+<\/button>/);
  }
});

// The library is rows: Featured first, then a row per genre, every app in one; a panel's name opens its page and Play it goes to the app.
test("the library lists Featured then genre rows, and every app has a page link and a way in", async () => {
  const { Home } = await import("../src/app/pages.tsx");
  const { APPS, GENRES } = await import("../src/apps.ts");
  const html = renderToStaticMarkup(<Home counts={new Map()} t0={0} me={{ id: "1", email: "a@example.com", name: "Ada" } as never} mine={undefined} hub={null} everyone={null} unlocks={new Map()} tab="library" />);
  const heads = [...html.matchAll(/<h2>([^<]+)</g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  expect(heads).toEqual(["Featured", ...GENRES.filter((g) => APPS.some((a) => a.genre === g))]);
  for (const a of APPS) {
    expect(html).toContain(`href="/app/${a.id}"`);
    if (a.origins[0]) expect(html).toContain(`class="play" href="${a.origins[0]}"`);
  }
});

test("an app's page shows its long words and Play it", async () => {
  const { AppPage } = await import("../src/app/pages.tsx");
  const { appOf } = await import("../src/apps.ts");
  const html = renderToStaticMarkup(<AppPage app={appOf("park-hide-seek")!} mine={undefined} unlocks={new Map()} t0={0} />);
  expect(html).toContain("Find Sasquatch");
  expect(html).toContain("Play it");
});
