// The Book in a Qollab party (#3548): everyone plays their own journey, but when the Book stops you, the host answers
// for the party. The host's page says its reply on the party's channel ("book:<talk>.<reply>"); a guest's page answers
// the same talk with it through the same reply path its own click would take, which lifts the hold. If the host's Book
// asked something else (the journeys have drifted), the guest's hold lifts and they answer for themselves, so a party
// never stalls anyone. No DOM: main.ts draws the hold (book.ts `holdOf`), and the test runs two of these on one party.
import type { party, PartyMember } from "@rustybuns/util/eqosys";

type Party = ReturnType<typeof party>;
export interface Seat { host: boolean; hostName: string }

const WIRE = /^book:([a-z0-9-]{1,40})\.([a-z0-9-]{1,32})$/;
export const wireOf = (talk: string, reply: string) => `book:${talk}.${reply}`;
export function readWire(text: string): { talk: string; reply: string } | null {
  const m = WIRE.exec(text);
  return m ? { talk: m[1]!, reply: m[2]! } : null;
}

/** Where this page sits in the party: null alone or with no host in the room (nobody to wait on). */
export function seatOf(members: readonly PartyMember[], me: string | undefined): Seat | null {
  const host = members.find((m) => m.host);
  if (!host || members.length < 2) return null;
  return { host: host.name === me, hostName: host.name };
}

export interface BookPage {
  /** The signed-in name, to find this page among the members. */
  name: () => string | undefined;
  /** The talk open on this page and not answered yet, or null. */
  open: () => string | null;
  /** Answer the open talk with the host's reply, as a click would. */
  answer: (reply: string) => void;
  /** The seat or the hold changed: draw it again. */
  changed: () => void;
}

/** Wire a page's Book to party `p` (already made; this joins `code`). */
export function bookParty(p: Party, code: string, page: BookPage) {
  let seat: Seat | null = null, members: PartyMember[] = [], freed: string | null = null;
  /** The host's last reply to each talk, so a talk that opens here after the host answered it is answered at once. */
  const hosts = new Map<string, string>();
  const deliver = () => {
    const open = page.open();
    if (!open || !seat || seat.host) return;
    const reply = hosts.get(open);
    if (reply) page.answer(reply);
  };
  p.onMembers((m) => { members = m; seat = seatOf(m, page.name()); page.changed(); deliver(); });
  p.onSay((m) => {
    const w = readWire(m.text);
    if (!w || !members.some((x) => x.id === m.from.id && x.host)) return;
    hosts.set(w.talk, w.reply);
    const open = page.open();
    if (open && open !== w.talk && seat && !seat.host) { freed = open; page.changed(); }
    deliver();
  });
  p.onGone(() => { members = []; seat = null; page.changed(); });
  p.join(code);
  return {
    seat: () => seat,
    /** True when the host has moved on to another talk while this page's stays open. */
    freed: () => freed !== null && freed === page.open(),
    /** A talk opened on this page: answer it now if the host already did. */
    opened: () => { freed = null; deliver(); },
    /** This page answered: the host's goes out to the party. */
    answered: (talk: string, reply: string) => { if (seat?.host) p.say(wireOf(talk, reply)); },
    leave: () => p.leave(),
  };
}
