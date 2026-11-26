// The Qollab spaces panel, shared by every page that signs in through eqosys (apps/eqosys/src/qollab/space.ts, QOLLAB.md#spaces):
// your spaces, make one, join by invite; inside one, channel tabs, the messages with "Load older", a text box and who is
// online. A message's reply button opens its thread, and a channel's search box finds what was said in it. The paperclip posts a
// file as a message of its own (up to 10 MB), and a file's message downloads it; your own messages (anyone's, if you run the space) delete. Voice channels (QLAVE.md) join Qlave through ./voice.ts and list who is in them and who is talking. The owner
// also adds and deletes channels, copies the invite, and mutes or kicks from a member's row. The party lobby's
// sibling (./lobby.ts). Plain DOM with `rb-spaces*` classes in the page's eqosys skin (./skin.ts); the page places the
// box and hands over its icons (lucide, say) so this package keeps no dependencies.
import type { SpaceAudit, SpaceDm, SpaceMember, SpaceMessage, SpaceRole, SpaceRow, SpaceVoice, space } from "./eqosys.ts";
import { join as joinVoice, type Speaker, type VoiceHandle } from "./voice.ts";
import { wearSkin } from "./skin.ts";
import { el } from "./dom.ts";

/** What the panel uses of a joined voice room: `join`'s handle without its debug `call`. */
export type VoiceCall = Omit<VoiceHandle, "call">;

/** The icons the panel asks for, by lucide name. */
export type SpaceIcon = "arrow-left" | "arrow-up" | "plus" | "log-in" | "send" | "copy" | "hash" | "mic-off" | "mic" | "user-x" | "flag" | "log-out"
  | "volume-2" | "phone-off" | "trash-2" | "lock" | "user-plus" | "user-minus" | "shield" | "reply" | "search" | "paperclip" | "download"
  | "message-circle" | "history" | "clock";

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
  /** A space to open once the list is in (a link to one), when this person is in it. */
  start?: string;
}

/** What the panel is showing, for a harness: the list of spaces, or one space, its channel and messages. */
export interface SpacesState {
  open: string | null; spaces: string[]; channel: string; channels: string[]; messages: string[]; online: string[]; note: string; more: boolean;
  /** Voice channels by name, the one this page is in, and who Qlave says is in it ("Ada", "Ada (muted)", "Ada (talking)"). */
  voices: string[]; inVoice: string | null; speakers: string[];
  /** Your role in the open space, and which of its channels are private (only some see them). */
  role: SpaceRole | null; private: string[];
  /** The open thread (its first message, then the replies), or what a search found, as "Name: text"; null when neither is open. */
  thread: string[] | null; found: string[] | null;
  /** Your direct messages, by the other person's name; the audit log when it is open ("by act who"); the days messages stay (0: the default). */
  dms: string[]; audit: string[] | null; keep: number;
  /** A business studio's space (office words), and the status lines online ("Ada: in the Q3 review"). */
  office: boolean; statuses: string[];
}

/** The role the owner's button hands out next: member, then admin, then guest, then member again. */
const NEXT_ROLE = { member: "admin", admin: "guest", guest: "member" } as const;
const ROLE_WORD = { admin: "an admin", guest: "a guest", member: "a member" } as const;
/** A place kept free at the end of the header for the Report flag on a phone (`data-eq-flag`, report.ts), off every row's buttons. */
const flagSlot = () => {
  const s = el("span", { className: "rb-spaces-flag" });
  s.dataset.eqFlag = "";
  return s;
};

/**
 * Keep `box` showing this person's spaces. Returns the panel's handle: `state()` for a harness, `close()` to hang up
 * and hide it. Keys typed in the panel stop at the box, so a game's own keys don't fire while someone writes.
 */
