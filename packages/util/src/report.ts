// Telling the RustyBuns repo about a bug, a suggestion or an error from inside a game. `sendReport` posts to eqosys's /api/report with
// the player's token (eqosys limits it per account and files the GitHub issue, tagged `external` and with the game); `reportButton`
// is a small drop-in widget on top: a corner button, a short form, a thank-you. The game's `eqosys()` client (./eqosys.ts) exposes
// both as `report` and `reportButton`, so a game that signs in through eqosys needs one line: `reportButton()`.
import { readJson } from "./http.ts";
import { int, obj, opt, str } from "./guard.ts";
import { eqBadge, eqButton, wearSkin } from "./skin.ts";

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
  const top = Object.assign(document.createElement("div"), { className: "eq-head" });
  const shut = () => { form.hidden = true; open.focus(); };
  top.append(head, eqBadge(), eqButton({ text: "Close", icon: "x", onClick: shut }));
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
  form.append(top, kind, title, body, send, note);
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
  return () => root.remove();
}
