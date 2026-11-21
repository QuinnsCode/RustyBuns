import { expect, setDefaultTimeout, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Login, WELCOME } from "../src/app/Login.tsx";
import { Privacy } from "../src/app/pages.tsx";
import { playOf } from "../src/apps.ts";
import { askOf, opensOn } from "../src/handle.ts";
import { CONTACT_EMAIL } from "@rustybuns/util/report";
import { asks, boot, PARK } from "./kit.ts";

setDefaultTimeout(30_000);

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

test("a stranger's first sign-in page says what eqosys is and opens games with no account; a game's sign-in and a known browser go straight to the form", async () => {
  const { conf } = await boot();
  const park = await asks("park-hide-seek", PARK);
  const ask = await askOf((k) => park.form[k as keyof typeof park.form], conf);
  if (!ask || ask === "bad") throw new Error("the park's ask should be good");
  /** Where the page's links and forms go, read the way a browser would. */
  const page = async (props: Partial<Parameters<typeof Login>[0]>) => {
    const links: string[] = [], forms: string[] = [];
    await new HTMLRewriter().on("a[href]", { element: (e) => { links.push(e.getAttribute("href")!); } })
      .on("form[action]", { element: (e) => { forms.push(e.getAttribute("action")!); } })
      .transform(new Response(renderToStaticMarkup(<Login ask={null} me={null} social={[]} t0={0} {...props} />))).text();
    return { links, forms };
  };
  const games = WELCOME.map((a) => playOf(a)!);
  expect(games.length).toBeGreaterThanOrEqual(3);

  const first = await page({ opens: opensOn({ known: false, friend: false }) });
  expect(first.links).toEqual(expect.arrayContaining([...games, "#join"]));
  expect(first.forms).toContain("/do/signup");

  for (const props of [{ ask, opens: opensOn({ known: false, friend: false }) }, { opens: opensOn({ known: true, friend: false }) }]) {
    const { links, forms } = await page(props);
    expect(links.filter((l) => games.includes(l) || l === "#join")).toEqual([]);
    expect(forms).toEqual(expect.arrayContaining(["/do/signin", "/do/signup"]));
  }
});
