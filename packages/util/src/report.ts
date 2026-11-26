// Telling the RustyBuns repo about a bug, a suggestion or an error from inside a game. `sendReport` posts to eqosys's /api/report with
// the player's token (eqosys limits it per account and files the GitHub issue, tagged `external` and with the game); `reportButton`
// is a small drop-in widget on top: a corner button, a short form, a thank-you. The game's `eqosys()` client (./eqosys.ts) exposes
// both as `report` and `reportButton`, so a game that signs in through eqosys needs one line: `reportButton()`.
import { readJson } from "./http.ts";
import { int, obj, opt, str } from "./guard.ts";
import { eqBadge, eqButton, wearSkin } from "./skin.ts";

/** Where a player writes when a public report won't do: they can't sign in to send one, or it's private (their account, a worry
 *  about someone, a security hole). eqosys's sign-in and privacy pages show it too. */
export const CONTACT_EMAIL = "theqntbr@gmail.com";
/** A mailto link to CONTACT_EMAIL with the subject filled in. */
export const contactHref = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

export type ReportKind = "bug" | "suggestion" | "error";
export interface ReportIn { kind: ReportKind; title: string; body: string; page?: string; build?: string; detail?: string }
export type Sent = { ok: true; issue: number | null } | { ok: false; error: string };

const Reply = obj({ issue: opt(int(1, 1e9)), error: opt(str(300)) });

