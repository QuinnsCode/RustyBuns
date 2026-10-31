// Settings › You gets a "Box" section when the office is run by `office:box`'s permission set (sandbox/server.ts):
// what the box may mount, its network, its variables, and whether the container and its port are healthy.
import { Check, ScrollText, ShieldCheck, X, createElement, type IconNode } from "lucide";
import type { Entry } from "../live/camera.ts";
import type { Edit, Perms } from "./box.ts";

type State = { from: string; perms: Perms; log: Entry[]; limits: { cpus: number; memory: string } | null; docker: boolean;
  health: { running: false } | { running: true; status: string; health: string; answers: boolean; healthy: boolean; restart: boolean } };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// an icon button: the word is the tooltip and the accessible name, so nothing wraps on a narrow screen
const iconButton = (node: IconNode, word: string, onclick: () => void) => el("button", { title: word, ariaLabel: word, onclick, style: "display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px" }, createElement(node));

/** A page over the office (its own screen, not a line in Settings): a title, the body, and a close button. */
function page(title: string, ...kids: (Node | string)[]) {
  const shell = el("div", { className: "rb-box-page", role: "dialog", ariaLabel: title,
    style: "position:fixed;inset:0;z-index:2147483000;overflow:auto;background:rgba(0,0,0,.6);display:flex;justify-content:center;padding:16px" });
  const close = () => shell.remove();
  const panel = el("div", { style: "background:#1c1c1e;color:#eee;max-width:720px;width:100%;height:fit-content;padding:16px 20px;border-radius:10px" },
    el("div", { style: "display:flex;align-items:center;gap:8px" }, el("h3", { style: "flex:1;margin:0" }, title), iconButton(X, "Close", close)), ...kids);
  shell.append(panel);
  shell.onclick = (ev) => { if (ev.target === shell) close(); };
  document.body.append(shell);
  return close;
}

/** The first-run page: how outbound works here and the two questions the log needs. Saving writes the permission set. */
function firstRun(s: State, save: (maxMb: number, keepDays: 1 | 3 | 7 | 30) => Promise<void>) {
  const size = el("input", { type: "number", min: "1", value: String(s.perms.log.maxMb), ariaLabel: "Disk space for the log, in MB" });
  const keep = Object.assign(el("select", { ariaLabel: "How long to keep the log" }, ...[[1, "a day"], [3, "3 days"], [7, "a week"], [30, "a month"]].map(([d, t]) => el("option", { value: String(d) }, String(t)))), { value: String(s.perms.log.keepDays) });
  const row = (...kids: (Node | string)[]) => el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0" }, ...kids);
  const close = page("Set up the box",
    el("p", {}, "Everything the box reaches on the internet asks you first, with an Allow, Always or Deny card in the office. Always adds the host to the allowed list, so it isn't asked again."),
    el("p", {}, "What was asked, when, and what you answered is written to a log on this machine only. Requests to send a worker home go in the same log."),
    el("p", { className: "setting-note" }, "Only HTTPS to a host and port goes through the box's proxy. Plain HTTP and other protocols have no way out, so they aren't asked about."),
    row("The log may use", size, "MB of disk; the oldest lines go first."),
    row("Keep records for", keep),
    row(iconButton(Check, "Save and finish", () => void save(Number(size.value), Number(keep.value) as 1 | 3 | 7 | 30).then(() => close()))));
}

/** The whole log in one page, newest first. */
async function wholeLog() {
  const r = await fetch("/__rb/box?log=all");
  const body: unknown = await r.json();
  const log = typeof body === "object" && body !== null && "log" in body && Array.isArray(body.log) ? body.log as Entry[] : [];
  const rows = log.map((l) => el("tr", {}, el("td", {}, new Date(l.at).toLocaleString()), el("td", {}, l.kind === "home" ? "send home" : "outbound"), el("td", {}, l.who), el("td", { style: "overflow-wrap:anywhere" }, el("code", {}, l.what)), el("td", {}, l.verdict)));
  page(`Log (${log.length})`, log.length ? el("table", { style: "width:100%;font-size:13px;border-collapse:collapse" }, ...rows) : el("p", {}, "Nothing has been logged yet."));
}

const query = (e: Edit) => {
  if ("grant" in e) return { do: "grant", path: e.grant.path, access: e.grant.access };
  if ("revoke" in e) return { do: "revoke", path: e.revoke };
  if ("network" in e) return { do: "network", value: e.network };
  if ("allow" in e) return { do: "allow", value: e.allow.host, on: e.allow.on ? "1" : "0" };
  if ("port" in e) return { do: "port", value: String(e.port) };
  if ("ask" in e) return { do: "ask", on: e.ask ? "1" : "0" };
  if ("log" in e) return { do: "log", maxMb: String(e.log.maxMb), keepDays: String(e.log.keepDays) };
  return { do: "env", value: e.env.name, on: e.env.on ? "1" : "0" };
};

