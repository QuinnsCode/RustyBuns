"use client";
// The board: the eqosys account chip, the week's most reacted shared reviews, one shared review as its link opens it, and
// the reactions on each. Signed in, one vote a track through Qollab (pick another icon and the first is taken back);
// signed out, one vote in all, kept by the Worker (src/board.ts).

import { useEffect, useRef, useState } from "react";
import { check, obj, str } from "@rustybuns/util/guard";
import { ICONS, type Icon, type Item } from "../board.ts";
import type { Review } from "../write.ts";
import { account, changed, useSignedIn } from "./account.ts";
import { Card } from "./Critic.tsx";
import { Glyph } from "./icons.tsx";

const LABEL: Record<Icon, string> = { flame: "Fire", laugh: "Funny", skull: "Dead" };
const GUEST_PICK = "wwfs.guestVote";

export function AccountChip() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const a = account();
    const draw = (note?: string) => slot.current && a.accountChip(slot.current, { note, onSignIn: changed, onSignOut: changed });
    // Back from eqosys (the whole page, or the small window it opened beside this one).
    void a.finishSignIn().then((r) => { draw(r?.error); if (r?.login) changed(); }, () => draw());
  }, []);
  return <div ref={slot} className="account" />;
}

interface View { items: Item[]; guestUsed: boolean }
const ViewOf = (v: unknown): View | null =>
  v && typeof v === "object" && Array.isArray((v as View).items) ? { items: (v as View).items, guestUsed: !!(v as View).guestUsed } : null;

async function load(q = ""): Promise<View | string> {
  const res = await fetch(`/api/board${q}`).catch(() => null);
  const v: unknown = await res?.json().catch(() => null);
  if (!res?.ok) return check(obj({ error: str(500) }), v)?.error ?? "The board didn't load.";
  return ViewOf(v) ?? "The board didn't load.";
}

/** Which icon a signed-in person picked on each ref (Qollab tells only them). */
function useMine(refs: string[], on: boolean) {
  const [mine, setMine] = useState<Record<string, Icon | undefined>>({});
  const key = refs.join(",");
  useEffect(() => {
    if (!on || !refs.length) return setMine({});
    void account().board().counts(refs).then((r) => {
      if (r.ok) setMine(Object.fromEntries(refs.map((ref) => [ref, ICONS.find((i) => r.value.mine[ref]?.includes(i))])));
    });
  }, [key, on]);
  return mine;
}

function Reactions({ item, mine: mineAtStart, guestUsed, onGuestVote }: { item: Item; mine?: Icon; guestUsed: boolean; onGuestVote(): void }) {
  const signedIn = useSignedIn();
  const [counts, setCounts] = useState(item.counts);
  const [guest, setGuest] = useState(item.guest);
  const [mine, setMine] = useState<Icon | undefined>(mineAtStart);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [guestPick, setGuestPick] = useState("");
  useEffect(() => setMine(mineAtStart), [mineAtStart]);
  useEffect(() => { try { setGuestPick(localStorage.getItem(GUEST_PICK) ?? ""); } catch { /* private window */ } }, []);
  const picked = signedIn ? mine : ICONS.find((i) => guestPick === `${item.ref}:${i}`);

  async function press(icon: Icon) {
    if (busy) return;
    setBusy(true); setNote("");
    try {
      if (signedIn) {
        const board = account().board();
        // One vote a track: a new icon takes the old one back first; the same icon again takes it back.
        if (mine && mine !== icon) { const r = await board.react(item.ref, mine, false); if (r.ok) setCounts(r.value.counts); }
        const r = await board.react(item.ref, icon, mine !== icon);
        if (!r.ok) return setNote(r.error);
        setCounts(r.value.counts);
        setMine(ICONS.find((i) => r.value.mine.includes(i)));
        return;
      }
      if (guestUsed) {
        const a = account();
        if (!a.canSignIn()) return setNote("That was your one vote. Signed-in voting works on the online version.");
        const r = await a.signInHere();
        if (r.login) { changed(); setNote("Signed in. Now you get one vote on every track."); } else if (r.error) setNote(r.error);
        return;
      }
      const res = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: item.ref, icon }) }).catch(() => null);
      const v: unknown = await res?.json().catch(() => null);
      if (!res?.ok) return setNote(check(obj({ error: str(500) }), v)?.error ?? "That vote didn't go through.");
      setGuestPick(`${item.ref}:${icon}`);
      try { localStorage.setItem(GUEST_PICK, `${item.ref}:${icon}`); } catch { /* private window */ }
      setGuest((v as { guest: Item["guest"] }).guest);
      onGuestVote();
    } finally {
      setBusy(false);
    }
  }

  const tip = signedIn ? "" : guestUsed ? " (sign in to vote on every track)" : " (your one guest vote)";
  return (
    <div className="reacts">
      {ICONS.map((i) => (
        <button key={i} className={`react${picked === i ? " on" : ""}`} disabled={busy} onClick={() => press(i)}
          title={`${LABEL[i]}${tip}`} aria-label={LABEL[i]} aria-pressed={picked === i}>
          <Glyph name={i} /><span>{(counts[i] ?? 0) + (guest[i] ?? 0)}</span>
        </button>
      ))}
      {note && <small className="react-note">{note}</small>}
    </div>
  );
}

