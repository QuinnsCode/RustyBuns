import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { party, type PartyMember } from "@rustybuns/util/eqosys";
import { check } from "@rustybuns/util/guard";
import { answer, holdOf, LINES, Lines, lossBeats, momentFor, notesOf, spendInk, tally, type Beat, type Ctx, type Moment } from "../src/book.ts";
import { bookParty, seatOf } from "../src/book-party.ts";
import { demandOf } from "../src/demand.ts";
import { approach, FACTION, factionsOf, reply as replyFaction, sectionCleared, standingOf, type Ctx as FactionCtx, type Scene } from "../src/factions/engine.ts";
import { clearSection, contacted, loadJourney, mythicOf, newJourney, SECTIONS, TRAIL_REGIONS, type Journey } from "../src/journey.ts";
import { friendsOf } from "../src/compendium.ts";
import { creature } from "../src/roster.ts";

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
    expect(beat(j, "open", "all", { n: 1 }).m.lead.length).toBeGreaterThan(2); // the first open says what the Book is before it asks
    const bound = beat(j, "bind", "more", { n: 1, item: 4 });
    expect(bound.m.ask).toStartWith("Item 4.");
    expect(bound.got.named).toBe(true); // the first nickname: the Book writes it down next
    expect(momentFor("named", j)).toBeTruthy();
    beat(j, "bind-fail", "again", { n: 1 }); // "Try again?" earns a drop of ink for the next fight
    beat(j, "downed", "plan", { n: 1, down: "Hodag" });
    tally(j, true);
    expect(tally(j, true)).toBe(2); // a second lost fight in a row is a streak
    beat(j, "streak", "run", { n: 1 });
    beat(j, "campfire", "thanks", { n: 1 });
    beat(j, "mythic", "enough", { n: 1, regionId: "pine-barrens", mythic: "Jersey Devil" });
    beat(j, "campfire", "scared", { n: 3 }); // said in the north woods, not the pines
    expect(notesOf(j)).toEqual(["Promised all of them.", "Thinks beating one is enough.", "Scared, and honest about it."]);

    j = loadJourney(JSON.stringify(j))!; // the save keeps the conversation, and where each reply was given
    expect(j.talk?.said).toMatchObject({ open: "all", "bind-first": "more", "downed-first": "plan", "fail-1": "again" });
    expect(j.talk?.at).toMatchObject({ open: 1, "mythic-1": 1, "fire-2": 3 });
    expect(spendInk(j)).toBe(1);
    expect(spendInk(j)).toBe(0); // spent once

    // the second region's mythic quotes the first page back, word for word; "What do you want next?" turns the demand to wings
    const second = momentFor("mythic", j, { n: 2, item: 7 })!;
    const promised = LINES.find((t) => t.id === "open")!.replies.find((r) => r.id === "all")!.say;
    expect(second.recall).toBe(`On the first page you said, and I quote, "${promised}" Item 7 says otherwise.`);
    answer(j, second, "next");
    expect(demandOf(j)).toStartWith("Item 4: something with wings,");
    // the lake's own mythic answers what you said at the first one, ahead of the generic talks, counting the regions truly
    const lake = momentFor("mythic", j, { n: 5, regionId: "great-lakes-and-lake-champlain", mythic: "Champ" })!;
    expect(lake.talk.id).toBe("mythic-champ");
    expect(lake.recall).toContain("Four regions ago");
    // the desert's says where you really said you were scared
    expect(momentFor("mythic", j, { n: 6, regionId: "southwest-desert" })!.recall).toContain("In the north woods");
    // the last trail's mythic counts back to the first page, which was said in the pines
    expect(momentFor("mythic", j, { n: 8, regionId: "ozarks-and-the-southern-plains" })!.recall).toContain("Seven regions ago");
  });

  test("the contacts reveal: the Book monologues at each trail's mythic, and only the last one turns it into Contacts", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    const said: string[] = [];
    for (const g of TRAIL_REGIONS) {
      expect(contacted(j)).toBe(false);
      const ctx = { n: g.n, regionId: g.id, region: g.name, mythic: mythicOf(g).name };
      const mono = momentFor("leader", j, ctx)!; // reaching the last stone: this region's own monologue, a few pages long
      expect(mono.lead.length).toBeGreaterThanOrEqual(2);
      expect(mono.lead[0]).toContain(mythicOf(g).name);
      said.push(mono.talk.id);
      answer(j, mono, mono.talk.replies[0]!.id);
      expect(momentFor("leader", j, ctx)).toBeNull(); // said once
      for (let k = 0; k < SECTIONS; k++) clearSection(j, g.n, k);
    }
    expect(new Set(said).size).toBe(TRAIL_REGIONS.length);
    expect(contacted(j)).toBe(true);
    const flip = momentFor("contacts", j, { n: 8 })!;
    expect(flip.lead.join(" ")).toContain("Contacts.");
    // its pages name friends: a mythic knows the mythics either side of it, a beast the ones from its own legends
    expect(friendsOf(creature("jersey-devil"))).toEqual(["Mothman"]);
    expect(friendsOf(creature("mothman"))).toEqual(["Jersey Devil", "Hidebehind", "Wampus Cat"]);
    expect(friendsOf(creature("hoop-snake"))).toEqual(["Ozark Howler"]);
  });

  test("what you say at a campfire decides what the Book asks at the next one, through a reload", () => {
    const after = (reply: string) => {
      const j = newJourney(["hodag", "squonk", "jackalope"])!;
      beat(j, "campfire", reply, { n: 1 });
      return momentFor("campfire", loadJourney(JSON.stringify(j))!, { n: 1 })!;
    };
    expect(after("thanks").talk.id).toBe("fire-2"); // the usual order
    expect(after("sleep").ask).toContain("asleep"); // "Do you ever sleep?": the Book turns to the line-up asleep
    // "Nothing." when it asks for something true: it presses on where you were before it, and the order picks up after
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    beat(j, "campfire", "thanks", { n: 1 });
    beat(j, "campfire", "nothing", { n: 1 });
    expect(beat(j, "campfire", "home", { n: 1 }).m.talk.id).toBe("fire-4");
    expect(momentFor("campfire", j, { n: 1 })!.talk.id).toBe("fire-3");
  });

  test("a bind, a member down and a mythic each have a branch: it plays only when your reply asked for it", () => {
    for (const [b, asks, plain, branch, usual] of [
      ["bind", "bad", "good", "bind-looked", "bind-2"],
      ["bind", "more", "good", "bind-eager", "bind-2"],
      ["downed", "help", "sorry", "downed-asked", "downed-again"],
      ["downed", "plan", "sorry", "downed-plan", "downed-again"],
      ["mythic", "else", "enough", "mythic-unbound", "mythic-2"],
    ] as const) {
      const said = (reply: string) => {
        const j = newJourney(["hodag", "squonk", "jackalope"])!;
        beat(j, b, reply, { n: 1 });
        const heard: string[] = [];
        for (let m; (m = momentFor(b, loadJourney(JSON.stringify(j))!, { n: 2 })) && heard.length < 20;) { heard.push(m.talk.id); answer(j, m, m.talk.replies[0]!.id); }
        return heard;
      };
      expect([b, asks, said(asks)[0]]).toEqual([b, asks, branch]);
      expect(said(asks)[1]).toBe(usual); // then the usual order picks up
      expect(said(plain)).not.toContain(branch); // nobody asked: the Book never says it
      expect(said(plain)[0]).toBe(usual);
    }
  });

  test("the lines file: a next has to name another talk at its own beat, and a branch needs a reply that asks for it", () => {
    const talk = (id: string, beat: Beat, next?: string, asked?: boolean) => ({ id, beat, asked, ask: "?", replies: [{ id: "a", say: "a", book: "a", next }, { id: "b", say: "b", book: "b" }] });
    expect(Lines([talk("one", "bind", "two"), talk("two", "bind", undefined, true)]).length).toBe(2);
    for (const [why, file] of [
      ["no such talk", [talk("one", "bind", "three"), talk("two", "bind")]],
      ["a talk at another beat", [talk("one", "bind", "two"), talk("two", "campfire")]],
      ["itself", [talk("one", "bind", "one"), talk("two", "bind")]],
      ["a branch nobody asks for", [talk("one", "bind"), talk("two", "bind", undefined, true)]],
    ] as const) expect([why, check(Lines, file)]).toEqual([why, null]);
  });

  test("a lost fight: streak before a member down, the whole line-up before the streak", () => {
    expect([lossBeats(1, true), lossBeats(2, true), lossBeats(1, false), lossBeats(3, false)])
      .toEqual([["downed"], ["streak", "downed"], ["loss"], ["loss", "streak"]]);
  });

  test("the lines file: a guard turns away a broken talk, and the Book never says the same line twice", () => {
    expect(() => Lines([{ id: "x", beat: "dinner", ask: "?", replies: [] }])).toThrow();
    const said = LINES.flatMap((t) => [...(t.lead ?? []), t.ask, ...t.replies.map((r) => r.book), ...(t.recall ?? []).map((r) => r.line)]);
    expect(said.length).toBeGreaterThanOrEqual(150);
    expect(new Set(said).size).toBe(said.length);
    // nor two lines that open the same way: the same first five words, placeholders aside, read as one line said twice
    const opening = (s: string) => s.toLowerCase().replace(/\{\w+\}/g, " ").replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    const twins = said.map(opening).filter((o, i, all) => all.indexOf(o) !== i);
    expect(twins).toEqual([]);
    for (const t of LINES) for (const r of t.recall ?? []) {
      const [id, reply] = r.of.split(".");
      expect(LINES.find((x) => x.id === id)?.replies.some((x) => x.id === reply)).toBe(true);
    }
  });
});

