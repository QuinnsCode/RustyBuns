// The sesh's guest list through the running World: its maker owns it, invites someone in as a player (who then plays in a
// held room), blocks them, and they can't come back on the same invite.
import { expect, test } from "bun:test";
import { CLOSE_FULL } from "../packages/desktop/world.ts";
import { decodeGuestServer } from "../src/guest-list.ts";
import { heard, setup, useWorld, type Sock } from "./world-kit.ts";

useWorld();

const said = (world: { webSocketMessage(ws: Sock, s: string): void }, ws: Sock, m: object) => world.webSocketMessage(ws, JSON.stringify(m));
/** The next `t` the socket is sent after the `n` it had. */
async function next(ws: Sock, t: string, n = ws.sent.length) {
  for (let i = 0; i < 1000; i++) {
    const m = ws.sent.slice(n).find((x) => x.t === t);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`no "${t}"`);
}

test("the maker invites a player who plays in a held sesh, blocks them, and the invite no longer lets them in", async () => {
  const { world, join } = await setup({}, "zesty-jade-otter");
  const maker = (await join({}, "a".repeat(32))).ws;
  said(world, maker, { t: "hello", key: "a".repeat(48), name: "Ryan" });
  const makerId = (await heard(maker, "chat")).you;
  expect(decodeGuestServer(await heard(maker, "guests"))).toMatchObject({ list: { owner: makerId, ownerName: "Ryan", guests: {} } });
  said(world, maker, { t: "floor", state: "held" });               // Hold: only who's let

  // someone off the list can't ask the list for anything, and a held room doesn't carry their notes
  const lurker = (await join()).ws;
  said(world, lurker, { t: "hello", key: "c".repeat(48), name: "" });
  await heard(lurker, "chat");
  let n = lurker.sent.length;
  said(world, lurker, { t: "guest", a: { t: "invite", role: "lead" } });
  expect(await next(lurker, "guest-said", n)).toMatchObject({ ok: false });
  expect((await heard(lurker, "guests")).list.invites).toEqual([]);   // nobody else's invite codes

  // the maker invites a player; the code is the World's
  n = maker.sent.length;
  said(world, maker, { t: "guest", a: { t: "invite", role: "player", uses: 2 } });
  const { list } = await next(maker, "guest-said", n);
  const code: string = list.invites[0].code;
  expect(code.length).toBeGreaterThanOrEqual(16);

  // Amy comes in on the invite: she's on the list as a player and her notes go through the held room
  const amy = (await join({}, "", `invite=${code}`)).ws;
  said(world, amy, { t: "hello", key: "b".repeat(48), name: "Amy" });
  const amyId = (await heard(amy, "chat")).you;
  expect((await heard(amy, "guest-said")).list.guests[amyId]).toMatchObject({ name: "Amy", role: "player", by: makerId });
  const note = { t: "live", e: { t: "on", track: 0, midi: 60, vel: 0.8 } };
  n = maker.sent.length;
  said(world, lurker, note);
  said(world, amy, note);
  await new Promise((r) => setTimeout(r, 10));
  expect(maker.sent.slice(n).filter((m) => m.t === "live").length).toBe(1);   // Amy's, not the lurker's

  // the maker blocks her: every tab she has goes, with the card that says why
  said(world, maker, { t: "guest", a: { t: "block", who: amyId } });
  await next(amy, "full");
  expect(amy.sent.findLast((m) => m.t === "full")).toEqual({ t: "full", why: "blocked" });
  expect(amy.closed).toBe(CLOSE_FULL);
  expect((await next(maker, "guests", n)).list.blocked[amyId]).toMatchObject({ name: "Amy", by: makerId });

  // back on the same invite (it has a use left) she's turned away at the hello, before the chat
  const again = (await join({}, "", `invite=${code}`)).ws;
  said(world, again, { t: "hello", key: "b".repeat(48), name: "Amy" });
  expect(await next(again, "full", 0)).toEqual({ t: "full", why: "blocked" });
  expect(again.closed).toBe(CLOSE_FULL);
  expect(again.sent.some((m) => m.t === "chat")).toBe(false);
});

test("a hand goes down when its socket says hello with a new key, so hands never pile up", async () => {
  const { world, join } = await setup({}, "quiet-jade-heron");
  const maker = (await join({}, "a".repeat(32))).ws;
  said(world, maker, { t: "hello", key: "a".repeat(48), name: "Ryan" });
  await heard(maker, "chat");
  const mal = (await join()).ws;
  said(world, mal, { t: "hello", key: "b".repeat(48), name: "" });
  await heard(mal, "chat");
  let n = maker.sent.length;
  said(world, mal, { t: "ask", can: "lead" });
  expect(Object.values((await next(maker, "grants", n)).asks)).toEqual(["lead"]);
  n = maker.sent.length;
  said(world, mal, { t: "hello", key: "c".repeat(48), name: "" });
  expect((await next(maker, "grants", n)).asks).toEqual({});
});
