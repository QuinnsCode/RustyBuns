// The Scale tab's sums (src/scale.ts): the everyday Qollab rooms land where the price sheets say, and a typed-in
// query can't break the page.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT, EUR_USD, PRESETS, crossover, durableObjects, gamesPerBox, loadOf } from "../src/scale.ts";
import { Home } from "../src/app/pages.tsx";
import type { Me } from "../src/auth.ts";

const BOSS: Me = { id: "1", email: "boss@example.com", name: "Boss" };
const preset = (id: string) => ({ ...DEFAULT, ...PRESETS.find((p) => p.id === id)!.load });

test("hubs stay on Durable Objects; busy rooms move to servers, and sooner when they can't hibernate", () => {
  expect(durableObjects(preset("hub")).usd).toBeLessThan(10); // 1,000 hubs online for about the $5 floor
  expect(crossover(preset("hub"), "do", "hetzner")).toBeNull();
  const action = crossover(preset("action"), "do", "hetzner")!, awake = crossover({ ...preset("action"), hibernate: 0 }, "do", "hetzner")!;
  expect(action).toBeGreaterThan(10);
  expect(action).toBeLessThan(1000);
  expect(awake).toBeLessThan(action);
  // A room awake all month is $4.05 of 128 MB time, as the pricing page works it out.
  const one = { ...DEFAULT, ccu: 4, room: 4, rate: 0.0001, hibernate: 0 };
  expect(durableObjects({ ...one, ccu: 4 * 1001 }).usd - durableObjects({ ...one, ccu: 4 * 1000 }).usd).toBeCloseTo(4.05, 2);
});

test("a query a person types can't put the sums out of range", () => {
  for (const [q, want] of [
    ["ccu=abc&room=", { ccu: DEFAULT.ccu, room: DEFAULT.room }],
    ["ccu=-5&regions=9&awake=4", { ccu: 1, regions: 3, awake: 1 }],
    ["ccu=1e99&hibernate=0.4", { ccu: 10_000_000, hibernate: 0 }],
  ] as const) expect(loadOf(new URLSearchParams(q))).toMatchObject(want);
  const html = renderToStaticMarkup(createElement(Home, { counts: new Map(), t0: 0, me: BOSS,
    mine: undefined, hub: null, everyone: [], unlocks: new Map(), tab: "scale", scale: loadOf(new URLSearchParams("ccu=1e99&room=1")) }));
  expect(html).not.toContain("NaN");
});

test("the long tail packs onto one box: about sixty measured games on a 4 GB server, cents each", () => {
  const b = gamesPerBox();
  expect(b.fit).toBeGreaterThan(50);
  expect(b.eurPerGame * EUR_USD).toBeLessThan(b.doRoomUsd / 10); // a whole game for under a tenth of one awake room
});
