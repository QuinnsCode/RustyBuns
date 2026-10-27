// Settings › You gets a "Box" section when the office is run by `office:box`'s permission set (sandbox/server.ts):
// what the box may mount, its network, its variables, and whether the container and its port are healthy.
import type { Entry } from "../live/camera.ts";
import type { Edit, Perms } from "./box.ts";

type State = { from: string; perms: Perms; log: Entry[]; limits: { cpus: number; memory: string } | null; docker: boolean;
  health: { running: false } | { running: true; status: string; health: string; answers: boolean; healthy: boolean; restart: boolean } };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

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
    const save = () => void apply({ log: { maxMb: Number(size.value), keepDays: Number(keep.value) as 1 | 3 | 7 | 30 } });
    size.onchange = keep.onchange = save;
    const rows = s.log.map((l) => el("div", { className: "rb-box-row" }, new Date(l.at).toLocaleString(), el("code", {}, l.what), l.verdict));
    root.replaceChildren(
      ...(first ? [el("p", { className: "setting-note" }, "First run: everything outbound asks first, and what was asked is logged on this machine only. Pick how much disk the log may use and how long it keeps records (saving this creates your permission set).", el("button", { onclick: save }, "Save these"))] : []),
      el("div", { className: "setting-head" }, el("h4", {}, "Box"), el("span", { className: "scope", title: `Read from ${s.from}` }, ok ? "Healthy" : "Needs a look")),
      el("p", { className: "setting-note" }, healthLine(s)),
      ...(s.health.running && s.health.restart ? [el("p", { className: "setting-note" }, "The running box has other grants than this list. They apply when it starts again: bun run office:box up")] : []),
      ...(repos.length ? repos : [el("p", { className: "setting-note" }, "No folders are mounted.")]),
      el("div", { className: "rb-box-row" }, path, access, add),
      el("div", { className: "rb-box-row" }, "Network", network, s.limits ? `${s.limits.memory}, ${s.limits.cpus} cpus` : ""),
      ...(s.perms.network === "allowlist" ? [el("div", { className: "rb-box-row" }, "Allowed hosts", ...hosts, hostName, el("button", { onclick: () => void apply({ allow: { host: hostName.value, on: true } }) }, "Allow"))] : []),
      el("div", { className: "rb-box-row" }, "Variables", ...env, envName, el("button", { onclick: () => void apply({ env: { name: envName.value, on: true } }) }, "Pass in")),
      ...(s.perms.network === "allowlist" ? [el("div", { className: "rb-box-row" }, ask, "Ask before reaching any other host")] : []),
      el("div", { className: "rb-box-row" }, "Outbound log", size, "MB, keep", keep),
      ...(rows.length ? rows : [el("p", { className: "setting-note" }, "Nothing outbound has been asked yet.")]),
      note);
  };
  void apply();
  return root;
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-box")) pane.append(section());
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
