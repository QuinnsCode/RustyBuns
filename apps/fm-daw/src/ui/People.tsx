// Who's in the sesh and what each may do. A leader toggles each person's play, edit, mix and lead, answers a
// raised hand Yes or No, and can hand the lead on. Everyone else sees their own grants and raises a hand for
// what they don't have. The World checks every grant (src/grants.ts); this only shows them and asks.
// Guest list opens the sesh's guest list (@rustybuns/util/guest-panel, src/guest-list.ts): invites, roles, blocks and its log.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { guestPanel, type GuestPanel } from "@rustybuns/util/guest-panel";
import { can as listCan, type Acted, type GuestAct, type GuestList } from "@rustybuns/util/guests";
import { mayHere, SKIN, STUDIO_PERMS } from "../guest-list.ts";
import { nameOf, type ChatView } from "../chat.ts";
import { TRACKS } from "../engine/params.ts";
import { CANS, leaders, playTracks, type Can, type GrantClient, type GrantServer } from "../grants.ts";
import type { Floor } from "../project.ts";
import { Icon } from "./Chat.tsx";

const WORD: Record<Can, string> = { play: "Play", edit: "Edit", mix: "Mix", lead: "Lead" };
const TIP: Record<Can, string> = {
  play: "Play into the room: notes, takes and the studio's gear (off, pick the tracks they may play)", edit: "Edit the groove: notes, sounds, tempo and loops",
  mix: "Work the desk: mutes, solos, EQ, space and squash", lead: "Lead: grant the others, hold the floor, set the code",
};

