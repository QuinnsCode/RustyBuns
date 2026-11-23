// The card by the decks: the mode (lineup or open decks), who is on and for how long, who is next and when (clocks
// that tick, fixed width), your own ask to play / step up / step down, and the host's and moderators' controls:
// switch the mode, take whoever is on off, and edit the lineup (who, how long, the order). The rules are src/spin.ts;
// the World checks every deck command against them, so this only shows them and sends the asks.
import "./spin-card.css";
import { chain, CUE_MS, MAX_SLOT_MIN, onNow, slotNext, slotNow, type Spin, type SpinOp } from "../spin.ts";

export interface SpinHost {
  spin(): Spin | null;
  /** The room's shared clock now, ms. */
  now(): number;
  me(): string | undefined;
  /** You lead the room, or the host named you a moderator. */
  runs(): boolean;
  /** Your grants let you play. */
  mayPlay(): boolean;
  /** Everyone in the room (you too), for the lineup's picker. */
  people(): { id: string; name: string }[];
  nameOf(id: string): string;
  send(op: SpinOp): void;
}

const svg = (body: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// lucide (ISC): list-ordered, disc-3, user-x, list-plus, hand, log-in, log-out, arrow-up, arrow-down, trash-2, check, plus, x
const ICON = {
  lineup: svg('<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  open: svg('<circle cx="12" cy="12" r="10"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><circle cx="12" cy="12" r="2"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/>'),
  off: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>'),
  edit: svg('<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>'),
  hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
  up: svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>'),
  down: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  earlier: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
  later: svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  drop: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  save: svg('<path d="M20 6 9 17l-5-5"/>'),
  add: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

/** A length of time as a clock, always the same width: m:ss under an hour, h:mm:ss over. */
export function clockOf(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};
const button = (icon: string, title: string, cls = "") => el("button", { type: "button", title, "aria-label": title, class: cls }, icon);

/** The card, ticking once a second. `root` goes where the page wants it (the decks' header). */
export function spinCard(host: SpinHost): { root: HTMLElement; draw(): void; state(): { mode: string; on: string | null; next: string | null; clock: string } } {
  const root = el("div", { class: "spin-card", role: "status", "aria-label": "Who is on the decks" });
  const mode = el("span", { class: "spin-mode" });
  const on = el("span", { class: "spin-on" });
  const next = el("span", { class: "spin-next" });
  const mine = el("span", { class: "spin-mine" });
  const tools = el("span", { class: "spin-tools" });
  const editor = el("div", { class: "spin-edit", role: "dialog", "aria-label": "The lineup" });
  editor.hidden = true;
  root.append(mode, on, next, mine, tools, editor);
  let drafts: { who: string; min: number }[] = [];
  let shown = { mode: "", on: null as string | null, next: null as string | null, clock: "" };

  const send = (op: SpinOp) => host.send(op);
  function tick() {
    const s = host.spin();
    root.hidden = !s;
    if (!s) return;
    const now = host.now();
    mode.innerHTML = s.mode === "lineup" ? ICON.lineup : ICON.open;
    mode.title = s.mode === "lineup" ? "Lineup: the decks go by the running order" : "Open decks: step up when they're free";
    const who = onNow(s, now), cur = s.mode === "lineup" ? slotNow(s, now) : null, nx = s.mode === "lineup" ? slotNext(s, now) : null;
    const left = cur ? cur.at + cur.min * 60_000 - now : 0;
    on.innerHTML = "";
    on.append(el("b", {}, ""), el("time", {}, ""));
    on.firstElementChild!.textContent = who ? host.nameOf(who) : "Decks free";
    on.lastElementChild!.textContent = cur ? clockOf(left) : "";
    on.title = cur ? "On now, and how long their slot has left" : "On now";
    const nextWho = s.mode === "lineup" ? nx?.who ?? null : s.queue[0] ?? null;
    next.hidden = !nextWho;
    next.innerHTML = "";
    if (nextWho) {
      next.append(el("small", {}, "next"), el("b", {}, ""), el("time", {}, ""));
      next.children[1]!.textContent = host.nameOf(nextWho);
      next.lastElementChild!.textContent = nx ? clockOf(nx.at - now) : "";
      next.title = nx && nx.at - now <= CUE_MS ? "Next up: cue up on the free deck now" : "Next up, and when";
      next.classList.toggle("cue", !!nx && nx.at - now <= CUE_MS);
    }
    shown = { mode: s.mode, on: who, next: nextWho, clock: on.lastElementChild!.textContent ?? "" };
  }

  function draw() {
    const s = host.spin();
    tick();
    mine.replaceChildren();
    tools.replaceChildren();
    if (!s) return;
    const me = host.me(), runs = host.runs(), refused = !!me && s.refused.includes(me);
    if (me && !refused && s.mode === "open") {
      if (s.on === me) mine.append(act(ICON.down, "Step down: the next in line gets the decks", { o: "down" }));
      else if (!s.on && host.mayPlay()) mine.append(act(ICON.up, "Step up: the decks are free", { o: "up" }));
      else if (s.queue.includes(me)) mine.append(act(ICON.x, `Leave the queue (you're number ${s.queue.indexOf(me) + 1})`, { o: "down" }, "on"));
      else if (host.mayPlay()) mine.append(act(ICON.hand, "Ask to play next", { o: "ask" }));
    }
    if (refused) mine.append(el("small", { class: "spin-refused", title: "The host took you off the decks: you can still dance and listen" }, "listening"));
    if (runs) {
      tools.append(act(s.mode === "lineup" ? ICON.open : ICON.lineup, s.mode === "lineup" ? "Switch to open decks" : "Switch to a lineup", { o: "mode", mode: s.mode === "lineup" ? "open" : "lineup" }));
      if (onNow(s, host.now())) tools.append(act(ICON.off, "Take them off the decks now", { o: "off" }));
      const ed = button(ICON.edit, "Edit the lineup", editor.hidden ? "" : "on");
      ed.addEventListener("click", () => { editor.hidden = !editor.hidden; if (!editor.hidden) { drafts = s.lineup.map((x) => ({ who: x.who, min: x.min })); edit(); } draw(); });
      tools.append(ed);
    } else editor.hidden = true;
  }
  function act(icon: string, title: string, op: SpinOp, cls = "") {
    const b = button(icon, title, cls);
    b.addEventListener("click", () => send(op));
    return b;
  }

  /** The lineup editor: a row a slot (who, minutes, earlier, later, drop), add one, and save from now or the first slot's start. */
  function edit() {
    const s = host.spin();
    if (!s || editor.hidden) return;
    const people = host.people();
    editor.replaceChildren(el("h3", {}, "Lineup"));
    const ol = el("ol");
    drafts.forEach((d, i) => {
      const li = el("li");
      const pick = el("select", { "aria-label": "Who", title: "Who" });
      for (const p of people.some((p) => p.id === d.who) ? people : [...people, { id: d.who, name: host.nameOf(d.who) }]) {
        const o = el("option", { value: p.id });
        o.textContent = p.name;
        if (p.id === d.who) o.selected = true;
        pick.append(o);
      }
      pick.addEventListener("change", () => { d.who = pick.value; });
      const min = el("input", { type: "number", min: "1", max: String(MAX_SLOT_MIN), value: String(d.min), "aria-label": "Minutes", title: "Minutes" });
      min.addEventListener("change", () => { d.min = Math.min(MAX_SLOT_MIN, Math.max(1, Math.round(Number(min.value)) || 30)); min.value = String(d.min); });
      const move = (by: number) => () => { const j = i + by; if (j < 0 || j >= drafts.length) return; [drafts[i], drafts[j]] = [drafts[j]!, drafts[i]!]; edit(); };
      const up = button(ICON.earlier, "Earlier"), down = button(ICON.later, "Later"), drop = button(ICON.drop, "Take out of the lineup");
      up.addEventListener("click", move(-1)); down.addEventListener("click", move(1));
      drop.addEventListener("click", () => { drafts.splice(i, 1); edit(); });
      li.append(pick, min, up, down, drop);
      ol.append(li);
    });
    const add = button(ICON.add, "Add a slot");
    add.addEventListener("click", () => { const first = people[0]; if (first) { drafts.push({ who: first.id, min: 30 }); edit(); } });
    const save = button(ICON.save, "Save: the first slot starts when it did, or now", "on");
    save.addEventListener("click", () => {
      const now = host.now(), start = s.lineup[0] && s.lineup[0].at <= now ? s.lineup[0].at : now;
      send({ o: "lineup", slots: chain(drafts, start) });
      if (s.mode !== "lineup") send({ o: "mode", mode: "lineup" });
      editor.hidden = true;
      draw();
    });
    const row = el("div", { class: "spin-edit-row" });
    row.append(add, save);
    editor.append(ol, row);
  }

  setInterval(tick, 1000);
  return { root, draw, state: () => shown };
}