// --- two pages in one party ----------------------------------------------------------------------------------
// Stands in for eqosys's party (apps/eqosys/src/qollab/party.ts): the first to join hosts, everyone hears who is in, and a
// `say` goes to everyone, kept and replayed to whoever joins later. With `relay` on (eqosys since #3678) a `game` move goes to
// everyone and is never kept; off, it is dropped, as an eqosys from before moves drops it.
type Sock = Bun.ServerWebSocket<{ name: string }>;
const socks = new Set<Sock>(), kept: { at: number }[] = [];
let hostName = "", relay = true, relayed = 0;
const members = (): PartyMember[] => [...socks].map((s) => ({ id: `u_${s.data.name}`, name: s.data.name, ready: false, host: s.data.name === hostName }));
const tell = (m: unknown) => { for (const s of socks) s.send(JSON.stringify(m)); };
const fake = Bun.serve<{ name: string }>({
  port: 0, hostname: "127.0.0.1",
  // The token (here the player's name) comes as the second subprotocol after "eqosys", and the answer names "eqosys", as eqosys's does.
  fetch: (req, srv) => srv.upgrade(req, {
    headers: { "Sec-WebSocket-Protocol": "eqosys" },
    data: { name: req.headers.get("sec-websocket-protocol")?.split(",")[1]?.trim() ?? "" },
  }) ? undefined : new Response("", { status: 400 }),
  websocket: {
    open: (s) => { socks.add(s); hostName ||= s.data.name; tell({ t: "members", members: members() }); for (const m of kept) s.send(JSON.stringify(m)); },
    message: (s, raw) => {
      const m: unknown = JSON.parse(String(raw));
      if (typeof m !== "object" || !m || !("text" in m) || typeof m.text !== "string" || !("t" in m)) return;
      const game = m.t === "game";
      if (game && !relay) return;
      const said = { t: game ? "game" : "say", from: { id: `u_${s.data.name}`, name: s.data.name }, text: m.text, at: Date.now() };
      if (!game) kept.push(said);
      relayed++; tell(said);
    },
    close: (s) => { socks.delete(s); tell({ t: "members", members: members() }); },
  },
});
afterAll(() => fake.stop(true));

