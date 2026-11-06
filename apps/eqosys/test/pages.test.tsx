import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Login } from "../src/app/Login.tsx";

test("a page's ?e= shows its own words, and a name off Object's prototype shows nothing rather than failing the page", () => {
  for (const [e, shown] of [["bad", true], ["__proto__", false], ["constructor", false], ["toString", false]] as const) {
    const html = renderToStaticMarkup(<Login ask={null} me={null} social={[]} t0={0} error={e} />);
    expect(html.includes('role="alert"')).toBe(shown);
  }
});
