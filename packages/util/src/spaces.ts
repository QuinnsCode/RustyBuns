// The Qollab spaces panel, shared by every page that signs in through eqosys (apps/eqosys/src/space.ts, QOLLAB.md#spaces):
// your spaces, make one, join by invite; inside one, channel tabs, the messages with "Load older", a text box and who is
// online. Voice channels (QLAVE.md) join Qlave through ./voice.ts and list who is in them and who is talking. The owner
// also adds and deletes channels, copies the invite, and mutes or kicks from a member's row. The party lobby's
// sibling (./lobby.ts). Plain DOM with `rb-spaces*` classes in the page's eqosys skin (./skin.ts); the page places the
// box and hands over its icons (lucide, say) so this package keeps no dependencies.
import type { SpaceMember, SpaceMessage, SpaceRow, SpaceVoice, space } from "./eqosys.ts";
import { join as joinVoice, type Speaker, type VoiceHandle } from "./voice.ts";
import { wearSkin } from "./skin.ts";

/** What the panel uses of a joined voice room: `join`'s handle without its debug `call`. */
export type VoiceCall = Omit<VoiceHandle, "call">;

/** The icons the panel asks for, by lucide name. */
export type SpaceIcon = "arrow-left" | "arrow-up" | "plus" | "log-in" | "send" | "copy" | "hash" | "mic-off" | "mic" | "user-x" | "flag" | "log-out"
  | "volume-2" | "phone-off" | "trash-2";

export interface SpacesPanel {
  box: HTMLElement;
  space: ReturnType<typeof space>;
  /** The signed-in name, so your own row has no mute or kick. */
  name: () => string | undefined;
  /** An icon element for a lucide name; the panel puts the word beside it as a title. */
  icon: (name: SpaceIcon) => Element;
  /** Told when something worth a note happened (an invite was copied). */
  say?: (note: string) => void;
  /** How a voice channel is joined: Qlave's client by default; a harness passes one with a fake microphone. */
  join?: (url: string, ticket: string) => Promise<VoiceCall>;
}

/** What the panel is showing, for a harness: the list of spaces, or one space, its channel and messages. */
export interface SpacesState {
  open: string | null; spaces: string[]; channel: string; channels: string[]; messages: string[]; online: string[]; note: string; more: boolean;
  /** Voice channels by name, the one this page is in, and who Qlave says is in it ("Ada", "Ada (muted)", "Ada (talking)"). */
  voices: string[]; inVoice: string | null; speakers: string[];
}

/**
 * Keep `box` showing this person's spaces. Returns the panel's handle: `state()` for a harness, `close()` to hang up
 * and hide it. Keys typed in the panel stop at the box, so a game's own keys don't fire while someone writes.
 */