/** POST the report. `token` is the one eqosys handed the game; `url` is eqosys's origin. Never throws. */
export async function sendReport(url: string, token: string, r: ReportIn): Promise<Sent> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/report`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ page: location.pathname, ...r }), // not the query: it can hold a party or invite code
  }).catch(() => null);
  if (!res) return { ok: false, error: "couldn't reach eqosys: check your connection" };
  const body = await readJson(res, Reply);
  return res.ok ? { ok: true, issue: body?.issue ?? null } : { ok: false, error: body?.error ?? `eqosys said ${res.status}` };
}

/** What the widget needs from the game's sign-in: the saved login (null when signed out), and a way to start signing in. */
export interface ReportHost { token: () => string | null; url: () => string; signIn: () => void; build?: string }

/** A floating "Report" button that opens a short form, in the page's eqosys skin (./skin.ts). Returns a function that removes it. */
export function mountReportButton(host: ReportHost, parent: HTMLElement = document.body): () => void {
  wearSkin();
  const root = Object.assign(document.createElement("div"), { className: "eq rb-report" }); // the Cmd+K palette's corner button (palette.ts) steps up over it
  const open = eqButton({ text: "Report", icon: "flag", show: true });
  open.title = "Report a bug or suggest something";
  open.lastChild?.replaceWith(Object.assign(document.createElement("span"), { textContent: "Report" })); // the word goes at phone width (skin.ts)
  const form = Object.assign(document.createElement("form"), { className: "eq-form", hidden: true });
  form.setAttribute("aria-label", "Report");
  const head = Object.assign(document.createElement("h2"), { className: "eq-title", textContent: "Tell the developer" });
  const kind = Object.assign(document.createElement("select"), { innerHTML: `<option value="bug">Bug</option><option value="suggestion">Suggestion</option><option value="error">Something broke</option>` });
  kind.setAttribute("aria-label", "Kind");
  const title = Object.assign(document.createElement("input"), { placeholder: "In a few words", maxLength: 120, required: true, minLength: 3 });
  const body = Object.assign(document.createElement("textarea"), { placeholder: "What happened, or what would be better?", maxLength: 4000, rows: 5 });
  const send = eqButton({ text: "Send", type: "submit", primary: true });
  const note = Object.assign(document.createElement("div"), { className: "eq-status" });
  note.setAttribute("role", "status");
  // Reports become public issues, so the private way is always in view, signed in or not.
  const mail = Object.assign(document.createElement("div"), { className: "eq-status" });
  mail.append("Private, or can't sign in? Email ", Object.assign(document.createElement("a"), { href: contactHref(`A problem in ${document.title || "a Q game"}`), textContent: CONTACT_EMAIL }));
  const top =Object.assign(document.createElement("div"), { className: "eq-head" });
  const shut = () => { form.hidden = true; open.focus(); };
  top.append(head, eqBadge(), eqButton({ text: "Close", icon: "x", onClick: shut }));
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
  form.append(top, kind, title, body, send, note, mail);
  open.onclick = () => { form.hidden = !form.hidden; note.textContent = ""; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const token = host.token();
    if (!token) { note.textContent = "Sign in with eqosys to send a report."; host.signIn(); return; }
    send.disabled = true; note.textContent = "Sending...";
    const r = await sendReport(host.url(), token, { kind: kind.value as ReportKind, title: title.value.trim(), body: body.value, ...(host.build ? { build: host.build } : {}) });
    send.disabled = false;
    if (r.ok) { note.textContent = "Thanks, that reached the developer."; title.value = body.value = ""; } else note.textContent = r.error;
  };
  root.append(form, open);
  parent.append(root);
  const unclear = keepClear(root, open);
  return () => { unclear(); root.remove(); };
}

/** What the flag must never sit on: the page's own controls, and anything it marks `data-eq-clear`. */
const CONTROL = "button,input,select,textarea,a[href],[role=button],[data-eq-clear]";

/**
 * The flag's corner is where a game's chat keeps its Send button. On a phone, a place a panel keeps for it (`data-eq-flag`,
 * the spaces header's end) takes it while that place is on screen: the place is sized to the flag and the flag moves onto it
 * (`--eq-lift` and `--eq-shift` on the root, which move the corner without making it the box a phone's fixed form sheet sits
 * in). Otherwise it lifts just clear of any control under it, as the page scrolls, resizes or changes; with no room above it
 * stays in its corner.
 */
function keepClear(root: HTMLElement, flag: HTMLElement): () => void {
  // Every control the flag's box touches, by its box: a hit test would miss a Send button that is resting (pointer-events: none).
  const under = (r: DOMRect) => {
    for (const el of document.querySelectorAll<HTMLElement>(CONTROL)) {
      if (root.contains(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width && b.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return b;
    }
    return null;
  };
  let queued = 0;
  const phone = matchMedia("(max-width:600px)");
  const dock = () => {
    const slot = phone.matches ? document.querySelector<HTMLElement>("[data-eq-flag]") : null;
    if (!slot) return false;
    const w = `${flag.offsetWidth}px`, h = `${flag.offsetHeight}px`;
    if (slot.style.width !== w || slot.style.height !== h) Object.assign(slot.style, { width: w, height: h });
    const at = slot.getBoundingClientRect(), f = flag.getBoundingClientRect();
    if (!at.width || at.top < 8 || at.bottom > innerHeight - 8) return false;
    root.style.setProperty("--eq-lift", `${Math.round(f.bottom - at.bottom)}px`);
    root.style.setProperty("--eq-shift", `${Math.round(f.right - at.right)}px`);
    return true;
  };
  const place = () => {
    queued = 0;
    root.style.removeProperty("--eq-lift");
    root.style.removeProperty("--eq-shift");
    if (!flag.offsetWidth || dock()) return;
    let lift = 0;
    for (let pass = 0; pass < 4; pass++) {
      const hit = under(flag.getBoundingClientRect());
      if (!hit) return;
      const up = flag.getBoundingClientRect().bottom - hit.top + 8;
      if (root.getBoundingClientRect().top - up < 8) break;
      lift += up;
      root.style.setProperty("--eq-lift", `${Math.round(lift)}px`);
    }
    if (under(flag.getBoundingClientRect())) root.style.removeProperty("--eq-lift");
  };
  const soon = () => { queued ||= requestAnimationFrame(place); };
  addEventListener("resize", soon);
  addEventListener("scroll", soon, { capture: true, passive: true });
  root.addEventListener("click", soon);
  const tick = setInterval(soon, 1000); // a panel opening or a log growing moves what is under it, with no event to hear
  soon();
  return () => { clearInterval(tick); cancelAnimationFrame(queued); removeEventListener("resize", soon); removeEventListener("scroll", soon, { capture: true }); };
}
