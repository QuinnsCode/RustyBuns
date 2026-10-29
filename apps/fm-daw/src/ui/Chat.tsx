// The sesh's chat, docked bottom right. The log scrolls inside its box; drag the top edge to
// make it taller, or widen it. Open, wide and height are yours (your profile), so they follow
// you to every sesh. The sesh's host gets a delete on each line; a deleted line stays put.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { heard, nameOf, noChat, NAME_MAX, LINE_MAX, type ChatServer, type ChatView } from "../chat.ts";
import { CHAT_MAX_H, CHAT_MIN_H, type ChatLayout, type Me } from "../profile.ts";
import { fetchMe, localMe, myKey, saveMe } from "./me.ts";
import type { Net } from "./net.ts";

/** The chat's state for App: feed it the room's chat messages, and say hello with it on each open. */
export function useChat() {
  const [view, setView] = useState<ChatView>(noChat);
  const [me, setMe] = useState<Me>(localMe);
  const meRef = useRef(me);
  meRef.current = me;
  useEffect(() => {
    let live = true;
    void fetchMe().then((got) => {
      if (!live || !got) return;
      // a name picked here before the profile store had one wins over its blank
      const local = meRef.current;
      const next = got.name || !local.name ? got : { ...got, name: local.name };
      setMe(next);
      if (next !== got) saveMe(next);
    });
    return () => { live = false; };
  }, []);
  return {
    view, me,
    update(next: Me) { setMe(next); saveMe(next); },
    onChat(m: ChatServer) { setView((v) => heard(v, m)); },
    hello: () => ({ key: myKey(), name: meRef.current.name }),
  };
}

/** The dock, wired to the room: your name goes to the room whenever it differs from what the room has. */
export function ChatDock({ chat, net, online, host }: { chat: ReturnType<typeof useChat>; net: Net | null; online: boolean; host: boolean }) {
  const { view, me } = chat;
  const roomHas = view.you ? view.names[view.you] : undefined;
  useEffect(() => {
    if (online && view.you && me.name && roomHas !== me.name) net?.chat({ t: "rename", name: me.name });
  }, [online, view.you, me.name, roomHas, net]);
  return (
    <Chat view={view} layout={me.chat} name={me.name} online={online && !!view.you} host={host}
      onSay={(text) => net?.chat({ t: "say", text })}
      onRename={(name) => chat.update({ ...me, name })}
      onUnsay={(id) => net?.chat({ t: "unsay", id })}
      onLayout={(l) => chat.update({ ...me, chat: l })} />
  );
}

const ICONS = {
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  trash: ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6"],
  wide: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  narrow: ["M4 14h6v6", "M20 10h-6V4", "M14 10l7-7", "M3 21l7-7"],
  send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
} as const;
function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** A steady colour per person, from their id. */
const hue = (who: string) => parseInt(who.slice(0, 6), 16) % 360;
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function Chat(props: {
  view: ChatView; layout: ChatLayout; name: string; online: boolean; host: boolean;
  onSay(text: string): void; onRename(name: string): void; onUnsay(id: number): void; onLayout(l: ChatLayout): void;
}) {
  const { view, layout } = props;
  const [draft, setDraft] = useState("");
  const [name, setName] = useState(props.name);
  const [h, setH] = useState(layout.h);
  const [seen, setSeen] = useState(view.lines.length ? view.lines[view.lines.length - 1].id : 0);
  const log = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  useEffect(() => setName(props.name), [props.name]);
  useEffect(() => setH(layout.h), [layout.h]);

  const last = view.lines.length ? view.lines[view.lines.length - 1].id : 0;
  useEffect(() => { if (layout.open) setSeen(last); }, [layout.open, last]);
  const unread = view.lines.filter((l) => l.id > seen && !l.deleted && l.from !== view.you).length;

  // stay on the newest line, unless you scrolled up to read
  useLayoutEffect(() => {
    const el = log.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [view.lines, layout.open, layout.wide, h]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !props.online) return;
    props.onSay(draft);
    setDraft("");
    atBottom.current = true;
  }
  function commitName() {
    const n = name.trim();
    if (n && n !== props.name) props.onRename(n);
    else setName(props.name);
  }
  function grip(e: React.PointerEvent) {
    e.preventDefault();
    const y0 = e.clientY, h0 = h;
    const max = () => Math.min(CHAT_MAX_H, window.innerHeight - 80);
    const fit = (y: number) => Math.round(Math.min(max(), Math.max(CHAT_MIN_H, h0 + y0 - y)));
    const move = (m: PointerEvent) => setH(fit(m.clientY));
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      props.onLayout({ ...layout, h: fit(u.clientY) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!layout.open) {
    return (
      <button className="chat-tab" onClick={() => props.onLayout({ ...layout, open: true })} title="Chat" aria-label={unread ? `Chat, ${unread} new` : "Chat"}>
        <Icon name="chat" />{unread > 0 && <span className="chat-badge">{unread}</span>}
      </button>
    );
  }
  return (
    <aside className={`chat${layout.wide ? " wide" : ""}`} style={{ height: h }} aria-label="Chat">
      <div className="chat-grip" onPointerDown={grip} role="separator" aria-orientation="horizontal" title="Drag to resize" />
      <header className="chat-head">
        <input className="chat-name" value={name} maxLength={NAME_MAX} placeholder="Your name" aria-label="Your name"
          onChange={(e) => setName(e.currentTarget.value)} onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(props.name); e.currentTarget.blur(); } }} />
        {props.host && <span className="chat-host" title="You started this sesh: you can delete lines">host</span>}
        <span className="spacer" />
        <button className="ghost icon-btn" onClick={() => props.onLayout({ ...layout, wide: !layout.wide })} title={layout.wide ? "Narrower" : "Wider"} aria-label={layout.wide ? "Narrower" : "Wider"}>
          <Icon name={layout.wide ? "narrow" : "wide"} />
        </button>
        <button className="ghost icon-btn" onClick={() => props.onLayout({ ...layout, open: false })} title="Close chat" aria-label="Close chat"><Icon name="x" /></button>
      </header>
      <ol className="chat-log" ref={log} aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {view.lines.length === 0 && <li className="chat-empty dim">Nobody's said anything yet.</li>}
        {view.lines.map((l) => (
          <li key={l.id} className={l.deleted ? "deleted" : undefined}>
            <span className="chat-who" style={{ color: `hsl(${hue(l.from)} 70% 62%)` }}>{l.from === view.you ? "you" : nameOf(view, l.from)}</span>
            {l.deleted ? <span className="dim">message deleted</span> : <span className="chat-text">{l.text}</span>}
            <time className="dim" dateTime={new Date(l.at).toISOString()}>{time(l.at)}</time>
            {props.host && !l.deleted && (
              <button className="ghost icon-btn chat-del" onClick={() => props.onUnsay(l.id)} title="Delete for everyone" aria-label="Delete for everyone"><Icon name="trash" /></button>
            )}
          </li>
        ))}
      </ol>
      <form className="chat-say" onSubmit={send}>
        <input value={draft} maxLength={LINE_MAX} onChange={(e) => setDraft(e.currentTarget.value)} aria-label="Message"
          placeholder={props.online ? "Say something" : "Offline: chat comes back with the room"} disabled={!props.online} />
        <button className="ghost icon-btn" disabled={!props.online || !draft.trim()} title="Send" aria-label="Send"><Icon name="send" /></button>
      </form>
    </aside>
  );
}
