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
