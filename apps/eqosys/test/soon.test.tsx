// An app marked coming soon (#4019) is listed on the home and has its page, but nothing on either links into it.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppPage, Home } from "../src/app/pages.tsx";
import { APPS, playOf } from "../src/apps.ts";
import type { Me } from "../src/auth.ts";

const me: Me = { id: "1", email: "a@example.com", name: "Ada" };
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
const home = renderToStaticMarkup(<Home counts={new Map()} t0={0} me={me} mine={undefined} hub={null} everyone={null} unlocks={new Map()} tab="library" />);
const soon = APPS.filter((a) => a.soon);

test("Delayed Reaction is coming soon: on the shelf and its page, with no link onto its site", () => {
  expect(soon.map((a) => a.id)).toContain("delayed-reaction");
  for (const app of soon) {
    expect(playOf(app)).toBeNull();
    expect(home).toContain(`/app/${app.id}`);
    const page = renderToStaticMarkup(<AppPage app={app} mine={undefined} unlocks={new Map()} t0={0} />);
    expect(page).toContain("Coming soon.");
    for (const h of [...hrefs(home), ...hrefs(page)]) for (const o of app.origins) expect(h.startsWith(o)).toBe(false);
  }
  // A ready game still links to its site.
  const ready = APPS.find((a) => !a.soon && a.origins[0])!;
  expect(hrefs(renderToStaticMarkup(<AppPage app={ready} mine={undefined} unlocks={new Map()} t0={0} />))).toContain(ready.origins[0]!);
});