export function spacesPanel({ box, space: sp, name, icon, say, join = joinVoice }: SpacesPanel) {
  let rows: SpaceRow[] = [], open: SpaceRow | null = null, note = "";
  let channels: string[] = [], channel = "general", owner = false, online: SpaceMember[] = [];
  // Voice: the channels, the one this page is in (or asked to join), its handle once Qlave let us in, who is in it, our own mute.
  let voices: SpaceVoice[] = [], talkingIn: SpaceVoice | null = null, call: VoiceCall | null = null, speakers: Speaker[] = [], selfMuted = false;
  const msgs = new Map<string, SpaceMessage[]>(), more = new Map<string, boolean>(), muted = new Set<string>();
  wearSkin();
  box.classList.add("eq", "rb-spaces");
  for (const k of ["keydown", "keyup", "keypress"]) box.addEventListener(k, (e) => e.stopPropagation());

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...kids: (Node | string)[]) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const btn = (glyph: SpaceIcon, text: string, on: () => void, show = false, cls = "") => {
    const b = el("button", { type: "button", title: text, ariaLabel: text, className: `eq-btn${show ? "" : " icon"}${cls ? ` ${cls}` : ""}` }, icon(glyph), ...(show ? [text] : []));
    b.addEventListener("click", on);
    return b;
  };
  /** A one-line form: a box and its button. */
  const line = (placeholder: string, max: number, glyph: SpaceIcon, text: string, go: (v: string) => unknown) => {
    const input = el("input", { placeholder, maxLength: max, ariaLabel: placeholder });
    const form = el("form", { className: "rb-spaces-line" }, input, el("button", { type: "submit", title: text, ariaLabel: text, className: "eq-btn icon" }, icon(glyph)));
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ""; void go(v); } });
    return form;
  };
  const noteEl = () => (note ? el("p", { className: "rb-spaces-note", role: "status" }, note) : "");

  async function list() {
    rows = (await sp.mine()) ?? [];
    if (!open) draw();
  }
  function enter(row: SpaceRow) {
    hangUp();
    open = row; channel = "general"; channels = []; voices = []; online = []; owner = row.owner; note = "";
    msgs.clear(); more.clear();
    sp.open(row.id, {
      space: (s) => {
        channels = s.channels; voices = s.voice; owner = s.owner; open = open && { ...open, name: s.name };
        if (talkingIn && !voices.some((v) => v.id === talkingIn!.id)) hangUp();
        if (!channels.includes(channel) && !voices.some((v) => v.id === channel)) channel = channels[0] ?? "general";
        if (channels.includes(channel) && !msgs.has(channel)) sp.history(channel);
        draw();
      },
      ticket: (ch, url, t) => void talk(ch, url, t),
      online: (m) => { online = m; draw(); },
      said: (ch, m) => { add(ch, [m]); if (ch === channel) draw(); },
      history: (ch, m, mo) => { add(ch, m); more.set(ch, mo); if (ch === channel) draw(); },
      refused: (why) => { note = why; draw(); },
      reported: (r) => { note = `${r.by} reported ${r.name}`; draw(); },
      gone: (why) => { hangUp(); open = null; note = why; void list(); draw(); },
    });
    draw();
  }

  /** Qlave let us in with this ticket: play the room, list who is in it, and tell the space. */
  async function talk(ch: string, url: string, t: string) {
    const v = voices.find((x) => x.id === ch);
    if (!v || talkingIn?.id !== ch || call) return;
    try {
      const h = await join(url, t);
      if (talkingIn?.id !== ch) { h.leave(); return; }
      call = h; selfMuted = false;
      h.onSpeakers((list) => { speakers = list; draw(); });
      h.onGone((why) => {
        call = null; talkingIn = null; speakers = [];
        sp.inVoice();
        note = why === "kicked" ? "You were taken out of voice." : why === "ended" ? "That voice channel ended." : "Voice lost its connection.";
        draw();
      });
      sp.inVoice(ch);
    } catch (e) {
      talkingIn = null;
      note = e instanceof Error && /Permission|NotAllowed/i.test(`${e.name} ${e.message}`) ? "Voice needs the microphone." : "Couldn't join voice. Try again in a minute.";
    }
    draw();
  }
  /** Into a voice channel: a fresh ticket from the space each time (a ticket works once). */
  function enterVoice(v: SpaceVoice) {
    if (talkingIn?.id === v.id) return;
    hangUp();
    talkingIn = v; note = "";
    sp.talk(v.id);
    draw();
  }
  function hangUp() {
    if (!talkingIn && !call) return;
    call?.leave();
    if (call) sp.inVoice();
    call = null; talkingIn = null; speakers = [];
  }
  /** Messages keep their channel number, so a page of history and a live line merge in order without repeats. */
  function add(ch: string, m: SpaceMessage[]) {
    const byId = new Map((msgs.get(ch) ?? []).map((x) => [x.id, x]));
    for (const x of m) byId.set(x.id, x);
    msgs.set(ch, [...byId.values()].sort((a, b) => a.id - b.id));
  }
  const back = () => { hangUp(); sp.close(); open = null; note = ""; void list(); draw(); };
  const copy = (invite: string) => void navigator.clipboard?.writeText(invite).then(() => { note = `Invite ${invite} copied`; say?.(note); draw(); }, () => {});
  const tab = (ch: string) => { channel = ch; if (channels.includes(ch) && !msgs.has(ch)) sp.history(ch); draw(); };
  const voiceName = (id?: string) => voices.find((v) => v.id === id)?.name;

  function drawList() {
    const items = rows.map((r) => {
      const b = el("button", { type: "button", className: "eq-btn rb-spaces-row" }, icon("hash"), r.name);
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
    const tabOf = (id: string, ...label: (Node | string)[]) => {
      const b = el("button", { type: "button", role: "tab", ariaSelected: String(id === channel), className: id === channel ? "eq-btn on" : "eq-btn" }, ...label);
      b.addEventListener("click", () => tab(id));
      return b;
    };
    const tabs = el("nav", { className: "rb-spaces-tabs", role: "tablist" },
      ...channels.map((ch) => tabOf(ch, `#${ch}`)),
      ...voices.map((v) => tabOf(v.id, icon("volume-2"), v.name)));
    const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (owner) tabs.append(line("new-channel", 24, "plus", "Add channel", (v) => sp.channel(slug(v))), line("new-voice-channel", 24, "volume-2", "Add voice channel", (v) => sp.channel(slug(v), true)));
    const drop = owner && channel !== "general" ? btn("trash-2", `Delete ${voiceName(channel) ?? `#${channel}`}`, () => { sp.drop(channel); channel = "general"; draw(); }, false, "rb-spaces-drop") : "";
    const voice = voices.find((v) => v.id === channel);
    if (voice) return [head, tabs, el("div", { className: "rb-spaces-body" }, drawVoice(voice), who()), drop, noteEl()];
    const shown = msgs.get(channel) ?? [];
    const log = el("ol", { className: "rb-spaces-log", ariaLive: "polite" }, ...shown.map((m) =>
      el("li", {}, el("b", {}, m.from.name), " ", m.text)));
    const older = more.get(channel) && shown[0] ? btn("arrow-up", "Load older", () => sp.history(channel, shown[0]!.id), true, "rb-spaces-older") : "";
    const typed = line(`Message #${channel}`, 280, "send", "Send", (v) => sp.say(channel, v));
    return [head, tabs, el("div", { className: "rb-spaces-body" }, el("div", { className: "rb-spaces-chat" }, older, log), who()), typed, drop, noteEl()];
  }

  /** A voice channel: join it, or, once in, who Qlave has in the room (talking, muted), your mute and hang up. */
  function drawVoice(v: SpaceVoice) {
    if (talkingIn?.id !== v.id) {
      const there = online.filter((m) => m.voice === v.id).map((m) => el("li", {}, m.name));
      return el("div", { className: "rb-spaces-voice" },
        there.length ? el("ul", { className: "rb-spaces-speakers" }, ...there) : el("p", { className: "rb-spaces-empty" }, "Nobody is talking here yet."),
        btn("volume-2", `Join ${v.name}`, () => enterVoice(v), true, "rb-spaces-join"));
    }
    if (!call) return el("div", { className: "rb-spaces-voice" }, el("p", { className: "rb-spaces-empty", role: "status" }, "Joining…"));
    return el("div", { className: "rb-spaces-voice" },
      el("ul", { className: "rb-spaces-speakers", ariaLabel: "In voice" }, ...speakers.map((s) =>
        el("li", { className: [s.talking ? "talking" : "", s.muted ? "muted" : ""].filter(Boolean).join(" ") }, ...(s.muted ? [icon("mic-off")] : []), s.name))),
      el("div", { className: "rb-spaces-voice-bar" },
        btn(selfMuted ? "mic" : "mic-off", selfMuted ? "Unmute yourself" : "Mute yourself", () => { selfMuted = !selfMuted; call?.muteSelf(selfMuted); draw(); }),
        btn("phone-off", `Leave ${v.name}`, () => { hangUp(); draw(); })));
  }

  function who() {
    const me = name();
    return el("ul", { className: "rb-spaces-online", ariaLabel: "Online" }, ...online.map((m) => el("li", {}, m.name, ...(m.voice ? [el("span", { className: "rb-spaces-in-voice", title: `In ${voiceName(m.voice) ?? "voice"}` }, icon("volume-2"))] : []), ...(m.name === me ? [] : owner
      ? [btn(muted.has(m.id) ? "mic" : "mic-off", muted.has(m.id) ? `Unmute ${m.name}` : `Mute ${m.name}`, () => { const on = !muted.has(m.id); if (on) muted.add(m.id); else muted.delete(m.id); sp.mute(m.id, on); draw(); }),
        btn("user-x", `Kick ${m.name}`, () => sp.kick(m.id))]
      : [btn("flag", `Report ${m.name}`, () => { sp.report(m.id); note = `Reported ${m.name}`; draw(); })]))));
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
    state: (): SpacesState => ({
      open: open?.name ?? null, spaces: rows.map((r) => r.name), channel, channels, messages: (msgs.get(channel) ?? []).map((m) => `${m.from.name}: ${m.text}`),
      online: online.map((m) => m.name), note, more: more.get(channel) ?? false,
      voices: voices.map((v) => v.name), inVoice: call ? talkingIn?.name ?? null : null,
      speakers: speakers.map((s) => `${s.name}${s.muted ? " (muted)" : s.talking ? " (talking)" : ""}`),
    }),
    close: () => { hangUp(); sp.close(); box.hidden = true; },
  };
}
