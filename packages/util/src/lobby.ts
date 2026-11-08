// The party lobby panel, shared by every page that plays through a Qollab party (apps/eqosys/src/qollab/party.ts): who is in and
// who is ready, a Ready button (Start for the host), Copy link, and Settings: every party rule (./party-rules.ts) in one menu,
// the host's to change and everyone's to read, with each member's mute-for-me, mute-for-all and report as the rules allow, and the
// host's make host, take out and block.
// What happens on start is the page's own. The box wears the page's eqosys skin (./skin.ts); where it sits is the page's.
import type { PartyMember, party } from "./eqosys.ts";
import { BLOCKS, CHAT, INVITE, JOINS, LIVES, may, MUTE, READY, REPORT, RULE_TEXT, type PartyRules } from "./party-rules.ts";
import { eqButton, wearSkin } from "./skin.ts";

export interface LobbyPanel {
  code: string;
  box: HTMLElement;
  party: ReturnType<typeof party>;
  /** The signed-in name, to find this rider among the members. */
  name: () => string | undefined;
  /** What Copy link puts on the clipboard. */
  link: () => string;
  /** Called with the room and seat when the host starts, and the party's start ticket for them (`startTicket`). */
  onStart: (s: { room: string; seat: number; ticket?: string }) => void;
  /** Told when something worth a note happened (the link was copied). */
  say?: (note: string) => void;
}

/** An element with a class or text, and its children. */
const el = (tag: string, o: { className?: string; textContent?: string } = {}, ...kids: (Node | string)[]): HTMLElement => {
  const e = document.createElement(tag);
  if (o.className) e.className = o.className;
  if (o.textContent !== undefined) e.textContent = o.textContent;
  e.append(...kids);
  return e;
};