export function spacesPanel({ box, space: sp, name, icon, say, join = joinVoice, start }: SpacesPanel) {
  let rows: SpaceRow[] = [], open: SpaceRow | null = null, note = "";
  let channels: string[] = [], channel = "general", owner = false, online: SpaceMember[] = [];
  // Your role, the private channels you see, and (when you run the space) who is let into each.
  let role: SpaceRole | null = null, locked: string[] = [], allowed = new Map<string, string[]>();
  // Voice: the channels, the one this page is in (or asked to join), its handle once Qlave let us in, who is in it, our own mute.
  let voices: SpaceVoice[] = [], talkingIn: SpaceVoice | null = null, call: VoiceCall | null = null, speakers: Speaker[] = [], selfMuted = false;
  const msgs = new Map<string, SpaceMessage[]>(), more = new Map<string, boolean>(), muted = new Set<string>();
  // Over the channel's log: a thread (the message it is under, and what came back) or a search's matches.
  let view: { kind: "thread"; id: number; messages: SpaceMessage[] } | { kind: "found"; q: string; messages: SpaceMessage[] } | { kind: "audit"; entries: SpaceAudit[] } | null = null;
  // Your direct messages (#5543), and the days the open space keeps messages (0: its newest 10,000 a channel).
  let dms: SpaceDm[] = [], keepDays = 0, office = false;
  /** A voice channel's word: a meeting in a business studio's space (VISION.md#the-words), a voice channel elsewhere. */
  const room = () => office ? "meeting" : "voice channel";
  /** A channel holding messages: a text channel or one of your direct messages. */
  const holds = (c: string) => channels.includes(c) || dms.some((d) => d.channel === c);
  /** How a channel reads: `#name`, or `@name` for a direct message. */
  const label = (c: string) => { const d = dms.find((x) => x.channel === c); return d ? `@${d.name}` : `#${c}`; };
  wearSkin();
  box.classList.add("eq", "rb-spaces");
  for (const k of ["keydown", "keyup", "keypress"]) box.addEventListener(k, (e) => e.stopPropagation());

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
    const first = start && rows.find((r) => r.id === start);
    start = undefined;
    if (first && !open) return enter(first);
    if (!open) draw();
  }
  function enter(row: SpaceRow) {
    hangUp();
    open = row; channel = "general"; channels = []; voices = []; online = []; owner = row.owner; note = ""; role = null; locked = []; allowed = new Map(); dms = []; keepDays = 0; office = false;
    msgs.clear(); more.clear(); view = null;
    sp.open(row.id, {
      space: (s) => {
        channels = s.channels; voices = s.voice; owner = s.owner; open = open && { ...open, name: s.name };
        role = s.role ?? null; locked = s.private ?? []; allowed = new Map((s.allowed ?? []).map((a) => [a.channel, a.ids])); dms = s.dms ?? []; keepDays = s.keep ?? 0; office = s.office ?? false;
        if (talkingIn && !voices.some((v) => v.id === talkingIn!.id)) hangUp();
        if (!holds(channel) && !voices.some((v) => v.id === channel)) channel = channels[0] ?? "general";
        if (holds(channel) && !msgs.has(channel)) sp.history(channel);
        draw();
      },
      ticket: (ch, url, t) => void talk(ch, url, t),
      online: (m) => { online = m; draw(); },
      said: (ch, m) => {
        add(ch, [m]);
        // A reply: the message it answers counts one more, and an open thread under it shows it.
        if (m.reply) msgs.set(ch, (msgs.get(ch) ?? []).map((x) => x.id === m.reply ? { ...x, replies: (x.replies ?? 0) + 1 } : x));
        if (ch === channel && view?.kind === "thread" && m.reply === view.id) view = { ...view, messages: [...view.messages, m] };
        if (ch === channel) draw();
      },
      unsaid: (ch, id) => {
        const gone = (msgs.get(ch) ?? []).find((x) => x.id === id);
        const drop = (list: SpaceMessage[]) => list.filter((x) => x.id !== id).map((x) => x.id === gone?.reply && x.replies ? { ...x, replies: x.replies - 1 || undefined } : x);
        msgs.set(ch, drop(msgs.get(ch) ?? []));
        if (ch === channel && view && view.kind !== "audit") view = { ...view, messages: drop(view.messages) } as typeof view;
        if (ch === channel) draw();
      },
      history: (ch, m, mo) => { add(ch, m); more.set(ch, mo); if (ch === channel) draw(); },
      thread: (ch, id, m) => { if (ch === channel && view?.kind === "thread" && view.id === id) { view = { ...view, messages: m }; draw(); } },
      found: (ch, q, m) => { if (ch === channel && view?.kind === "found" && view.q === q) { view = { ...view, messages: m }; draw(); } },
      refused: (why) => { note = why; draw(); },
      note: (text) => { note = text; draw(); },
      dm: (ch) => tab(ch),
      audit: (entries) => { view = { kind: "audit", entries }; draw(); },
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
        note = why === "kicked" ? `You were taken out of the ${room()}.` : why === "ended" ? `That ${room()} ended.` : "Voice lost its connection.";
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
  const tab = (ch: string) => { channel = ch; view = null; if (holds(ch) && !msgs.has(ch)) sp.history(ch); draw(); };
  /** An audit line as words: "Ada kick Bo", "Ada keep 30", "Ada drop #random". */
  const auditLine = (e: SpaceAudit) => {
    const who = e.who ? online.find((m) => m.id === e.who)?.name ?? dms.find((d) => d.id === e.who)?.name ?? "someone" : "";
    return [e.by.name || "the Studio tab", e.act, who, e.channel ? `#${e.channel}` : "", e.to ?? ""].filter(Boolean).join(" ");
  };
  /** Those who run it: the space's text channels as a JSON file. */
  async function exportAll() {
    const blob = open && await sp.exportSpace(open.id);
    if (!blob) { note = "Couldn't export this space."; draw(); return; }
    const a = el("a", { href: URL.createObjectURL(blob), download: `${open!.name}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  const voiceName = (id?: string) => voices.find((v) => v.id === id)?.name;
  const size = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  /** A file a message carries, saved through a link the page makes for it (the file needs the token, so no plain href). */
  async function download(f: NonNullable<SpaceMessage["file"]>) {
    const blob = open && await sp.fetchFile(open.id, f.id);
    if (!blob) { note = `${f.name} is gone.`; draw(); return; }
    const a = el("a", { href: URL.createObjectURL(blob), download: f.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  /** The paperclip: pick a file, and it goes up as a message in `ch`. */
  function attach(ch: string) {
    const pick = el("input", { type: "file", hidden: true });
    pick.addEventListener("change", async () => {
      const f = pick.files?.[0];
      if (!f || !open) return;
      note = `Sending ${f.name}…`; draw();
      const r = await sp.postFile(open.id, ch, f, f.name);
      note = "error" in r ? r.error : ""; draw();
    });
    return el("span", { className: "rb-spaces-attach" }, pick, btn("paperclip", `Send a file to ${label(ch)}`, () => pick.click()));
  }

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
      ...(owner ? [btn("history", "Audit log", () => sp.audit()), btn("download", "Export this space", () => void exportAll()),
        line(keepDays ? `Keeps ${keepDays} days; 0 for the default` : "Keep messages for how many days?", 4, "clock", "Set how long messages stay", (v) => sp.keep(Math.max(0, Math.min(3650, Math.floor(Number(v)) || 0))))] : []),
      btn("log-out", "Leave this space", () => { sp.leave(); back(); }),
      flagSlot());
    const tabOf = (id: string, ...label: (Node | string)[]) => {
      const b = el("button", { type: "button", role: "tab", ariaSelected: String(id === channel), className: id === channel ? "eq-btn on" : "eq-btn" }, ...label);
      b.addEventListener("click", () => tab(id));
      return b;
    };
    const tabs = el("nav", { className: "rb-spaces-tabs", role: "tablist" },
      ...channels.map((ch) => locked.includes(ch) ? tabOf(ch, icon("lock"), ch) : tabOf(ch, `#${ch}`)),
      ...voices.map((v) => tabOf(v.id, icon("volume-2"), v.name)),
      ...dms.map((d) => tabOf(d.channel, icon("message-circle"), d.name)));
    const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (owner) tabs.append(line("New channel", 24, "plus", "Add channel", (v) => sp.channel(slug(v))), line(office ? "Meeting room" : "Voice room", 24, "volume-2", office ? "Add meeting room" : "Add voice channel", (v) => sp.channel(slug(v), true)),
      line("Private channel", 24, "lock", "Add private channel", (v) => sp.privateChannel(slug(v))));
    const drop = owner && channel !== "general" && channels.includes(channel) || owner && voices.some((v) => v.id === channel) ? btn("trash-2", `Delete ${voiceName(channel) ?? `#${channel}`}`, () => { sp.drop(channel); channel = "general"; draw(); }, false, "rb-spaces-drop") : "";
    const voice = voices.find((v) => v.id === channel);
    if (view?.kind === "audit") {
      const shutAudit = btn("arrow-left", "Back", () => { view = null; draw(); }, true, "rb-spaces-older");
      const lines = view.entries.length ? el("ol", { className: "rb-spaces-log", ariaLabel: "Audit log" }, ...[...view.entries].reverse().map((e) => el("li", {}, el("small", {}, new Date(e.at).toLocaleString()), " ", auditLine(e))))
        : el("p", { className: "rb-spaces-empty" }, "Nothing in the audit log yet.");
      return [head, tabs, el("div", { className: "rb-spaces-body" }, el("div", { className: "rb-spaces-chat" }, shutAudit, lines), who()), noteEl()];
    }
    if (voice) return [head, tabs, el("div", { className: "rb-spaces-body" }, drawVoice(voice), who()), drop, noteEl()];
    const shown = msgs.get(channel) ?? [], ch = channel;
    const openThread = (id: number) => { view = { kind: "thread", id, messages: [] }; sp.thread(ch, id); draw(); };
    const said = (m: SpaceMessage, inThread = false) => {
      const to = m.reply && !inThread ? shown.find((x) => x.id === m.reply) : undefined;
      const f = m.file, mine = isMe(m.from.id, m.from.name);
      // the name and words wrap inside their own span, so the buttons stay on the message's line however narrow the chat
      return el("li", {}, ...(to ? [el("small", { className: "rb-spaces-re" }, `re ${to.from.name}`)] : []), el("span", { className: "rb-spaces-said" }, el("b", {}, m.from.name), " ",
        ...(f ? [btn("download", `Download ${f.name}`, () => void download(f), true, "rb-spaces-file"), el("small", {}, ` ${size(f.size)}`)] : [m.text])),
        el("span", { className: "rb-spaces-acts" }, // the row's buttons keep together at its end, apart from the words
          ...(mine || owner ? [btn("trash-2", "Delete this message", () => sp.unsay(ch, m.id), false, "rb-spaces-unsay")] : []),
          ...(inThread ? [] : m.replies
            ? [btn("reply", m.replies === 1 ? "1 reply" : `${m.replies} replies`, () => openThread(m.reply ?? m.id), true, "rb-spaces-replies")]
            : [btn("reply", `Reply to ${m.from.name}`, () => openThread(m.reply ?? m.id), false, "rb-spaces-reply")])));
    };
    const log = (items: SpaceMessage[], inThread = false) => el("ol", { className: "rb-spaces-log", ariaLive: "polite" }, ...items.map((m) => said(m, inThread)));
    const shut = btn("arrow-left", `Back to ${label(ch)}`, () => { view = null; draw(); }, true, "rb-spaces-older");
    if (view?.kind === "thread") {
      const typed = line("Reply in thread", 280, "send", "Reply", (v) => view?.kind === "thread" && sp.say(ch, v, view.id));
      return [head, tabs, el("div", { className: "rb-spaces-body" }, el("div", { className: "rb-spaces-chat" }, shut, log(view.messages, true)), who()), typed, noteEl()];
    }
    const find = line(`Search ${label(ch)}`, 100, "search", "Search", (q) => { view = { kind: "found", q, messages: [] }; sp.search(ch, q); draw(); });
    if (view?.kind === "found") {
      const none = view.messages.length ? "" : el("p", { className: "rb-spaces-empty", role: "status" }, `Nothing in ${label(ch)} says "${view.q}".`);
      return [head, tabs, el("div", { className: "rb-spaces-body" }, el("div", { className: "rb-spaces-chat" }, shut, find, none, log(view.messages)), who()), noteEl()];
    }
    const older = more.get(ch) && shown[0] ? btn("arrow-up", "Load older", () => sp.history(ch, shown[0]!.id), true, "rb-spaces-older") : "";
    const typed = line(`Message ${label(ch)}`, 280, "send", "Send", (v) => sp.say(ch, v));
    typed.prepend(attach(ch));
    return [head, tabs, el("div", { className: "rb-spaces-body" }, el("div", { className: "rb-spaces-chat" }, find, older, log(shown)), who()), typed, drop, noteEl()];
  }

  /** Whether this is the person looking: by account id (names are anyone's to copy), by name when the token says none. */
  const isMe = (id: string, called: string) => { const own = sp.me?.(); return own ? id === own : called === name(); };

  /** A voice channel: join it, or, once in, who Qlave has in the room (talking, muted), your mute and hang up. */
  function drawVoice(v: SpaceVoice) {
    if (talkingIn?.id !== v.id) {
      const there = online.filter((m) => m.voice === v.id).map((m) => el("li", {}, m.name));
      return el("div", { className: "rb-spaces-voice" },
        there.length ? el("ul", { className: "rb-spaces-speakers" }, ...there) : el("p", { className: "rb-spaces-empty" }, office ? "Nobody is in this meeting yet." : "Nobody is talking here yet."),
        btn("volume-2", office ? `Join the ${v.name} meeting` : `Join ${v.name}`, () => enterVoice(v), true, "rb-spaces-join"));
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
    const let_in = allowed.get(channel);
    // Your own status line, set from the top of the online list.
    const mine = line(online.find((m) => isMe(m.id, m.name))?.status ? "Change your status" : "Set a status", 80, "send", "Set your status", (v) => sp.status(v === "-" ? "" : v));
    // In a private channel, those who run the space let people in or keep them out; the owner of a person's own space hands out roles.
    const gate = (m: SpaceMember) => !let_in || m.role === "owner" || m.role === "admin" ? []
      : let_in.includes(m.id) ? [btn("user-minus", `Keep ${m.name} out of ${channel}`, () => sp.allow(channel, m.id, false))]
      : [btn("user-plus", `Let ${m.name} into ${channel}`, () => sp.allow(channel, m.id))];
    const ranks = (m: SpaceMember) => role !== "owner" || open?.studio || !m.role || m.role === "owner" ? []
      : [btn("shield", `Make ${m.name} ${ROLE_WORD[NEXT_ROLE[m.role]]}`, () => sp.role(m.id, NEXT_ROLE[m.role as keyof typeof NEXT_ROLE]))];
    const tag = (m: SpaceMember) => m.role && m.role !== "member" ? [el("small", { className: "rb-spaces-role" }, m.role)] : [];
    return el("ul", { className: "rb-spaces-online", ariaLabel: "Online" }, el("li", { className: "rb-spaces-mine" }, mine), ...online.map((m) => el("li", {}, m.name, ...tag(m), ...(m.status ? [el("small", { className: "rb-spaces-status" }, m.status)] : []), ...(m.voice ? [el("span", { className: "rb-spaces-in-voice", title: `In ${voiceName(m.voice) ?? "voice"}` }, icon("volume-2"))] : []), ...(isMe(m.id, m.name) ? [] : owner
      ? [btn(muted.has(m.id) ? "mic" : "mic-off", muted.has(m.id) ? `Unmute ${m.name}` : `Mute ${m.name}`, () => { const on = !muted.has(m.id); if (on) muted.add(m.id); else muted.delete(m.id); sp.mute(m.id, on); draw(); }),
        btn("user-x", `Kick ${m.name}`, () => sp.kick(m.id)), btn("user-x", `Remove ${m.name} from every space you run`, () => sp.kick(m.id, true), false, "rb-spaces-everywhere"),
        btn("message-circle", `Message ${m.name}`, () => sp.dm(m.id)), ...gate(m), ...ranks(m)]
      : [btn("message-circle", `Message ${m.name}`, () => sp.dm(m.id)), btn("flag", `Report ${m.name}`, () => { sp.report(m.id); note = `Reported ${m.name}`; draw(); })]))));
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
      role, private: locked,
      thread: view?.kind === "thread" ? view.messages.map((m) => `${m.from.name}: ${m.text}`) : null,
      found: view?.kind === "found" ? view.messages.map((m) => `${m.from.name}: ${m.text}`) : null,
      office, statuses: online.filter((m) => m.status).map((m) => `${m.name}: ${m.status}`),
      dms: dms.map((d) => d.name), audit: view?.kind === "audit" ? view.entries.map(auditLine) : null, keep: keepDays,
    }),
    close: () => { hangUp(); sp.close(); box.hidden = true; },
  };
}
