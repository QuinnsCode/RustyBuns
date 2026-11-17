// Who's in the sesh and what each may do. A leader toggles each person's play, edit, mix and lead, answers a
// raised hand Yes or No, and can hand the lead on. Everyone else sees their own grants and raises a hand for
// what they don't have. The World checks every grant (src/grants.ts); this only shows them and asks.
import { useLayoutEffect, useRef, useState } from "react";
import { nameOf, type ChatView } from "../chat.ts";
import { CANS, leaders, may, type Can, type GrantClient, type GrantServer } from "../grants.ts";
import type { Floor } from "../project.ts";
import { Icon } from "./Chat.tsx";

const WORD: Record<Can, string> = { play: "Play", edit: "Edit", mix: "Mix", lead: "Lead" };
const TIP: Record<Can, string> = {
  play: "Play into the room: notes, takes and the studio's gear", edit: "Edit the groove: notes, sounds, tempo and loops",
  mix: "Work the desk: mutes, solos, EQ, space and squash", lead: "Lead: grant the others, hold the floor, set the code",
};

export function People(props: { grants: GrantServer; floor: Floor; chat: ChatView; maker: boolean; onGrant(m: GrantClient): void }) {
  const [open, setOpen] = useState(false);
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
  const lead = may(grants, props.floor, you, props.maker, "lead");
  const heads = leaders(grants);
  const hands = Object.keys(asks).filter((id) => here.includes(id)).length;
  const can = (id: string, c: Can) => may(grants, props.floor, id, false, c);
  return (
    <span className="people-wrap">
      <button className={hands && lead ? "ghost on" : "ghost"} onClick={() => setOpen(!open)} aria-expanded={open}
        title={hands && lead ? `${hands} raised hand${hands > 1 ? "s" : ""}` : "Who's in, and what each may do"}>
        <Icon name="users" />{hands > 0 && lead ? <span className="people-n">{hands}</span> : null}
      </button>
      {open && (
        <div className="people" ref={panel} role="dialog" aria-label="People in this sesh">
          {here.map((id) => {
            const mine = id === you, isLead = heads.includes(id), asked = asks[id];
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
                    return lead && !mine && id !== grants.maker
                      ? <button key={c} className={has ? "ms on" : "ms"} aria-pressed={has} title={TIP[c]} onClick={toggle}>{WORD[c]}</button>
                      : <span key={c} className={has ? "ms on" : "ms"} title={TIP[c]}>{WORD[c]}</span>;
                  })}
                </span>
                {lead && asked && !mine && <span className="person-ask">
                  <span>Asks to {asked}</span>
                  <button className="ghost" onClick={() => props.onGrant({ t: "answer", who: id, yes: true })}>Yes</button>
                  <button className="ghost" onClick={() => props.onGrant({ t: "answer", who: id, yes: false })}>No</button>
                </span>}
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
