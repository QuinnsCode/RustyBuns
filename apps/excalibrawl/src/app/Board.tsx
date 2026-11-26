"use client";
// The board: the eqosys account chip, the box to post a prompt, this hour's prompts with their reactions (the most
// reacted is the next fight's), and the reactions on the fight in the arena. One pick a thing, as on What Would Fantano
// Say: another icon takes the first back, the same one again takes it back. Signed out, a press or a post signs in beside
// the page first, so the fight keeps playing.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Post } from "@rustybuns/util/board";
import { ICONS, PROMPT_MAX, drawable, hourStart, postRef, type Icon } from "../board.ts";
import { account, changed, signedIn, useSignedIn } from "./account.ts";
import { Glyph } from "./icons.tsx";
import COPY from "../../content/first-screen.json";

const LABEL: Record<Icon, string> = { flame: "Fire", laugh: "Funny", skull: "Dead" };

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

/** A thing's counts by icon, and the one the reader picked (signed in only). */
interface Seen { counts: Partial<Record<Icon, number>>; mine?: Icon }
const seenOf = (counts: Record<string, number> | undefined, mine: string[] | undefined): Seen => ({
  counts: Object.fromEntries(ICONS.filter((i) => counts?.[i]).map((i) => [i, counts![i]!])),
  mine: ICONS.find((i) => mine?.includes(i)),
});

/** Qollab's counts for some things, in one call; again when someone signs in or out. */
function useCounts(refs: string[], on: boolean): Record<string, Seen> {
  const [seen, setSeen] = useState<Record<string, Seen>>({});
  const key = `${refs.join(",")}|${on}`;
  useEffect(() => {
    if (!refs.length) return setSeen({});
    let live = true;
    void account().board().counts(refs).then((r) => {
      if (live && r.ok) setSeen(Object.fromEntries(refs.map((ref) => [ref, seenOf(r.value.counts[ref], r.value.mine[ref])])));
    });
    return () => { live = false; };
  }, [key]);
  return seen;
}

export function Reactions({ thing, seen }: { thing: string; seen?: Seen }) {
  const [now, setNow] = useState<Seen>(seen ?? { counts: {} });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (seen) setNow(seen); }, [seen]);

  async function press(icon: Icon) {
    if (busy) return;
    setBusy(true); setNote("");
    try {
      if (!(await signedIn(setNote))) return;
      const board = account().board();
      let mine = now.mine;
      if (mine && mine !== icon) {
        const r = await board.react(thing, mine, false);
        if (r.ok) { mine = undefined; setNow(seenOf(r.value.counts, r.value.mine)); }
      }
      const r = await board.react(thing, icon, mine !== icon);
      if (!r.ok) return setNote(r.error);
      setNow(seenOf(r.value.counts, r.value.mine));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reacts">
      {ICONS.map((i) => (
        <button key={i} type="button" className={`react${now.mine === i ? " on" : ""}`} disabled={busy} onClick={() => press(i)}
          title={LABEL[i]} aria-label={LABEL[i]} aria-pressed={now.mine === i}>
          <Glyph name={i} /><span>{now.counts[i] ?? 0}</span>
        </button>
      ))}
      {note && <small className="react-note">{note}</small>}
    </div>
  );
}

/** The reactions on the fight in the arena (`fight:<id>`); none on the sample. */
export function FightReactions({ thing }: { thing: string | null }) {
  const on = useSignedIn();
  const seen = useCounts(thing ? [thing] : [], on);
  if (!thing) return null;
  return <div className="fight-reacts"><Reactions key={thing} thing={thing} seen={seen[thing]} /></div>;
}

/** This hour's prompt posts, most reacted first: the top one is what the next live fight draws. */
export function Prompts() {
  const on = useSignedIn();
  const [posts, setPosts] = useState<Post[] | string | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState<string[]>([]);

  const load = async () => {
    const r = await account().board().list("prompt", { top: hourStart(Date.now()) });
    setPosts(r.ok ? r.value.filter(drawable) : r.error);
  };
  // Again each minute (a new hour empties it) and when someone signs in or out (their blocks leave the list).
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [on]);
  const list = Array.isArray(posts) ? posts : [];
  const seen = useCounts(list.map((p) => postRef(p.id)), on);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setNote("");
    try {
      if (!(await signedIn(setNote))) return;
      const r = await account().board().post("prompt", t);
      if (!r.ok) return setNote(r.error);
      setText("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function report(id: string) {
    if (!(await signedIn(setNote))) return;
    const r = await account().board().report(id);
    if (r.ok) setReported((x) => [...x, id]); else setNote(r.error);
  }

  return (
    <section className="ask">
      <h2>{COPY.askTitle}</h2>
      <p className="sub">{COPY.askSub}</p>
      <form className="ask-box" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={PROMPT_MAX} placeholder={COPY.askPlaceholder}
          aria-label={COPY.askTitle} disabled={busy} />
        <button type="submit" disabled={busy || !text.trim()}>{COPY.askPost}</button>
      </form>
      {note && <p className="note">{note}</p>}
      {posts === null && <p className="note">{COPY.askLoading}</p>}
      {typeof posts === "string" && <p className="note">{posts}</p>}
      {Array.isArray(posts) && !list.length && <p className="note">{COPY.askNone}</p>}
      <ol className="prompts">
        {list.map((p, n) => (
          <li key={p.id} className={n === 0 ? "lead" : ""}>
            <div className="prompt-head">
              <strong>{p.text}</strong>
              {n === 0 && <span className="tag">{COPY.askLead}</span>}
            </div>
            <small className="by">{p.by.name}</small>
            <div className="prompt-acts">
              <Reactions thing={postRef(p.id)} seen={seen[postRef(p.id)]} />
              {/* Qollab turns away a report on your own post, with the reason as the note. */}
              {reported.includes(p.id)
                ? <small className="by">{COPY.askReported}</small>
                : <button type="button" className="report" title={COPY.askReport} aria-label={COPY.askReport} onClick={() => report(p.id)}><Glyph name="flag" size={16} /></button>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
