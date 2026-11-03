// The Qollab spaces panel, shared by every page that signs in through eqosys (apps/eqosys/src/space.ts, QOLLAB.md#spaces):
// your spaces, make one, join by invite; inside one, channel tabs, the messages with "Load older", a text box and who is
// online. The owner also adds channels, copies the invite, and mutes or kicks from a member's row. The party lobby's
// sibling (./lobby.ts). Plain DOM with `rb-spaces*` classes and no styles of its own: the page skins it, and hands over
// its icons (lucide, say) so this package keeps no dependencies.
import type { SpaceMessage, SpaceRow, space } from "./eqosys.ts";

/** The icons the panel asks for, by lucide name. */
export type SpaceIcon = "arrow-left" | "arrow-up" | "plus" | "log-in" | "send" | "copy" | "hash" | "mic-off" | "mic" | "user-x" | "flag" | "log-out";

export interface SpacesPanel {
  box: HTMLElement;
  space: ReturnType<typeof space>;
  /** The signed-in name, so your own row has no mute or kick. */
  name: () => string | undefined;
  /** An icon element for a lucide name; the panel puts the word beside it as a title. */
  icon: (name: SpaceIcon) => Element;
  /** Told when something worth a note happened (an invite was copied). */
  say?: (note: string) => void;
}

/** What the panel is showing, for a harness: the list of spaces, or one space, its channel and messages. */
export interface SpacesState { open: string | null; spaces: string[]; channel: string; channels: string[]; messages: string[]; online: string[]; note: string; more: boolean }

/**
 * Keep `box` showing this person's spaces. Returns the panel's handle: `state()` for a harness, `close()` to hang up
 * and hide it. Keys typed in the panel stop at the box, so a game's own keys don't fire while someone writes.
 */
