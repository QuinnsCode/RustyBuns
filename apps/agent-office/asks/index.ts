// AGENT_OFFICE_ASK_FIRST's card (#727): an agent's tell / hire / home / pr request waits on the server
// (live/floorguard.ts) until a person answers it here, on the 3D office or /lite. Each one shows as a card with
// what the agent asked and Allow / Deny, and a clock running down to when it's turned down by itself.
// Nothing upstream is patched: the cards poll /__rb/asks, and an answer POSTs to /__rb/asks/<id>.
import type { Ask } from "../live/floorguard.ts";

const POLL_MS = 3000;
const answered = new Set<string>();
let box: HTMLElement | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const left = (until: number) => {
  const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function mount() {
  const style = el("style");
  style.textContent =
    ".rb-asks{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;gap:8px;" +
    "width:min(460px,calc(100vw - 32px));font:14px/1.4 system-ui,sans-serif}" +
    ".rb-ask{background:#fffdf7;color:#222;border:2px solid #e8a33d;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px #0004}" +
    ".rb-ask-head{display:flex;align-items:center;gap:8px;font-weight:600}" +
    ".rb-ask-head span:first-child{flex:1;min-width:0}" +
    ".rb-ask-clock{font-variant-numeric:tabular-nums;min-width:4ch;text-align:right;color:#8a5a12;cursor:help}" +
    ".rb-ask-detail{margin:6px 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:8em;overflow:auto}" +
    ".rb-ask-buttons{display:flex;gap:8px;justify-content:flex-end}" +
    ".rb-ask button{white-space:nowrap;border:0;border-radius:6px;padding:6px 14px;font:inherit;font-weight:600;cursor:pointer}" +
    ".rb-ask .rb-allow{background:#2f8f46;color:#fff}.rb-ask .rb-deny{background:#c0392b;color:#fff}" +
    ".rb-ask button:disabled{opacity:.5;cursor:default}";
  document.head.append(style);
  box = el("div", { className: "rb-asks", role: "region", ariaLabel: "Agents asking first" });
  document.body.append(box);
}

async function answer(id: string, allow: boolean, card: HTMLElement) {
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  answered.add(id);
  try {
    await fetch(`/__rb/asks/${encodeURIComponent(id)}?allow=${allow ? 1 : 0}`, { method: "POST", headers: { "x-rb-ask": "1" } });
  } catch {}
  card.remove();
}

function card(a: Ask) {
  const clock = el("span", { className: "rb-ask-clock", title: "Turned down by itself when this runs out" }, left(a.until));
  const allow = el("button", { className: "rb-allow", title: `Let ${a.who} ${a.what}` }, "✓ Allow");
  const deny = el("button", { className: "rb-deny", title: `Tell ${a.who} no` }, "✕ Deny");
  const c = el("div", { className: "rb-ask" },
    el("div", { className: "rb-ask-head" }, el("span", {}, `✋ ${a.who} asks first`), clock),
    el("div", { className: "rb-ask-detail" }, a.detail),
    el("div", { className: "rb-ask-buttons" }, deny, allow));
  c.dataset.id = a.id;
  allow.onclick = () => answer(a.id, true, c);
  deny.onclick = () => answer(a.id, false, c);
  const tick = setInterval(() => (c.isConnected ? (clock.textContent = left(a.until)) : clearInterval(tick)), 1000);
  return c;
}

function show(asks: Ask[]) {
  if (!box) mount();
  const live = new Set(asks.map((a) => a.id));
  for (const c of [...box!.children] as HTMLElement[]) if (!live.has(c.dataset.id!)) c.remove();
  const have = new Set([...box!.children].map((c) => (c as HTMLElement).dataset.id));
  for (const a of asks) if (!have.has(a.id) && !answered.has(a.id)) box!.append(card(a));
}

async function poll() {
  try {
    const res = await fetch("/__rb/asks");
    // signed out (sent to /login), or an office without the route: nothing to ask, and no point asking again
    if (res.redirected || res.status === 401 || res.status === 404) return;
    if (res.ok) show(((await res.json()) as { asks: Ask[] }).asks);
  } catch {}
  setTimeout(poll, POLL_MS);
}

if (document.body) poll();
else document.addEventListener("DOMContentLoaded", poll, { once: true });
