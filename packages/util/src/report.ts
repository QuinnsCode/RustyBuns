// Telling the RustyBuns repo about a bug, a suggestion or an error from inside a game. `sendReport` posts to eqosys's /api/report with
// the player's token (eqosys limits it per account and files the GitHub issue, tagged `external` and with the game); `reportButton`
// is a small drop-in widget on top: a corner button, a short form, a thank-you. The game's `eqosys()` client (./eqosys.ts) exposes
// both as `report` and `reportButton`, so a game that signs in through eqosys needs one line: `reportButton()`.
import { readJson } from "./http.ts";
import { int, obj, opt, str } from "./guard.ts";

export type ReportKind = "bug" | "suggestion" | "error";
export interface ReportIn { kind: ReportKind; title: string; body: string; page?: string; build?: string; detail?: string }
export type Sent = { ok: true; issue: number | null } | { ok: false; error: string };

const Reply = obj({ issue: opt(int(1, 1e9)), error: opt(str(300)) });

/** POST the report. `token` is the one eqosys handed the game; `url` is eqosys's origin. Never throws. */
export async function sendReport(url: string, token: string, r: ReportIn): Promise<Sent> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/report`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ page: location.pathname + location.search, ...r }),
  }).catch(() => null);
  if (!res) return { ok: false, error: "couldn't reach eqosys: check your connection" };
  const body = await readJson(res, Reply);
  return res.ok ? { ok: true, issue: body?.issue ?? null } : { ok: false, error: body?.error ?? `eqosys said ${res.status}` };
}

/** What the widget needs from the game's sign-in: the saved login (null when signed out), and a way to start signing in. */
export interface ReportHost { token: () => string | null; url: () => string; signIn: () => void; build?: string }

/** A floating "Report" button that opens a short form. Returns a function that removes it. */
export function mountReportButton(host: ReportHost, parent: HTMLElement = document.body): () => void {
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483000;font:14px system-ui,sans-serif";
  const open = document.createElement("button");
  open.type = "button"; open.textContent = "Report"; open.title = "Report a bug or suggest something";
  open.style.cssText = "padding:6px 10px;border-radius:8px;border:1px solid #888;background:#fffe;cursor:pointer";
  const form = document.createElement("form");
  form.hidden = true;
  form.style.cssText = "display:grid;gap:6px;width:min(320px,90vw);padding:10px;border-radius:10px;border:1px solid #888;background:#fff;color:#111;margin-bottom:6px";
  const kind = Object.assign(document.createElement("select"), { innerHTML: `<option value="bug">Bug</option><option value="suggestion">Suggestion</option><option value="error">Something broke</option>` });
  const title = Object.assign(document.createElement("input"), { placeholder: "In a few words", maxLength: 120, required: true, minLength: 3 });
  const body = Object.assign(document.createElement("textarea"), { placeholder: "What happened, or what would be better?", maxLength: 4000, rows: 5 });
  const send = Object.assign(document.createElement("button"), { type: "submit", textContent: "Send" });
  const note = document.createElement("div");
  note.setAttribute("role", "status");
  form.append(kind, title, body, send, note);
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