/** Join the party and keep `box` showing it. Returns a function that leaves and hides the box. */
export function lobbyPanel({ code, box, party: p, name, link, onStart, say }: LobbyPanel) {
  let members: PartyMember[] = [], note = "", rules: PartyRules | null = null, blocked: { id: string; name: string }[] = [], open = false;
  /** Who this page quieted for the whole party, so the button reads right (the party says no more than a refusal). */
  const quiet = new Set<string>();
  wearSkin();
  box.classList.add("eq", "rb-lobby");

  /** One rule's control: the host's select (or checkbox, or number), anyone else's words. */
  const rule = <K extends keyof PartyRules>(key: K, host: boolean, choices?: readonly (string | number)[]): HTMLElement => {
    const r = rules!, words: Record<string, string> = RULE_TEXT[key];
    const set = (v: PartyRules[K]) => p.rules({ ...r, [key]: v });
    let control: HTMLElement;
    if (!host) control = el("span", { textContent: key === "size" ? String(r.size) : key === "late" ? words[r.late ? "on" : "off"]! : words[String(r[key])]! });
    else if (choices) {
      const s = document.createElement("select");
      for (const c of choices) s.append(Object.assign(document.createElement("option"), { value: String(c), textContent: words[c]!, selected: r[key] === c }));
      s.onchange = () => set(choices.find((c) => String(c) === s.value) as PartyRules[K]);
      control = s;
    } else if (key === "late") {
      const c = Object.assign(document.createElement("input"), { type: "checkbox", checked: r.late });
      c.onchange = () => set(c.checked as PartyRules[K]);
      control = el("span", {}, c, ` ${words.on}`);
    } else {
      const n = Object.assign(document.createElement("input"), { type: "number", min: "2", max: "50", value: String(r.size) });
      n.onchange = () => { const v = Math.round(Number(n.value)); if (v >= 2 && v <= 50) set(v as PartyRules[K]); };
      control = n;
    }
    return el("label", {}, el("span", { textContent: words.label! }), control);
  };

  /** A member's row: their name, mute-for-me for everyone else, and the host's make host, take out and block. */
  const member = (m: PartyMember, me: PartyMember | undefined): HTMLElement => {
    const acts = el("span", { className: "rb-lobby-acts" });
    if (m.id !== me?.id) {
      const hid = p.hidden().has(m.id);
      acts.append(eqButton({ text: hid ? `Unmute ${m.name} for you` : `Mute ${m.name} for you`, icon: hid ? "volume-2" : "volume-x", onClick: () => { p.hide(m.id, !hid); draw(); } }));
      const q = quiet.has(m.id), host = !!me?.host;
      if (rules && may(rules.mute, host)) acts.append(eqButton({ text: q ? `Let ${m.name} talk again` : `Mute ${m.name} for everyone`, icon: q ? "mic" : "mic-off", onClick: () => { p.mute(m.id, !q); if (q) quiet.delete(m.id); else quiet.add(m.id); draw(); } }));
      if (rules && may(rules.report, host)) acts.append(eqButton({ text: `Report ${m.name}`, icon: "flag", onClick: () => { p.report(m.id); note = `Reported ${m.name}`; draw(); } }));
      if (me?.host) acts.append(
        eqButton({ text: `Make ${m.name} the host`, icon: "crown", onClick: () => p.makeHost(m.id) }),
        eqButton({ text: `Take ${m.name} out`, icon: "user-x", onClick: () => p.kick(m.id) }),
        eqButton({ text: `Block ${m.name}`, icon: "ban", onClick: () => p.block(m.id) }),
      );
    }
    return el("li", {}, el("span", { textContent: `${m.name}${m.host ? " (host)" : ""}` }), acts);
  };

  const settings = (me: PartyMember | undefined): HTMLElement => {
    const host = !!me?.host, box = el("div", { className: "rb-lobby-rules" });
    if (!rules) return el("div", { className: "rb-lobby-rules", textContent: "Loading the party's rules..." });
    box.append(
      el("h3", { textContent: host ? "Rules (yours to set)" : "Rules (the host sets these)" }),
      rule("join", host, JOINS), rule("late", host), rule("size", host), rule("ready", host, READY), rule("chat", host, CHAT),
      rule("mute", host, MUTE), rule("report", host, REPORT), rule("invite", host, INVITE), rule("hours", host, LIVES), rule("block", host, BLOCKS),
      el("h3", { textContent: "People" }), el("ul", {}, ...members.map((m) => member(m, me))),
    );
    if (host) box.append(el("h3", { textContent: "Blocked" }), blocked.length
      ? el("ul", {}, ...blocked.map((b) => el("li", {}, el("span", { textContent: b.name }), eqButton({ text: "Unblock", onClick: () => p.block(b.id, false) }))))
      : el("span", { textContent: "Nobody" }));
    return box;
  };

  const draw = () => {
    const mine = members.find((m) => m.name === name());
    const list = members.map((m) => `${m.name}${m.host ? " (host)" : m.ready ? " ready" : ""}`).join(", ") || "joining...";
    box.replaceChildren(
      el("div", { className: "rb-lobby-who", textContent: `Party ${code}: ${list}${note ? ` - ${note}` : ""}` }),
      mine?.host ? eqButton({ text: "Start", primary: true, onClick: () => p.start() }) : eqButton({ text: mine?.ready ? "Not ready" : "Ready", primary: !mine?.ready, onClick: () => p.ready(!mine?.ready) }),
      // Inviting is the host's alone when the rules say so.
      ...(!rules || may(rules.invite, !!mine?.host) ? [eqButton({ text: "Copy link", onClick: () => void navigator.clipboard?.writeText(link()).then(() => say?.("Link copied"), () => {}) })] : []),
      eqButton({ text: open ? "Close settings" : "Settings", icon: "sliders-horizontal", onClick: () => { open = !open; draw(); } }),
      ...(open ? [settings(mine)] : []),
    );
  };
  p.onMembers((m) => { members = m; note = ""; draw(); });
  p.onRules((m) => { rules = m.rules; if (m.blocked) blocked = m.blocked; draw(); });
  p.onRefused((why) => { note = why; draw(); });
  p.onGone((why) => { note = why; members = []; draw(); });
  p.onStart(onStart);
  p.join(code);
  box.hidden = false;
  draw();
  return () => { p.leave(); box.hidden = true; };
}