async function call(e?: Edit): Promise<State> {
  const r = await fetch(`/__rb/box${e ? `?${new URLSearchParams(query(e))}` : ""}`, { method: e ? "POST" : "GET" });
  const body: unknown = await r.json();
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
  if (!r.ok) throw new Error(typeof error === "string" ? error : "The box didn't answer");
  return body as State;
}

export function healthLine(s: State): string {
  const h = s.health;
  if (!s.docker) return "Docker isn't answering here, so the box can't be checked";
  if (!h.running) return "The box isn't running (bun run office:box up)";
  const port = s.perms.network !== "offline" ? `; port ${s.perms.port} ${h.answers ? "answers" : "does not answer"}` : "; offline, no port";
  return `${h.status}${h.health ? `, ${h.health}` : ""}${port}`;
}

function section() {
  const root = el("div", { className: "setting rb-box" });
  const note = el("p", { className: "setting-note" });
  const apply = async (e?: Edit) => {
    try { note.textContent = ""; draw(await call(e)); } catch (err) { note.textContent = err instanceof Error ? err.message : String(err); }
  };
  const draw = (s: State) => {
    const ok = s.health.running && s.health.healthy;
    const repos = s.perms.repos.map((r) => el("div", { className: "rb-box-row" },
      el("code", {}, r.path),
      Object.assign(el("select", { ariaLabel: `Access to ${r.path}` }, el("option", { value: "ro" }, "read only"), el("option", { value: "rw" }, "read and write")), { value: r.access, onchange: (ev: Event) => void apply({ grant: { path: r.path, access: (ev.target as HTMLSelectElement).value as "rw" | "ro" } }) }),
      el("button", { title: "Take this mount away", ariaLabel: `Revoke ${r.path}`, onclick: () => void apply({ revoke: r.path }) }, "Revoke")));
    const path = el("input", { placeholder: "~/projects/app", ariaLabel: "Folder to mount" });
    const access = el("select", { ariaLabel: "Access for the new mount" }, el("option", { value: "ro" }, "read only"), el("option", { value: "rw" }, "read and write"));
    const add = el("button", { onclick: () => void apply({ grant: { path: path.value, access: access.value as "rw" | "ro" } }) }, "Approve mount");
    const network = Object.assign(el("select", { ariaLabel: "Network" }, el("option", { value: "allowlist" }, "only the hosts below"), el("option", { value: "open" }, "open (the whole internet)"), el("option", { value: "offline" }, "offline")),
      { value: s.perms.network, onchange: (ev: Event) => void apply({ network: (ev.target as HTMLSelectElement).value as "open" | "allowlist" | "offline" }) });
    const hostName = el("input", { placeholder: "registry.npmjs.org", ariaLabel: "Host to allow" });
    const hosts = s.perms.allow.map((h) => el("button", { title: "Stop allowing this host", onclick: () => void apply({ allow: { host: h, on: false } }) }, h));
    const envName = el("input", { placeholder: "ANTHROPIC_API_KEY", ariaLabel: "Variable to pass in" });
    const env = s.perms.env.map((n) => el("button", { title: "Stop passing this variable", onclick: () => void apply({ env: { name: n, on: false } }) }, n));
    const first = s.from === "box.example.json"; // nothing saved yet: the two questions below start the permission set
    const ask = el("input", { type: "checkbox", checked: s.perms.ask, ariaLabel: "Ask before the box reaches a host that isn't allowed", onchange: (ev: Event) => void apply({ ask: (ev.target as HTMLInputElement).checked }) });
    const size = el("input", { type: "number", min: "1", value: String(s.perms.log.maxMb), ariaLabel: "Disk space for the log, in MB" });
    const keep = Object.assign(el("select", { ariaLabel: "How long to keep the log" }, ...[[1, "a day"], [3, "3 days"], [7, "a week"], [30, "a month"]].map(([d, t]) => el("option", { value: String(d) }, String(t)))), { value: String(s.perms.log.keepDays) });
    size.onchange = keep.onchange = () => void apply({ log: { maxMb: Number(size.value), keepDays: Number(keep.value) as 1 | 3 | 7 | 30 } });
    const rows = s.log.map((l) => el("div", { className: "rb-box-row" }, new Date(l.at).toLocaleString(), el("code", {}, l.what), l.verdict));
    root.replaceChildren(
      ...(first ? [el("p", { className: "setting-note" }, "First run: everything outbound asks first, and what was asked is logged on this machine only.", iconButton(ShieldCheck, "Set up the box", () => firstRun(s, async (maxMb, keepDays) => apply({ log: { maxMb, keepDays } }))))] : []),
      el("div", { className: "setting-head" }, el("h4", {}, "Box"), el("span", { className: "scope", title: `Read from ${s.from}` }, ok ? "Healthy" : "Needs a look")),
      el("p", { className: "setting-note" }, healthLine(s)),
      ...(s.health.running && s.health.restart ? [el("p", { className: "setting-note" }, "The running box has other grants than this list. They apply when it starts again: bun run office:box up")] : []),
      ...(repos.length ? repos : [el("p", { className: "setting-note" }, "No folders are mounted.")]),
      el("div", { className: "rb-box-row" }, path, access, add),
      el("div", { className: "rb-box-row" }, "Network", network, s.limits ? `${s.limits.memory}, ${s.limits.cpus} cpus` : ""),
      ...(s.perms.network === "allowlist" ? [el("div", { className: "rb-box-row" }, "Allowed hosts", ...hosts, hostName, el("button", { onclick: () => void apply({ allow: { host: hostName.value, on: true } }) }, "Allow"))] : []),
      el("div", { className: "rb-box-row" }, "Variables", ...env, envName, el("button", { onclick: () => void apply({ env: { name: envName.value, on: true } }) }, "Pass in")),
      ...(s.perms.network === "allowlist" ? [el("div", { className: "rb-box-row" }, ask, "Ask before reaching any other host")] : []),
      el("div", { className: "rb-box-row" }, "Log", size, "MB, keep", keep, iconButton(ScrollText, "Show the whole log", () => void wholeLog().catch((err) => { note.textContent = err instanceof Error ? err.message : String(err); }))),
      ...(rows.length ? rows : [el("p", { className: "setting-note" }, "Nothing outbound has been asked yet.")]),
      note);
  };
  void apply();
  return root;
}