/** One player's page: its own journey, the moment on screen (the Book's, or a faction's sheet), and the reply path
 * main.ts's click takes. */
function page(name: string, patience?: number) {
  const j = newJourney(["hodag", "squonk", "jackalope"])!;
  let open: Moment | null = null, said: string | null = null, scene: Scene | null = null, sheet: string | null = null;
  const reply = (id: string) => { said = answer(j, open!, id)!.said; };
  const ctx = (): FactionCtx => ({ now: Date.now(), n: 1, k: FACTION.office.quest[0]!.k + 1, party: readers.size() });
  const answerSheet = (id: string) => { sheet = replyFaction(j, scene!, id, ctx())!.said; };
  const readers = bookParty(party({ url: () => `http://127.0.0.1:${fake.port}`, token: () => name }), "KRTZ", {
    name: () => name, id: () => `u_${name}`, open: () => (open && said === null ? open.talk.id : null), answer: reply, changed: () => {},
    faction: { open: () => (scene && sheet === null ? scene.stage.id : null), answer: answerSheet },
  }, patience);
  const hold = () => holdOf(readers.seat(), readers.freed());
  const sheetHold = () => holdOf(readers.seat(), readers.faction.freed(), scene?.who.name);
  return {
    j, readers, hold, sheetHold, said: () => said, sheet: () => sheet,
    /** Walk the first region past the Office's first step and up to whoever waits there. */
    face() {
      for (let k = 0; k <= FACTION.office.quest[0]!.k; k++) { clearSection(j, 1, k); sectionCleared(j, 1, k, Date.now()); }
      scene = approach(j, "office", ctx()); sheet = null; readers.faction.opened(); return scene?.stage.id;
    },
    pick(id: string) { if (!scene || !sheetHold().canAnswer) return false; answerSheet(id); readers.faction.answered(scene.stage.id, id); return true; },
    show(b: Beat, ctx: Ctx = {}) { open = momentFor(b, j, ctx); said = null; readers.opened(); return open?.talk.id; },
    click(id: string) { if (!open || !hold().canAnswer) return false; const talk = open.talk.id; reply(id); readers.answered(talk, id); return true; },
  };
}
const until = async (f: () => unknown) => { const end = Date.now() + 5_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(5); } };

