// The jam room's one social panel (#6551): invite people, friends and friend requests, and the sesh's chat, behind one
// symbol on the HUD. Nothing new on a server: the invite link is the door's, friends and requests are eqosys's hub
// (a request is answered on eqosys's own page), and the chat is the sesh's own (src/chat.ts), as the sesh page keeps it.
// Signed out, the link and the chat still work, and one line says what needs signing in.
import "./social.css";
import type { HubView, hub } from "@rustybuns/util/eqosys";
import { heard, LINE_MAX, nameOf, noChat, type ChatServer } from "../chat.ts";
import { friendOrder, invitesIn } from "./door.ts";

export interface SocialDeps {
  app: string;
  hub: ReturnType<typeof hub>;
  /** The hub as the page last read it, and a fresh read. */
  view(): HubView | null;
  refresh(): Promise<void>;
  link(): string;
  signedIn(): boolean;
  /** Whether eqosys is on here at all (not on the desktop). */
  canSignIn(): boolean;
  signIn(): void;
  /** Ask a friend into this room, and how each ask went. */
  invite(id: string): Promise<void>;
  asked: ReadonlyMap<string, string>;
  send(text: string): void;
  online(): boolean;
  /** The panel is opening: the room lets go of the mouse and any held notes. */
  opened(): void;
}

// lucide (ISC): users, x, link, share-2, user-plus, log-in, send, check
const PATHS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  friend: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  signIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const svg = (name: keyof typeof PATHS) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}
/** A button that is a symbol, with its words for a screen reader and a hover. */
function symbol(name: keyof typeof PATHS, words: string, act: () => void, id = "") {
  const b = el("button", { type: "button", className: "social-symbol", title: words, innerHTML: svg(name), id });
  b.setAttribute("aria-label", words);
  b.addEventListener("click", act);
  return b;
}