export function spacesPanel({ box, space: sp, name, icon, say }: SpacesPanel) {
  let rows: SpaceRow[] = [], open: SpaceRow | null = null, note = "";
  let channels: string[] = [], channel = "general", owner = false, online: { id: string; name: string }[] = [];
  const msgs = new Map<string, SpaceMessage[]>(), more = new Map<string, boolean>(), muted = new Set<string>();
  box.classList.add("rb-spaces");
  for (const k of ["keydown", "keyup", "keypress"]) box.addEventListener(k, (e) => e.stopPropagation());

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...kids: (Node | string)[]) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const btn = (glyph: SpaceIcon, text: string, on: () => void, show = false, cls = "") => {
    const b = el("button", { type: "button", title: text, ariaLabel: text, className: cls }, icon(glyph), ...(show ? [text] : []));
    b.addEventListener("click", on);
    return b;
  };
  /** A one-line form: a box and its button. */
  const line = (placeholder: string, max: number, glyph: SpaceIcon, text: string, go: (v: string) => unknown) => {
    const input = el("input", { placeholder, maxLength: max, ariaLabel: placeholder });
    const form = el("form", { className: "rb-spaces-line" }, input, el("button", { type: "submit", title: text, ariaLabel: text }, icon(glyph)));
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ""; void go(v); } });
    return form;
  };
  const noteEl = () => (note ? el("p", { className: "rb-spaces-note", role: "status" }, note) : "");

  async function list() {
    rows = (await sp.mine()) ?? [];
    if (!open) draw();
  }
  function enter(row: SpaceRow) {
    open = row; channel = "general"; channels = []; online = []; owner = row.owner; note = "";
    msgs.clear(); more.clear();
    sp.open(row.id, {
      space: (s) => { channels = s.channels; owner = s.owner; open = open && { ...open, name: s.name }; if (!channels.includes(channel)) channel = channels[0] ?? "general"; if (!msgs.has(channel)) sp.history(channel); draw(); },
      online: (m) => { online = m; draw(); },
      said: (ch, m) => { add(ch, [m]); if (ch === channel) draw(); },
      history: (ch, m, mo) => { add(ch, m); more.set(ch, mo); if (ch === channel) draw(); },
      refused: (why) => { note = why; draw(); },
      reported: (r) => { note = `${r.by} reported ${r.name}`; draw(); },
      gone: (why) => { open = null; note = why; void list(); draw(); },
    });
    draw();
  }
  /** Messages keep their channel number, so a page of history and a live line merge in order without repeats. */
  function add(ch: string, m: SpaceMessage[]) {
    const byId = new Map((msgs.get(ch) ?? []).map((x) => [x.id, x]));
    for (const x of m) byId.set(x.id, x);
    msgs.set(ch, [...byId.values()].sort((a, b) => a.id - b.id));
  }
  const back = () => { sp.close(); open = null; note = ""; void list(); draw(); };
  const copy = (invite: string) => void navigator.clipboard?.writeText(invite).then(() => { note = `Invite ${invite} copied`; say?.(note); draw(); }, () => {});
  const tab = (ch: string) => { channel = ch; if (!msgs.has(ch)) sp.history(ch); draw(); };

  function drawList() {
    const items = rows.map((r) => {
      const b = el("button", { type: "button", className: "rb-spaces-row" }, icon("hash"), r.name);
      b.addEventListener("click", () => enter(r));
      return el("li", {}, b, ...(r.invite ? [btn("copy", `Copy invite ${r.invite}`, () => copy(r.invite!))] : []));
    });
    return [
      el("h2", {}, "Spaces"),
      items.length ? el("ul", { className: "rb-spaces-list" }, ...items) : el("p", { className: "rb-spaces-empty" }, "No spaces yet. Make one, or join with an invite."),
      line("Name a new space", 60, "plus", "Make space", async (v) => {
        const made = await sp.make(v);
        if (!made) { note = "Couldn't make that space. Sign in again, or try in a minute."; draw(); return; }
        await list();
        const row = rows.find((r) => r.id === made.id);
        if (row) enter(row);
      }),
      line("Invite code", 12, "log-in", "Join with invite", async (v) => {
        const got = await sp.join(v);
        if (!got) { note = "No space has that invite."; draw(); return; }
        await list();
        enter(rows.find((r) => r.id === got.id) ?? { id: got.id, name: got.name, owner: false });
      }),
      noteEl(),
    ];
  }

  function drawSpace(row: SpaceRow) {
    const head = el("header", { className: "rb-spaces-head" },
      btn("arrow-left", "All spaces", back),
      el("h2", {}, row.name),
      ...(owner && row.invite ? [btn("copy", `Copy invite ${row.invite}`, () => copy(row.invite!))] : []),
      btn("log-out", "Leave this space", () => { sp.leave(); back(); }));
    const tabs = el("nav", { className: "rb-spaces-tabs", role: "tablist" }, ...channels.map((ch) => {
      const b = el("button", { type: "button", role: "tab", ariaSelected: String(ch === channel), className: ch === channel ? "on" : "" }, `#${ch}`);
      b.addEventListener("click", () => tab(ch));
      return b;
    }));
    if (owner) tabs.append(line("new-channel", 24, "plus", "Add channel", (v) => sp.channel(v.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))));
    const shown = msgs.get(channel) ?? [];
    const log = el("ol", { className: "rb-spaces-log", ariaLive: "polite" }, ...shown.map((m) =>
      el("li", {}, el("b", {}, m.from.name), " ", m.text)));
    const older = more.get(channel) && shown[0] ? btn("arrow-up", "Load older", () => sp.history(channel, shown[0]!.id), true, "rb-spaces-older") : "";
    const me = name();
    const who = el("ul", { className: "rb-spaces-online", ariaLabel: "Online" }, ...online.map((m) => el("li", {}, m.name, ...(m.name === me ? [] : owner
      ? [btn(muted.has(m.id) ? "mic" : "mic-off", muted.has(m.id) ? `Unmute ${m.name}` : `Mute ${m.name}`, () => { const on = !muted.has(m.id); if (on) muted.add(m.id); else muted.delete(m.id); sp.mute(m.id, on); draw(); }),
        btn("user-x", `Kick ${m.name}`, () => sp.kick(m.id))]
      : [btn("flag", `Report ${m.name}`, () => { sp.report(m.id); note = `Reported ${m.name}`; draw(); })]))));
    const typed = line(`Message #${channel}`, 280, "send", "Send", (v) => sp.say(channel, v));
    return [head, tabs, el("div", { className: "rb-spaces-body" }, el("div", { className: "rb-spaces-chat" }, older, log), who), typed, noteEl()];
  }

  function draw() {
    // A line or a page arriving redraws the panel: whatever someone was typing stays, with the caret where it was.
    const typing = new Map([...box.querySelectorAll("input")].map((i) => [i.placeholder, i.value]));
    const was = document.activeElement instanceof HTMLInputElement && box.contains(document.activeElement) ? document.activeElement : null;
    box.replaceChildren(...(open ? drawSpace(open) : drawList()));
    for (const i of box.querySelectorAll("input")) i.value = typing.get(i.placeholder) ?? "";
    const log = box.querySelector(".rb-spaces-log");
    if (log) log.scrollTop = log.scrollHeight;
    if (was) { const now = [...box.querySelectorAll("input")].find((i) => i.placeholder === was.placeholder); now?.focus(); now?.setSelectionRange(was.selectionStart, was.selectionEnd); }
  }

  box.hidden = false;
  draw();
  void list();
  return {
    state: (): SpacesState => ({ open: open?.name ?? null, spaces: rows.map((r) => r.name), channel, channels, messages: (msgs.get(channel) ?? []).map((m) => `${m.from.name}: ${m.text}`), online: online.map((m) => m.name), note, more: more.get(channel) ?? false }),
    close: () => { sp.close(); box.hidden = true; },
  };
}