test("two friends with one name: the seat goes by eqosys id, so only the host answers", () => {
  const two: PartyMember[] = [{ id: "u_1", name: "Ada", ready: false, host: true }, { id: "u_2", name: "Ada", ready: false, host: false }];
  expect([seatOf(two, "Ada", "u_1"), seatOf(two, "Ada", "u_2")]).toEqual([{ host: true, hostName: "Ada" }, { host: false, hostName: "Ada" }]);
});

test.each([["as party moves", true], ["in chat, on an eqosys from before moves", false]])("in a party the guest's page holds until the host answers %s, takes the host's reply, and is never stuck", async (_, on) => {
  relay = on; kept.length = 0;
  const ada = page("Ada");
  await until(() => socks.size === 1);
  const bo = page("Bo");
  await until(() => ada.readers.seat()?.host && bo.readers.seat()?.hostName === "Ada");

  ada.show("open"); bo.show("open");
  expect(bo.hold()).toEqual({ canAnswer: false, note: "The Book is waiting on Ada." });
  expect(bo.click("all")).toBe(false); // a held page's buttons do nothing
  expect(ada.click("no")).toBe(true);
  await until(() => bo.said());
  expect(bo.said()).toBe(ada.said());
  expect(bo.j.talk).toMatchObject({ said: { open: "no" }, nick: "the reluctant one" }); // the same reply, in the guest's own save

  // the host answers a talk before the guest's page reaches it: it is answered the moment it opens
  const before = relayed;
  ada.show("bind", { n: 1, item: 4 }); ada.click("more");
  await until(() => relayed > before);
  bo.show("bind", { n: 1, item: 4 });
  await until(() => bo.said());
  expect(bo.said()).toBe(ada.said());

  // the journeys drift: the host's Book asks something else, so the guest answers this one for themselves
  bo.show("campfire", { n: 1 });
  ada.show("downed", { n: 1, down: "Hodag" }); ada.click("sorry");
  await until(() => bo.hold().canAnswer);
  expect(bo.hold().note).toBe("The Book stopped waiting on Ada. This one is yours.");
  expect(bo.click("sleep")).toBe(true);

  // someone joins late with a talk open: the host's old answers replayed to them don't free it, and an idle host doesn't keep them
  for (const k of kept) k.at -= 60_000;
  const cy = page("Cy", 300);
  cy.show("campfire", { n: 1 }); // a talk the host never answered
  await until(() => cy.readers.seat()?.hostName === "Ada");
  await Bun.sleep(50);
  expect(cy.hold().canAnswer).toBe(false);
  await until(() => cy.hold().canAnswer);
  cy.readers.leave();

  // with moves, only the first answer (sent before the host's own move came back) went into the party's chat
  expect(kept.length).toBe(on ? 1 : 3);

  // the host leaves: nobody to wait on
  ada.readers.leave();
  await until(() => bo.readers.seat() === null);
  bo.show("downed", { n: 1, down: "Squonk" });
  expect(bo.hold().canAnswer).toBe(true);
  bo.readers.leave();
});

test("in a party the host answers a faction's question for everyone: the guest's sheet closes with the same reply and flag", async () => {
  const ada = page("Ada");
  await until(() => socks.size === 1);
  const bo = page("Bo");
  await until(() => ada.readers.seat()?.host && bo.readers.seat()?.hostName === "Ada");

  expect(bo.face()).toBe("office.1");
  expect(bo.sheetHold()).toEqual({ canAnswer: false, note: "Agent Pell is waiting on Ada." });
  expect(bo.pick("refuse")).toBe(false); // a held sheet's buttons do nothing
  expect(ada.face()).toBe("office.1");
  expect(ada.pick("gary")).toBe(true);
  await until(() => bo.sheet());
  expect(bo.sheet()).toBe(ada.sheet());
  expect(factionsOf(bo.j).flags).toContain("office-gary"); // the host's reply, kept in the guest's own save
  // two of them: the Office counted a party when it met each
  expect([standingOf(ada.j, "office").intro?.party, standingOf(bo.j, "office").intro?.party]).toEqual([2, 2]);
  ada.readers.leave(); bo.readers.leave();
});