export function People(props: {
  grants: GrantServer; guests: GuestList | null; floor: Floor; chat: ChatView; maker: boolean; onGrant(m: GrantClient): void; onGuest(a: GuestAct): Promise<Acted>;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  // the panel opens from the button; where the status bar wraps the button far right on a phone, slide it back on screen
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    el.style.left = "0px";
    const r = el.getBoundingClientRect(), gutter = 16;
    const over = r.right - (innerWidth - gutter);
    if (over > 0) el.style.left = `${-Math.min(over, r.left - gutter)}px`;
  });
  const { grants, asks, here } = props.grants;
  const you = props.chat.you ?? undefined;
  const lead = mayHere(props.guests, grants, props.floor, you, props.maker, "lead");
  const blocker = !!you && !!props.guests && listCan(props.guests, you, "block");
  const heads = leaders(grants);
  const hands = Object.keys(asks).filter((id) => here.includes(id)).length;
  const can = (id: string, c: Can) => mayHere(props.guests, grants, props.floor, id, false, c);
  return (
    <span className="people-wrap">
      <button className={hands && lead ? "ghost on" : "ghost"} onClick={() => setOpen(!open)} aria-expanded={open}
        title={hands && lead ? `${hands} raised hand${hands > 1 ? "s" : ""}` : "Who's in, and what each may do"}>
        <Icon name="users" />{hands > 0 && lead ? <span className="people-n">{hands}</span> : null}
      </button>
      {open && (
        <div className="people" ref={panel} role="dialog" aria-label="People in this sesh">
          {props.guests && you && <button className={list ? "ghost tiny on" : "ghost tiny"} aria-pressed={list} onClick={() => setList(!list)}
            title="The guest list: invite people in as a role, take them off, block them, and see who did what">Guest list</button>}
          {list && props.guests && you && <GuestBox me={you} list={props.guests} send={props.onGuest} />}
          {here.map((id) => {
            const mine = id === you, isLead = heads.includes(id), asked = asks[id];
            // someone on the guest list has their role's grants: the list changes them, not these toggles
            const listed = !!props.guests?.guests[id];
            return (
              <div className="person" key={id}>
                <span className="person-name">
                  {isLead && <span title="Leads this sesh"><Icon name="crown" /></span>}
                  {nameOf(props.chat, id)}{mine ? " (you)" : ""}
                  {asked && <span className="warn-text" title={`Asks to ${asked}`}><Icon name="hand" /></span>}
                </span>
                <span className="person-cans">
                  {CANS.map((c) => {
                    const has = isLead || can(id, c);
                    const toggle = () => {
                      const now = CANS.filter((x) => x !== "lead" && can(id, x));
                      props.onGrant({ t: "grant", who: id, can: has ? now.filter((x) => x !== c) : [...now, c] });
                    };
                    return lead && !mine && id !== grants.maker && !listed
                      ? <button key={c} className={has ? "ms on" : "ms"} aria-pressed={has} title={TIP[c]} onClick={toggle}>{WORD[c]}</button>
                      : <span key={c} className={has ? "ms on" : "ms"} title={TIP[c]}>{WORD[c]}</span>;
                  })}
                </span>
                {!isLead && !can(id, "play") && (lead && !mine && id !== grants.maker || playTracks(grants, id)) && (() => {
                  // no whole-seat play: the leader picks the tracks they may play, one toggle a track
                  const some = playTracks(grants, id) ?? [];
                  const now = CANS.filter((x) => x !== "lead" && can(id, x));
                  const pick = (t: number) => props.onGrant({ t: "grant", who: id, can: now, tracks: some.includes(t) ? some.filter((x) => x !== t) : [...some, t] });
                  return (
                    <span className="person-tracks" role="group" aria-label="Tracks they may play">
                      {Array.from({ length: TRACKS }, (_, t) => {
                        const on = some.includes(t), tip = `${on ? "Plays" : "Let them play"} track ${t + 1}`;
                        return lead && !mine
                          ? <button key={t} className={on ? "ms on" : "ms"} aria-pressed={on} title={tip} onClick={() => pick(t)}>{t + 1}</button>
                          : on ? <span key={t} className="ms on" title={`Plays track ${t + 1}`}>{t + 1}</span> : null;
                      })}
                    </span>
                  );
                })()}
                {lead && asked && !mine && <span className="person-ask">
                  <span>Asks to {asked}</span>
                  <button className="ghost" onClick={() => props.onGrant({ t: "answer", who: id, yes: true })}>Yes</button>
                  <button className="ghost" onClick={() => props.onGrant({ t: "answer", who: id, yes: false })}>No</button>
                </span>}
                {blocker && !mine && id !== props.guests?.owner && <button className="ghost tiny" title={`Block ${nameOf(props.chat, id)}: they leave now and can't come back`}
                  onClick={() => void props.onGuest({ t: "block", who: id })}><Icon name="ban" /></button>}
                {lead && !mine && !isLead && <button className="ghost tiny" title="Hand the lead to them: they lead, you don't"
                  onClick={() => props.onGrant({ t: "handOn", who: id })}>Hand on</button>}
                {mine && !lead && <span className="person-ask">
                  {CANS.filter((c) => !can(id, c) && c !== asked).map((c) => (
                    <button key={c} className="ghost tiny" title={`Raise your hand to ${c}`} onClick={() => props.onGrant({ t: "ask", can: c })}>
                      <Icon name="hand" /> {WORD[c]}
                    </button>
                  ))}
                  {asked && <span className="dim">Asked to {asked}</span>}
                </span>}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}

/** The guest panel, mounted once and handed each list the World sends. */
function GuestBox(props: { me: string; list: GuestList; send(a: GuestAct): Promise<Acted> }) {
  const box = useRef<HTMLDivElement>(null), panel = useRef<GuestPanel | null>(null);
  const send = useRef(props.send);
  send.current = props.send;
  useEffect(() => {
    if (!box.current) return;
    const p = guestPanel(box.current, { me: props.me, list: props.list, send: (a) => send.current(a), perms: STUDIO_PERMS, skin: SKIN, title: "Guest list" });
    panel.current = p;
    return () => { p.close(); panel.current = null; };
  }, [props.me]);
  useEffect(() => { panel.current?.set(props.list); }, [props.list]);
  return <div className="people-guests" ref={box} />;
}
