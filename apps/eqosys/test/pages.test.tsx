import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Login } from "../src/app/Login.tsx";
import { Privacy } from "../src/app/pages.tsx";
import { CONTACT_EMAIL } from "@rustybuns/util/report";

test("a page's ?e= shows its own words, and a name off Object's prototype shows nothing rather than failing the page", () => {
  for (const [e, shown] of [["bad", true], ["__proto__", false], ["constructor", false], ["toString", false]] as const) {
    const html = renderToStaticMarkup(<Login ask={null} me={null} social={[]} t0={0} error={e} />);
    expect(html.includes('role="alert"')).toBe(shown);
  }
});

test("someone who can't sign in, or wants to ask in private, finds the address to write to on the sign-in and privacy pages", () => {
  for (const page of [<Login ask={null} me={null} social={[]} t0={0} />, <Privacy />]) {
    const mail = [...renderToStaticMarkup(page).matchAll(/href="mailto:([^"?]+)\?subject=[^"]+"/g)].map((m) => m[1]);
    expect(mail).toContain(CONTACT_EMAIL);
  }
});