export function mountSocial(d: SocialDeps) {
  let chat = noChat(), unread = 0, open = false;
  const badge = el("span", { className: "social-badge", hidden: true });
  const button = el("button", { type: "button", id: "social-open", className: "hud-symbol", title: "People: invite, chat, friends", hidden: true, innerHTML: svg("users") });
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-expanded", "false");
  button.append(badge);

  const note = el("p", { className: "social-note" });
  note.setAttribute("role", "status");
  const copy = (text: string, done: string) => navigator.clipboard?.writeText(text).then(() => { note.textContent = done; }, () => { note.textContent = text; });
  const invite = el("div", { className: "social-row" },
    symbol("link", "Copy this room's link", () => void copy(d.link(), "Room link copied"), "social-link"),
  );
  if (typeof navigator.share === "function") invite.append(symbol("share", "Share this room", () => void navigator.share({ url: d.link() }).catch(() => {})));
  const myLink = symbol("friend", "Copy my friend link: whoever opens it becomes your friend", () => void d.hub.friendLink().then((l) => (l ? copy(l, "Friend link copied") : void (note.textContent = "eqosys can't be reached"))), "social-friend-link");
  const signIn = symbol("signIn", "Sign in with eqosys", () => d.signIn(), "social-sign-in");
  invite.append(myLink, signIn);

  const people = el("ul", { className: "social-people" });
  const log = el("ol", { className: "social-log" });
  log.setAttribute("aria-live", "polite");
  const input = el("input", { maxLength: LINE_MAX, autocomplete: "off", enterKeyHint: "send" });
  input.setAttribute("aria-label", "Message");
  const send = el("button", { className: "social-symbol", title: "Send", innerHTML: svg("send") });
  send.setAttribute("aria-label", "Send");
  const form = el("form", { className: "social-say" }, input, send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim() || !d.online() || !chat.you) return;
    d.send(input.value);
    input.value = "";
  });
  const panel = el("section", { id: "social", hidden: true },
    el("header", {}, invite, symbol("x", "Close", () => set(false))),
    note, people, log, form);
  panel.setAttribute("aria-label", "People");
  // what you type here is words, not the room's keys (WASD, Space); a browser or menu shortcut still gets through
  for (const type of ["keydown", "keyup"] as const) panel.addEventListener(type, (e) => {
    if (e.key === "Escape") set(false);
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  });

  /** A person's row: who, and the one thing to do about them. */
  const row = (who: string, small: string, act: Node) => el("li", {}, el("span", {}, who, el("small", {}, small)), act);
  const away = (href: string, words: string, name: keyof typeof PATHS) => {
    const a = el("a", { href, target: "_blank", rel: "noopener", className: "social-symbol", title: words, innerHTML: svg(name) });
    a.setAttribute("aria-label", words);
    return a;
  };
  function drawPeople() {
    const signed = d.signedIn(), view = signed ? d.view() : null;
    myLink.hidden = !signed;
    signIn.hidden = signed || !d.canSignIn();
    const rows: Node[] = [];
    if (!signed) rows.push(el("li", { className: "social-need" }, d.canSignIn() ? "Sign in to invite friends and see friend requests. The link and chat work now." : "Friends need eqosys, which isn't on here. The link and chat work."));
    else if (!view) rows.push(el("li", { className: "social-need" }, "eqosys can't be reached yet"));
    else {
      // who asked to be your friend: yes or no is eqosys's page's to take
      const friends = new Set(view.friends.map((f) => f.id)), asks = new Map(view.notes.filter((n) => n.kind === "ask" && !friends.has(n.from.id)).map((n) => [n.from.id, n.from.name]));
      for (const name of asks.values()) rows.push(row(name || "Someone", "wants to be friends", away(d.hub.friendsPage(), "Answer: yes or no, on eqosys", "check")));
      for (const i of invitesIn(view.notes, d.app, location.origin).slice(0, 3)) {
        const go = away(i.link, `Go to ${i.name || i.room}`, "signIn");
        go.target = "_self";
        rows.push(row(i.from, `asks you into ${i.name || i.room}`, go));
      }
      for (const f of friendOrder(view.friends, d.app)) {
        const st = d.asked.get(f.id);
        const b = symbol(st === "sent" ? "check" : "send", st === "sent" ? "Invited" : st && st !== "sending" ? `Try again: ${st}` : `Invite ${f.name || "a friend"} here`, () => { void d.invite(f.id).then(drawPeople); drawPeople(); });
        b.disabled = st === "sent" || st === "sending";
        rows.push(row(f.name || "A friend", f.here ? "in Qollab Studio" : "", b));
      }
      if (!view.friends.length) rows.push(row("No friends yet", "", away(d.hub.friendsPage(), "Add friends on eqosys", "friend")));
    }
    people.replaceChildren(...rows);
  }
  function drawChat() {
    const online = d.online() && !!chat.you;
    input.disabled = send.disabled = !online;
    input.placeholder = online ? "Say something" : "Chat comes with the room";
    log.replaceChildren(...chat.lines.filter((l) => !l.deleted).slice(-60).map((l) =>
      el("li", { className: l.from === chat.you ? "mine" : "" }, el("b", {}, l.from === chat.you ? "You" : nameOf(chat, l.from)), " ", l.text)));
    log.scrollTop = log.scrollHeight;
  }
  function drawBadge() { badge.hidden = !unread; badge.textContent = unread > 9 ? "9+" : String(unread); }
  function set(to = !open) {
    if (to === open) return open;
    open = to;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (!open) { input.blur(); return open; }
    d.opened();
    unread = 0; note.textContent = "";
    drawBadge(); drawPeople(); drawChat();
    void d.refresh().then(drawPeople);
    return open;
  }
  button.addEventListener("click", () => { set(); button.blur(); });
  document.body.append(button, panel);

  return {
    /** One chat message from the room. */
    heard(m: ChatServer) {
      chat = heard(chat, m);
      if (!open && m.t === "line" && m.line.from !== chat.you) { unread++; drawBadge(); }
      if (open) drawChat();
    },
    /** The symbol is on the HUD only while you're in the room. */
    show(to: boolean) { button.hidden = !to; if (!to) set(false); },
    open: set,
    isOpen: () => open,
    state: () => ({ open, unread, lines: chat.lines.filter((l) => !l.deleted).map((l) => ({ who: nameOf(chat, l.from), mine: l.from === chat.you, text: l.text })) }),
  };
}