const linkOf = (item: Item) => (item.review && item.post?.ref ? `/?r=${item.post.ref.slice(7)}&p=${item.ref.slice(5)}` : undefined);

/** The week's most reacted shared reviews. */
export function TopWeek() {
  const [view, setView] = useState<View | string | null>(null);
  const signedIn = useSignedIn();
  useEffect(() => { void load().then(setView); }, []);
  const items = typeof view === "object" && view ? view.items : [];
  const mine = useMine(items.map((i) => i.ref), signedIn);
  return (
    <section className="top">
      <h2>Most reacted this week</h2>
      {view === null && <p className="note">Loading the board…</p>}
      {typeof view === "string" && <p className="note">{view}</p>}
      {typeof view === "object" && view && !items.length && <p className="note">Nothing on the board this week. Get judged and post yours.</p>}
      <ol>
        {items.map((item, n) => (
          <li key={item.ref} className="top-item">
            <span className="rank">{n + 1}</span>
            <div className="top-body">
              <a href={linkOf(item)} className="top-head">
                {item.review && <b className="top-score">{item.review.score}</b>}
                <span>{item.review?.headline ?? item.post?.text}</span>
              </a>
              {item.post && <small className="by">{item.review?.verdict ? `${item.review.verdict} · ` : ""}posted by {item.post.by.name}</small>}
              <Reactions item={item} mine={mine[item.ref]} guestUsed={(view as View).guestUsed} onGuestVote={() => setView({ ...(view as View), guestUsed: true })} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One shared review, as its link (/?r=<review>&p=<post>) opens it. */
export function Shared({ id, post, review }: { id: string; post: string; review: Review }) {
  const [view, setView] = useState<View | string | null>(null);
  const signedIn = useSignedIn();
  useEffect(() => { if (post) void load(`?post=${encodeURIComponent(post)}`).then(setView); }, [post]);
  const item = typeof view === "object" && view ? view.items[0] : undefined;
  const mine = useMine(item ? [item.ref] : [], signedIn);
  return (
    <section className="shared">
      <p className="box">Someone shared this review · {review.verdict} {review.score}/10</p>
      <Card review={review} id={id} post={post} />
      {item && <Reactions item={item} mine={mine[item.ref]} guestUsed={(view as View).guestUsed} onGuestVote={() => setView({ ...(view as View), guestUsed: true })} />}
      {typeof view === "string" && <p className="note">{view}</p>}
      <a className="again" href="/">Get your own track judged</a>
    </section>
  );
}
