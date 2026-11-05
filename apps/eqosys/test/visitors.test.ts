// The Visitors tab, the way a day goes: a person finds the Playground from a search and taps around, a browser opens it and
// never touches it, a headless script and a crawler come by, a page elsewhere tries to fill the Playground's counts, and the
// super admin browses too. Only the person counts as real; the admin isn't counted at all; the tool hands the admin the lot.
import { expect, setDefaultTimeout, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { handle } from "../src/handle.ts";
import { markStaff, tally, visitorsOf } from "../src/visitors.ts";
import { asks, boot, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot();
const PLAY = "https://rustybuns-playground.notryanquinn.workers.dev";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const browser = (ip: string, ua = CHROME) => ({ "cf-connecting-ip": ip, "user-agent": ua, "sec-fetch-mode": "no-cors", "sec-fetch-site": "cross-site" });

const visit = (headers: Record<string, string>, origin: string, body: unknown) =>
  handle(new Request("http://eqosys.local/api/visit", { method: "POST", headers: { ...headers, origin, "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) }), conf);
const page = (headers: Record<string, string>, path = "/login") => tally(conf, new Request(`http://eqosys.local${path}`, { headers }), 200);

test("real people are the browsers that tapped; scripts, crawlers, forged beacons and the admin are told apart", async () => {
  const a = await asks("park-hide-seek", PARK);
  const boss = await call("/do/signup", { form: { ...a.form, name: "Boss", email: "boss@example.com", password: PASSWORD } });

  // A person: the Playground opens (from a search), then they scroll.
  const ada = browser("203.0.113.7");
  expect((await visit(ada, PLAY, { site: "playground", ref: "https://www.google.com/search?q=rusty" }))!.status).toBe(204);
  await visit(ada, PLAY, { site: "playground", engaged: true });
  // Someone opens it and never touches it; a headless browser does the same.
  await visit(browser("203.0.113.8"), PLAY, { site: "playground" });
  await visit(browser("198.51.100.4", CHROME.replace("Chrome/", "HeadlessChrome/")), PLAY, { site: "playground" });
  // A crawler reads eqosys's sign-in page.
  await page({ "cf-connecting-ip": "66.249.66.1", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
  // Another site's page can't post the Playground's counts, and a beacon for no known site is refused.
  expect((await visit(browser("203.0.113.9"), "https://evil.example", { site: "playground", engaged: true }))!.status).toBe(403);
  expect((await visit(browser("203.0.113.9"), PLAY, { nope: 1 }))!.status).toBe(400);
  // The admin opens eqosys (marked theirs), then the Playground, and taps.
  const me = browser("192.0.2.1");
  await markStaff(conf, new Request("http://eqosys.local/", { headers: me }));
  await visit(me, PLAY, { site: "playground" });
  await visit(me, PLAY, { site: "playground", engaged: true });

  const v = await visitorsOf(conf, 7);
  expect(v.totals).toMatchObject({ real: 1, browsers: 2, agents: 1, bots: 1 });
  expect(v.sites.find((s) => s.site === "playground")).toMatchObject({ name: "Playground", real: 1, browsers: 2, agents: 1, bots: 0 });
  expect(v.sites.find((s) => s.site === "eqosys")).toMatchObject({ bots: 1 });
  expect(v.refs).toEqual([{ ref: "www.google.com", real: 1 }]);
  expect(v.by_day).toHaveLength(7);
  expect(v.by_day.at(-1)).toMatchObject({ real: 1 });
  expect(v.signups).toBe(1);
  // No address is kept: callers are short codes.
  expect(v.recent.every((c) => /^[0-9a-f]{12}$/.test(c.who))).toBe(true);

  // The admin reads the same through the tool; the tab renders it.
  const res = await call("/api/tools/eq_visitors", { json: { days: 7 }, cookie: boss.cookie });
  expect(((await res.res.json()) as { result: { totals: { real: number } } }).result.totals.real).toBe(1);
  const { Home } = await import("../src/app/pages.tsx");
  const html = renderToStaticMarkup(createElement(Home, { counts: new Map(), t0: 0, me: { id: "1", email: "boss@example.com", name: "Boss" } as never, mine: undefined, hub: null, everyone: [], unlocks: new Map(), tab: "visitors", visitors: v }));
  expect(html.length).toBeGreaterThan(0);
});
