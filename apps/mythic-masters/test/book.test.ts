import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { party, type PartyMember } from "@rustybuns/util/eqosys";
import { answer, holdOf, LINES, Lines, lossBeats, momentFor, notesOf, spendInk, tally, type Beat, type Ctx, type Moment } from "../src/book.ts";
import { bookParty } from "../src/book-party.ts";
import { demandOf } from "../src/demand.ts";
import { loadJourney, newJourney, type Journey } from "../src/journey.ts";

setDefaultTimeout(20_000);

/** Plays one beat: what the Book asks, then its answer to `reply`. */
function beat(j: Journey, b: Beat, reply: string, ctx: Ctx = {}) {
  const m = momentFor(b, j, ctx);
  if (!m) throw new Error(`the Book had nothing to say at ${b}`);
  return { m, got: answer(j, m, reply)! };
}

describe("the Book talks back", () => {
  test("a journey: each reply is kept with where it was said, survives a reload, changes play a little, and comes back regions later", () => {
    let j = newJourney(["hodag", "squonk", "jackalope"])!;
    beat(j, "open", "all");
    const bound = beat(j, "bind", "more", { n: 1, item: 4 });
    expect(bound.m.ask).toStartWith("Item 4.");
    expect(bound.got.named).toBe(true); // the first nickname: the Book writes it down next
    expect(momentFor("named", j)?.ask).toBe("I have written you down as the eager one. In pencil, for now. Pencil is a courtesy.");
    beat(j, "bind-fail", "again", { n: 1 }); // "Try again?" earns a drop of ink for the next fight
    const down = beat(j, "downed", "plan", { n: 1, down: "Hodag" });
    expect(down.got.said).toBe("Then the plan is also on the ground.");
    tally(j, true);
    expect(tally(j, true)).toBe(2); // a second lost fight in a row is a streak
    beat(j, "streak", "run", { n: 1 });
    beat(j, "campfire", "thanks", { n: 1 });
    beat(j, "mythic", "enough", { n: 1, regionId: "pine-barrens", mythic: "Jersey Devil" });
    beat(j, "campfire", "scared", { n: 3 }); // said in the north woods, not the pines
    expect(notesOf(j)).toEqual(["Promised all of them.", "Thinks beating one is enough.", "Scared, and honest about it."]);

    j = loadJourney(JSON.stringify(j))!; // the save keeps the conversation, and where each reply was given
    expect(j.talk?.said).toMatchObject({ open: "all", "bind-first": "more", "downed-first": "plan", "fail-1": "again" });
    expect(j.talk?.at).toMatchObject({ "mythic-1": 1, "fire-2": 3 });
    expect(spendInk(j)).toBe(1);
    expect(spendInk(j)).toBe(0); // spent once

    // the second region's mythic quotes the first page back, word for word; "What do you want next?" turns the demand to wings
    const second = momentFor("mythic", j, { n: 2, item: 7 })!;
    expect(second.recall).toBe(`On the first page you said, and I quote, "I'll bring you all of them." Item 7 says otherwise.`);
    answer(j, second, "next");
    expect(demandOf(j)).toStartWith("Item 4: the one with wings,");
    // the lake's own mythic answers what you said at the first one, ahead of the generic talks, counting the regions truly
    const lake = momentFor("mythic", j, { n: 5, regionId: "great-lakes-and-lake-champlain", mythic: "Champ" })!;
    expect(lake.talk.id).toBe("mythic-champ");
    expect(lake.recall).toBe("Four regions ago you said beating one was enough. The lake disagrees. It has a long memory.");
    // the desert's says where you really said you were scared
    expect(momentFor("mythic", j, { n: 6, regionId: "southwest-desert" })!.recall)
      .toBe("In the north woods you said you were scared. Out here there is nowhere to check but the horizon. Check it.");
  });

  test("a lost fight: streak before a member down, the whole line-up before the streak", () => {
    expect([lossBeats(1, true), lossBeats(2, true), lossBeats(1, false), lossBeats(3, false)])
      .toEqual([["downed"], ["streak", "downed"], ["loss"], ["loss", "streak"]]);
  });

  test("the lines file: a guard turns away a broken talk, and the Book never says the same line twice", () => {
    expect(() => Lines([{ id: "x", beat: "dinner", ask: "?", replies: [] }])).toThrow();
    const said = LINES.flatMap((t) => [t.ask, ...t.replies.map((r) => r.book), ...(t.recall ?? []).map((r) => r.line)]);
    expect(said.length).toBeGreaterThanOrEqual(150);
    expect(new Set(said).size).toBe(said.length);
    for (const t of LINES) for (const r of t.recall ?? []) {
      const [id, reply] = r.of.split(".");
      expect(LINES.find((x) => x.id === id)?.replies.some((x) => x.id === reply)).toBe(true);
    }
  });
});

