// The party lobby panel, shared by every page that plays through a Qollab party (apps/eqosys/src/qollab/party.ts): who is in and
// who is ready, a Ready button (Start for the host), Copy link, and Settings: every party rule (./party-rules.ts) in one menu,
// the host's to change and everyone's to read, with each member's mute-for-me, mute-for-all and report as the rules allow, and the
// host's make host, take out and block.
// A party link carries the party's invite key (`?invite=`), which the door checks when only the host invites (#3908): Copy link
// adds the key eqosys gave this member, and joining hands on the key the page was opened with, whatever else the game keeps in its address.
// What happens on start is the page's own. The box wears the page's eqosys skin (./skin.ts); where it sits is the page's.
import type { PartyMember, party } from "./eqosys.ts";
import { BLOCKS, CHAT, INVITE, JOINS, LIVES, may, MUTE, READY, REPORT, RULE_TEXT, type PartyRules } from "./party-rules.ts";
import { eqButton, wearSkin } from "./skin.ts";
import { el } from "./dom.ts";

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

/** Where a party link's key waits while the page goes to sign in and back, which can drop it from the address. */
const KEPT = "eq.party.invite.";
/** The invite key in an address, for the party it names (`?party=`), or for whatever party when it names none. */
const keyIn = (search: string, code: string): string | null => {
  const q = new URLSearchParams(search), party = q.get("party")?.toUpperCase();
  return (!party || party === code.toUpperCase()) && q.get("invite")?.match(/^[\w-]{1,64}$/)?.[0] || null;
};
const keep = (code: string, key: string) => { try { sessionStorage.setItem(KEPT + code.toUpperCase(), key); } catch { /* private window: this address only */ } };
const kept = (code: string): string | undefined => { try { return sessionStorage.getItem(KEPT + code.toUpperCase()) ?? undefined; } catch { return undefined; } };
// Kept the moment the page loads, before a sign-in can take it somewhere else.
if (typeof location !== "undefined") {
  const party = new URLSearchParams(location.search).get("party"), key = party && keyIn(location.search, party);
  if (party && key) keep(party, key);
}

/** `link` with this party's invite key on it (or none: a link from a member who may not invite carries none). */
const withInvite = (link: string, key: string): string => {
  const u = new URL(link, typeof location === "undefined" ? "http://x" : location.href);
  if (key) u.searchParams.set("invite", key); else u.searchParams.delete("invite");
  return u.toString();
};

/** Join the party and keep `box` showing it. Returns a function that leaves and hides the box. */
export function lobbyPanel({ code, box, party: p, name, link, onStart, say }: LobbyPanel) {
  let members: PartyMember[] = [], note = "", rules: PartyRules | null = null, blocked: { id: string; name: string }[] = [], open = false;
  /** The key Copy link carries: eqosys hands it to members the `invite` rule lets invite, and to nobody else. */
  let key = "";
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
    // Reads "Party KRTZ: Ada (host), Grace ready" as text; each member is its own mark, a lit dot once ready (the host always is).
    const list = members.length ? members.flatMap((m, i) => [...(i ? [", "] : []), el("span", { className: `rb-lobby-m${m.host ? " host" : m.ready ? " ready" : ""}` }, m.name, ...(m.host || m.ready ? [el("small", {}, m.host ? " (host)" : " ready")] : []))]) : ["joining..."];
    box.replaceChildren(
      el("div", { className: "rb-lobby-who" }, "Party ", el("b", { className: "rb-lobby-code" }, code), ": ", ...list, ...(note ? [el("span", { className: "rb-lobby-note" }, ` - ${note}`)] : [])),
      mine?.host ? eqButton({ text: "Start", primary: true, onClick: () => p.start() }) : eqButton({ text: mine?.ready ? "Not ready" : "Ready", primary: !mine?.ready, onClick: () => p.ready(!mine?.ready) }),
      // Inviting is the host's alone when the rules say so: then the key is theirs alone, and they can retire it.
      ...(key && rules && may(rules.invite, !!mine?.host) ? [eqButton({ text: "Copy link", onClick: () => void navigator.clipboard?.writeText(withInvite(link(), key)).then(() => say?.("Link copied"), () => {}) })] : []),
      ...(mine?.host && rules?.invite === "host" ? [eqButton({ text: "New link: the ones handed out stop working", icon: "refresh-cw", onClick: () => { p.relink(); note = "New link made: copy it again"; draw(); } })] : []),
      eqButton({ text: open ? "Close settings" : "Settings", icon: "sliders-horizontal", onClick: () => { open = !open; draw(); } }),
      ...(open ? [settings(mine)] : []),
    );
  };
  p.onMembers((m) => { members = m; note = ""; draw(); });
  p.onRules((m) => { rules = m.rules; key = m.invite ?? ""; if (m.blocked) blocked = m.blocked; draw(); });
  p.onRefused((why) => { note = why; draw(); });
  p.onGone((why) => { note = why; members = []; draw(); });
  p.onStart(onStart);
  p.join(code, keyIn(location.search, code) ?? kept(code));
  box.hidden = false;
  draw();
  return () => { p.leave(); box.hidden = true; };
}
