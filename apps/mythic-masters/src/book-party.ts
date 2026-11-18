// The Book in a Qollab party (#3548): everyone plays their own journey, but when the Book stops you, the host answers
// for the party. The host's page sends its reply as a party move ("book:<talk>.<reply>", eqosys's `game`, never kept as
// chat); until its own move comes back (an eqosys from before moves drops them) it says it in chat as well. A guest's page answers
// the same talk with it through the same reply path its own click would take, which lifts the hold. If the host's Book
// asked something else (the journeys have drifted), or the host has not answered in half a minute, the guest's hold
// lifts and they answer for themselves, so a party never stalls anyone. A faction's sheet (#4316) is answered the same
// way on its own channel ("faction:<stage>.<reply>", `office.1.name`). No DOM: main.ts draws the hold (book.ts
// `holdOf`), and the test runs two of these on one party.
import type { party, PartyMember } from "@rustybuns/util/eqosys";

type Party = ReturnType<typeof party>;
export interface Seat { host: boolean; hostName: string }
export type Kind = "book" | "faction";

// a talk is a Book line's id or a faction step's (`office.1`): the reply is what follows the last dot
const WIRE = /^(book|faction):([a-z0-9.-]{1,40})\.([a-z0-9-]{1,32})$/;
export const wireOf = (talk: string, reply: string, kind: Kind = "book") => `${kind}:${talk}.${reply}`;
export function readWire(text: string): { kind: Kind; talk: string; reply: string } | null {
  const m = WIRE.exec(text);
  return m ? { kind: m[1] === "faction" ? "faction" : "book", talk: m[2]!, reply: m[3]! } : null;
}

/** Where this page sits in the party: null alone or with no host in the room (nobody to wait on). The host is this page
 * when its eqosys id is the host's (`id`); a page that knows no id (an old login) goes by name. */
export function seatOf(members: readonly PartyMember[], me: string | undefined, id?: string): Seat | null {
  const host = members.find((m) => m.host);
  if (!host || members.length < 2) return null;
  return { host: id ? host.id === id : host.name === me, hostName: host.name };
}

/** One thing the host answers for the party: the Book's talk, or a faction's question. */
export interface Asked {
  /** The talk open on this page and not answered yet, or null. */
  open: () => string | null;
  /** Answer the open talk with the host's reply, as a click would. */
  answer: (reply: string) => void;
}
export interface BookPage extends Asked {
  /** The signed-in name, and the eqosys id the party knows this page by (its token's `sub`), to find it among the members. */
  name: () => string | undefined;
  id?: () => string | undefined;
  /** The seat or the hold changed: draw it again. */
  changed: () => void;
  /** A faction's sheet, answered for the party like the Book. */
  faction?: Asked;
}

/** How long a guest waits on a host who has not answered before answering for themselves. */
export const PATIENCE = 30_000;
/** How far the party server's clock may run from this page's: a host answer in chat older than the open talk by more is a
 * replay of the kept chat (the server sends it to whoever joins), not the host moving on. A move is never replayed. */
const SKEW = 5_000;

/** Wire a page's Book (and its faction sheet) to party `p` (already made; this joins `code`). */
export function bookParty(p: Party, code: string, page: BookPage, patience = PATIENCE) {
  let seat: Seat | null = null, members: PartyMember[] = [];
  /** This party relays moves: one came back. From then on the host stops saying answers in chat and a guest ignores them there. */
  let moves = false;
  const guest = () => !!seat && !seat.host;
  /** What the host asks of one page's channel: its hold, and what it heard the host say. */
  const channel = (kind: Kind, asked: Asked) => {
    let freed: string | null = null, openedAt = 0, wait: ReturnType<typeof setTimeout> | undefined;
    /** The host's last reply to each talk, so a talk that opens here after the host answered it is answered at once. */
    const hosts = new Map<string, string>();
    const deliver = () => {
      const open = asked.open(), reply = open && guest() ? hosts.get(open) : undefined;
      if (reply) asked.answer(reply);
    };
    return {
      deliver,
      /** The host answered `talk`: as a move (`at` null, heard as it happened) or in chat at the server's `at`. */
      heard: (talk: string, reply: string, at: number | null) => {
        hosts.set(talk, reply);
        const open = asked.open();
        if (open && open !== talk && guest() && (at === null || at >= openedAt - SKEW)) { freed = open; page.changed(); }
        deliver();
      },
      /** True when the host has moved on to another talk while this page's stays open. */
      freed: () => freed !== null && freed === asked.open(),
      /** A talk opened on this page: answer it now if the host already did. */
      opened: () => {
        freed = null; openedAt = Date.now(); clearTimeout(wait);
        const open = asked.open();
        // an idle host never keeps anyone: after a while the guest answers this one for themselves
        wait = setTimeout(() => { if (open && asked.open() === open && guest()) { freed = open; page.changed(); } }, patience);
        deliver();
      },
      /** This page answered: the host's goes out to the party. */
      answered: (talk: string, reply: string) => {
        if (!seat?.host) return;
        p.game(wireOf(talk, reply, kind));
        if (!moves) p.say(wireOf(talk, reply, kind)); // the move goes first, so a guest hears it before this and drops this
      },
      stop: () => clearTimeout(wait),
    };
  };
  const book = channel("book", page), faction = channel("faction", page.faction ?? { open: () => null, answer: () => {} });
  p.onMembers((m) => { members = m; seat = seatOf(m, page.name(), page.id?.()); page.changed(); book.deliver(); faction.deliver(); });
  const hostSaid = (m: { from: { id: string }; text: string }, at: number | null) => {
    const w = readWire(m.text);
    if (!w || !members.some((x) => x.id === m.from.id && x.host)) return;
    (w.kind === "faction" ? faction : book).heard(w.talk, w.reply, at);
  };
  p.onGame((m) => { moves = true; hostSaid(m, null); });
  p.onSay((m) => { if (!moves) hostSaid(m, m.at); });
  p.onGone(() => { members = []; seat = null; page.changed(); });
  p.join(code);
  return {
    seat: () => seat,
    /** How many are in the party (1 alone or not joined yet). */
    size: () => Math.max(1, members.length),
    freed: book.freed, opened: book.opened, answered: book.answered,
    faction: { freed: faction.freed, opened: faction.opened, answered: faction.answered },
    leave: () => { book.stop(); faction.stop(); p.leave(); },
  };
}
