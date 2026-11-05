// The Book in a Qollab party (#3548): everyone plays their own journey, but when the Book stops you, the host answers
// for the party. The host's page says its reply on the party's channel ("book:<talk>.<reply>"); a guest's page answers
// the same talk with it through the same reply path its own click would take, which lifts the hold. If the host's Book
// asked something else (the journeys have drifted), or the host has not answered in half a minute, the guest's hold
// lifts and they answer for themselves, so a party never stalls anyone. No DOM: main.ts draws the hold (book.ts `holdOf`), and the test runs two of these on one party.
import type { party, PartyMember } from "@rustybuns/util/eqosys";

type Party = ReturnType<typeof party>;
export interface Seat { host: boolean; hostName: string }

const WIRE = /^book:([a-z0-9-]{1,40})\.([a-z0-9-]{1,32})$/;
export const wireOf = (talk: string, reply: string) => `book:${talk}.${reply}`;
export function readWire(text: string): { talk: string; reply: string } | null {
  const m = WIRE.exec(text);
  return m ? { talk: m[1]!, reply: m[2]! } : null;
}

/** Where this page sits in the party: null alone or with no host in the room (nobody to wait on). The host is this page
 * when its eqosys id is the host's (`id`); a page that knows no id (an old login) goes by name. */
export function seatOf(members: readonly PartyMember[], me: string | undefined, id?: string): Seat | null {
  const host = members.find((m) => m.host);
  if (!host || members.length < 2) return null;
  return { host: id ? host.id === id : host.name === me, hostName: host.name };
}

export interface BookPage {
  /** The signed-in name, and the eqosys id the party knows this page by (its token's `sub`), to find it among the members. */
  name: () => string | undefined;
  id?: () => string | undefined;
  /** The talk open on this page and not answered yet, or null. */
  open: () => string | null;
  /** Answer the open talk with the host's reply, as a click would. */
  answer: (reply: string) => void;
  /** The seat or the hold changed: draw it again. */
  changed: () => void;
}

/** Wire a page's Book to party `p` (already made; this joins `code`). */
/** How long a guest waits on a host who has not answered before answering for themselves. */
export const PATIENCE = 30_000;
/** How far the party server's clock may run from this page's: a host answer older than the open talk by more is a
 * replay of the kept chat (the server sends it to whoever joins), not the host moving on. */
const SKEW = 5_000;

export function bookParty(p: Party, code: string, page: BookPage, patience = PATIENCE) {
  let seat: Seat | null = null, members: PartyMember[] = [], freed: string | null = null, openedAt = 0;
  let wait: ReturnType<typeof setTimeout> | undefined;
  /** The host's last reply to each talk, so a talk that opens here after the host answered it is answered at once. */
  const hosts = new Map<string, string>();
  const deliver = () => {
    const open = page.open();
    if (!open || !seat || seat.host) return;
    const reply = hosts.get(open);
    if (reply) page.answer(reply);
  };
  p.onMembers((m) => { members = m; seat = seatOf(m, page.name(), page.id?.()); page.changed(); deliver(); });
  p.onSay((m) => {
    const w = readWire(m.text);
    if (!w || !members.some((x) => x.id === m.from.id && x.host)) return;
    hosts.set(w.talk, w.reply);
    const open = page.open();
    if (open && open !== w.talk && seat && !seat.host && m.at >= openedAt - SKEW) { freed = open; page.changed(); }
    deliver();
  });
  p.onGone(() => { members = []; seat = null; page.changed(); });
  p.join(code);
  return {
    seat: () => seat,
    /** True when the host has moved on to another talk while this page's stays open. */
    freed: () => freed !== null && freed === page.open(),
    /** A talk opened on this page: answer it now if the host already did. */
    opened: () => {
      freed = null; openedAt = Date.now(); clearTimeout(wait);
      const open = page.open();
      // an idle host never keeps anyone: after a while the guest answers this one for themselves
      wait = setTimeout(() => { if (open && page.open() === open && seat && !seat.host) { freed = open; page.changed(); } }, patience);
      deliver();
    },
    /** This page answered: the host's goes out to the party. */
    answered: (talk: string, reply: string) => { if (seat?.host) p.say(wireOf(talk, reply)); },
    leave: () => { clearTimeout(wait); p.leave(); },
  };
}