type Repo = { repo: string; on: boolean };

/** The GitHub shutoff valves (askfirst/): a switch for the whole office and one per repo. A repo asks once, then it is on. */
function grantsSection() {
  const root = el("div", { className: "setting rb-grants" });
  const note = el("p", { className: "setting-note" });
  const apply = async (q?: Record<string, string>) => {
    try {
      note.textContent = "";
      const r = await fetch(`/__rb/grants${q ? `?${new URLSearchParams(q)}` : ""}`, { method: q ? "POST" : "GET", headers: q ? { "x-rb-ask": "1" } : {} });
      const body: unknown = await r.json();
      if (!r.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "The office didn't answer");
      const b = typeof body === "object" && body !== null ? body : {};
      draw("office" in b && b.office === false ? false : true, "repos" in b && Array.isArray(b.repos) ? b.repos as Repo[] : []);
    } catch (err) { note.textContent = err instanceof Error ? err.message : String(err); }
  };
  const row = (...kids: (Node | string)[]) => Object.assign(el("div", { className: "rb-box-row" }, ...kids), { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center" });
  const toggle = (label: string, on: boolean, change: (on: boolean) => void) =>
    el("input", { type: "checkbox", checked: on, ariaLabel: label, title: label, onchange: (ev: Event) => change((ev.target as HTMLInputElement).checked) });
  const draw = (office: boolean, repos: Repo[]) => {
    const rows = repos.map((g) => row(toggle(`GitHub writes to ${g.repo}`, g.on, (on) => void apply({ do: "repo", repo: g.repo, on: on ? "1" : "0" })), el("code", {}, g.repo), g.on ? "on" : "off",
      el("button", { title: "Forget this repo: its next write asks again", ariaLabel: `Ask again for ${g.repo}`, onclick: () => void apply({ do: "repo", repo: g.repo, on: "ask" }) }, "Ask again")));
    const repo = el("input", { placeholder: "owner/name", ariaLabel: "Repo to switch" });
    root.replaceChildren(
      el("div", { className: "setting-head" }, el("h4", {}, "GitHub writes")),
      el("p", { className: "setting-note" }, "Workers read freely. A repo's first write asks once; Always on its card switches the repo on. Switch one off, or the whole office, to stop every push, PR, comment and api write at once."),
      row(toggle("GitHub writes for the whole office", office, (on) => void apply({ do: "office", on: on ? "1" : "0" })), el("strong", {}, "Whole office"), office ? "on" : "off: every write is stopped"),
      ...(rows.length ? rows : [el("p", { className: "setting-note" }, "No repo decided yet: the first write to each asks.")]),
      row(repo, el("button", { onclick: () => void apply({ do: "repo", repo: repo.value, on: "1" }) }, "Switch on"), el("button", { onclick: () => void apply({ do: "repo", repo: repo.value, on: "0" }) }, "Switch off")),
      note);
  };
  void apply();
  return root;
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-box")) pane.append(section());
  if (pane && !pane.querySelector(".rb-grants")) pane.append(grantsSection());
}

if (typeof document !== "undefined") {
  const watch = () => {
    document.querySelectorAll(".modal.settings").forEach(addTo);
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches(".modal.settings")) addTo(n);
        else n.querySelectorAll(".modal.settings").forEach(addTo);
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
}
