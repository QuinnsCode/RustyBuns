// A live set in a crew room: one DJ seat, and the decks shared so everyone's page plays the same mix in step. The
// room's own rules (crew/room.ts) and the page's sync (crew/sync.ts), with the wire passed by hand so the test owns
// the clock: time passes for the room and for every page's decks together.
import { expect, test } from "bun:test";
import { newWorld, type World } from "../src/sim.ts";
import { Crew, readSent } from "../src/crew/room.ts";
import { hear, outbox, synced, type Booth, type Synced } from "../src/crew/sync.ts";
import { TRACKS, newDecks, play, setCross, setPitch, tickDecks } from "../src/audio/decks.ts";
import { DJ_BOOTH } from "../src/venues/dj-booth.ts";

interface Page { id: string; w: World; s: Synced; booth: Booth }

function room() {
  const crew = new Crew(), pages: Page[] = [];
  let now = 1_000_000;
  const join = (name: string): Page => {
    const id = `guest-${name.toLowerCase()}`;
    crew.join(id, name);
    const p: Page = { id, w: newWorld(DJ_BOOTH), s: synced(), booth: { decks: newDecks(), want: false, room: false, dj: null, note: "" } };
    pages.push(p);
    return p;
  };
  /** One round of the wire: every page says what changed, the room answers each with its view (or a refusal). */
  const pump = () => {
    for (const p of pages) for (const raw of outbox(p.w, p.s, undefined, undefined, p.booth)) {
      // Through the wire's own guard, as the room's socket handler reads it.
      const m = readSent(JSON.parse(JSON.stringify(raw)));
      if (m?.t === "dj") { const got = crew.seat(p.id, m.take); if (!got.ok) hear(p.w, p.s, { t: "refused", key: "decks", why: got.why }, undefined, undefined, p.booth); }
      else if (m?.t === "decks") crew.spin(p.id, m, now);
    }
    for (const p of pages) hear(p.w, p.s, crew.view(p.id, now), undefined, undefined, p.booth);
  };
  /** Seconds pass: the room's clock and every page's decks run on. */
  const pass = (seconds: number) => { now += seconds * 1000; for (const p of pages) tickDecks(p.booth.decks, seconds); };
  return { join, pump, pass };
}

/** How far apart two pages are in a deck's track, in milliseconds of music. */
const apartMs = (a: Page, b: Page, deck = 0) => (Math.abs(a.booth.decks.deck[deck]!.beat - b.booth.decks.deck[deck]!.beat) / (TRACKS[deck]!.bpm / 60)) * 1000;

test("one DJ plays and the whole crew is in step: a second DJ is refused, a late joiner lands in time, a handover doesn't restart the music", () => {
  const { join, pump, pass } = room();
  const ada = join("Ada"), bea = join("Bea");

  // Ada takes the decks and starts deck 1. Ten seconds on, Bea's page is at the same place in the track.
  ada.booth.want = true;
  pump();
  expect(ada.booth.dj).toEqual({ me: true, name: "Ada" });
  expect(bea.booth.dj).toEqual({ me: false, name: "Ada" });
  play(ada.booth.decks, 1);
  pump();
  pass(10);
  expect(bea.booth.decks.deck[0]!.playing).toBe(true);
  expect(ada.booth.decks.deck[0]!.beat).toBeGreaterThan(15);
  expect(apartMs(ada, bea)).toBeLessThan(50);

  // Bea reaches for the decks: the room says who has them, and her page stops asking.
  bea.booth.want = true;
  pump();
  expect(bea.booth).toMatchObject({ want: false, note: "Ada is on the decks", dj: { me: false, name: "Ada" } });

  // Ada rides the pitch up 4%: nobody jumps, and they stay together at the new tempo.
  pass(3);
  const before = bea.booth.decks.deck[0]!.beat;
  setPitch(ada.booth.decks, 1, 4);
  pump();
  expect(Math.abs(bea.booth.decks.deck[0]!.beat - before)).toBeLessThan(0.05);
  pass(20);
  expect(bea.booth.decks.deck[0]!.pitch).toBe(4);
  expect(apartMs(ada, bea)).toBeLessThan(50);

  // Cy walks in half a minute into the track and is in time from the first view.
  const cy = join("Cy");
  pump();
  expect(cy.booth.decks.deck[0]!.playing).toBe(true);
  expect(apartMs(ada, cy)).toBeLessThan(50);

  // Ada steps off, Bea takes over: the track carries on from where it was, and now Bea's hands move everyone's mixer.
  ada.booth.want = false;
  pump();
  expect(cy.booth.dj).toBeNull();
  bea.booth.want = true;
  pump();
  expect(bea.booth.dj).toEqual({ me: true, name: "Bea" });
  const at = ada.booth.decks.deck[0]!.beat;
  setCross(bea.booth.decks, 0.5);
  pump();
  expect(ada.booth.decks.cross).toBe(0.5);
  expect(cy.booth.decks.cross).toBe(0.5);
  expect(Math.abs(ada.booth.decks.deck[0]!.beat - at)).toBeLessThan(0.05);
  pass(5);
  expect(apartMs(bea, ada)).toBeLessThan(50);
  expect(apartMs(bea, cy)).toBeLessThan(50);
});
