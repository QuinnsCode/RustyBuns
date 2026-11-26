// Qollab Studio as one path, the way someone walks it: from their character on eqosys to the lobby, into a room, then
// through the doors to the gear room, Q Amp and the desk, and back into the same room each time.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EQOSYS } from "../src/account.ts";
import { inviteLink, fromLink } from "../src/studio/door.ts";
import { doors, type Here } from "../src/way.ts";

const ORIGIN = "https://fm-daw.example";
/** Through the door to `to` from `here`, at the address `at`: the address it lands on. */
const go = (here: Here, at: string, to: Here) => {
  const d = doors(here, new URL(at, ORIGIN).search).find((x) => x.to === to);
  expect(d).toBeDefined();
  return new URL(d!.href, ORIGIN).href;
};

test("character, lobby, the jam room, the gear room, Q Amp and the desk, and back into the same room", () => {
  // the lobby's door back to your character goes to eqosys's Me tab, and every page is a page the app builds
  expect(go("jam", "/jam.html", "character")).toBe(`${EQOSYS}/?tab=account`);
  for (const p of ["jam.html", "studio.html", "amp.html", "speakers.html", "index.html"]) expect(existsSync(join(import.meta.dir, "..", p))).toBe(true);

  // in the lobby, the doors carry no room
  expect(go("jam", "/jam.html", "gear")).toBe(`${ORIGIN}/studio.html`);

  // in a room, every door carries it, and the jam room's door brings you back into it from anywhere
  const room = inviteLink(ORIGIN, "friday-jam-ab12", undefined, "Friday jam");
  const inRoom = fromLink(new URL(room).search);
  let at = room;
  for (const [from, to] of [["jam", "gear"], ["gear", "amp"], ["amp", "desk"], ["desk", "jam"]] as const) {
    at = go(from, at, to);
    expect(fromLink(new URL(at).search)).toEqual(inRoom);
  }
  expect(new URL(at).pathname).toBe("/jam.html");
  for (const from of ["gear", "amp", "desk"] as const) expect(fromLink(new URL(go(from, go("jam", room, from), "jam")).search)).toEqual(inRoom);
});