// --- two pages in one party ----------------------------------------------------------------------------------
// Stands in for eqosys's party (apps/eqosys/src/party.ts): the first to join hosts, everyone hears who is in, and a
// `say` goes to everyone, kept and replayed to whoever joins later.
type Sock = Bun.ServerWebSocket<{ name: string }>;
const socks = new Set<Sock>(), kept: unknown[] = [];
let hostName = "";
const members = (): PartyMember[] => [...socks].map((s) => ({ id: `u_${s.data.name}`, name: s.data.name, ready: false, host: s.data.name === hostName }));
const tell = (m: unknown) => { for (const s of socks) s.send(JSON.stringify(m)); };
const fake = Bun.serve<{ name: string }>({
  port: 0, hostname: "127.0.0.1",
  fetch: (req, srv) => srv.upgrade(req, { data: { name: new URL(req.url).searchParams.get("token") ?? "" } }) ? undefined : new Response("", { status: 400 }),
  websocket: {
    open: (s) => { socks.add(s); hostName ||= s.data.name; tell({ t: "members", members: members() }); for (const m of kept) s.send(JSON.stringify(m)); },
    message: (s, raw) => {
      const m: unknown = JSON.parse(String(raw));
      if (typeof m !== "object" || !m || !("text" in m) || typeof m.text !== "string") return;
      const said = { t: "say", from: { id: `u_${s.data.name}`, name: s.data.name }, text: m.text, at: Date.now() };
      kept.push(said); tell(said);
    },
    close: (s) => { socks.delete(s); tell({ t: "members", members: members() }); },
  },
});
afterAll(() => fake.stop(true));

/** One player's page: its own journey, the moment on screen, and the reply path main.ts's click takes. */
function page(name: string) {
  const j = newJourney(["hodag", "squonk", "jackalope"])!;
  let open: Moment | null = null, said: string | null = null;
  const reply = (id: string) => { said = answer(j, open!, id)!.said; };
  const readers = bookParty(party({ url: () => `http://127.0.0.1:${fake.port}`, token: () => name }), "KRTZ", {
    name: () => name, open: () => (open && said === null ? open.talk.id : null), answer: reply, changed: () => {},
  });
  const hold = () => holdOf(readers.seat(), readers.freed());
  return {
    j, readers, hold, said: () => said,
    show(b: Beat, ctx: Ctx = {}) { open = momentFor(b, j, ctx); said = null; readers.opened(); return open?.talk.id; },
    click(id: string) { if (!open || !hold().canAnswer) return false; const talk = open.talk.id; reply(id); readers.answered(talk, id); return true; },
  };
}
const until = async (f: () => unknown) => { const end = Date.now() + 5_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(5); } };

test("in a party the guest's page holds until the host answers, takes the host's reply, and is never stuck", async () => {
  const ada = page("Ada");
  await until(() => socks.size === 1);
  const bo = page("Bo");
  await until(() => ada.readers.seat()?.host && bo.readers.seat()?.hostName === "Ada");

  ada.show("open"); bo.show("open");
  expect(bo.hold()).toEqual({ canAnswer: false, note: "The Book is waiting on Ada." });
  expect(bo.click("all")).toBe(false); // a held page's buttons do nothing
  expect(ada.click("no")).toBe(true);
  await until(() => bo.said());
  expect(bo.said()).toBe("Noted, in pencil. Item 1 is in ink.");
  expect(bo.j.talk).toMatchObject({ said: { open: "no" }, nick: "the reluctant one" }); // the same reply, in the guest's own save

  // the host answers a talk before the guest's page reaches it: it is answered the moment it opens
  ada.show("bind", { n: 1, item: 4 }); ada.click("more");
  await until(() => kept.length === 2);
  bo.show("bind", { n: 1, item: 4 });
  await until(() => bo.said());
  expect(bo.said()).toBe("Now we are talking. Well. I am. You are fetching.");

  // the journeys drift: the host's Book asks something else, so the guest answers this one for themselves
  bo.show("campfire", { n: 1 });
  ada.show("downed", { n: 1, down: "Hodag" }); ada.click("sorry");
  await until(() => bo.hold().canAnswer);
  expect(bo.hold().note).toBe("Ada's Book asked something else. This one is yours.");
  expect(bo.click("sleep")).toBe(true);

  // the host leaves: nobody to wait on
  ada.readers.leave();
  await until(() => bo.readers.seat() === null);
  bo.show("downed", { n: 1, down: "Squonk" });
  expect(bo.hold().canAnswer).toBe(true);
  bo.readers.leave();
});
