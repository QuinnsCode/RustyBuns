// Ester, Mervin and Dexter (who reads the session transcripts for where the tokens went), the office's helpers, as three badges in a corner of the page. Click one to call on it: Ester
// (a skeleton, naturally) runs the board check and sorts what fails by who owns it, Mervin lists the open PRs and how
// they merge. Her `hold` list shows on his card, since what she says to hold back is what he must not merge.
// The runs are the office's (ester/run.ts, /__rb/helpers); this polls them while one is going.
import { Skull, GitMerge, Scissors, createElement, type IconNode } from "lucide";
import { hot } from "../reload/hot.ts";
import type { ContextAlert, ModeEvent } from "./dexter.ts";
import type { EsterState } from "./run.ts";

type Name = "ester" | "mervin" | "dexter";
const WHO: Record<Name, { label: string; icon: IconNode; ask: string; job: string }> = {
  ester: { label: "Ester", icon: Skull, ask: "Run the board check and sort what fails", job: "Testing: unclogs the test line by saying who owns each failing test." },
  mervin: { label: "Mervin", icon: GitMerge, ask: "List the open PRs and how they merge", job: "Merging: guards the merge line, and won't merge what Ester says to hold." },
  dexter: { label: "Dexter", icon: Scissors, ask: "Find where the tokens go and what to trim", job: "Tokens: names the tools whose output cost the most; never tests or merges." },
};
const HEADER = { "x-rb-triage": "1" };
const IDLE: EsterState = { phase: "idle", lines: [], hold: [] };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const clock = (s: EsterState) => {
  const t = Math.round(((s.endedAt ?? Date.now()) - (s.startedAt ?? Date.now())) / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

function mount() {
  const style = el("style");
  style.dataset.rbHelpers = "";
  style.textContent =
    ".rb-helpers{position:fixed;bottom:12px;left:12px;z-index:2147482000;display:flex;flex-direction:column;gap:8px;font:13px/1.4 system-ui,sans-serif}" +
    ".rb-helper-row{display:flex;gap:8px}" +
    ".rb-helper{width:40px;height:40px;border:2px solid #e8a33d;border-radius:50%;background:#fffdf7;color:#222;cursor:pointer;display:grid;place-items:center;position:relative}" +
    ".rb-helper svg{width:22px;height:22px}.rb-helper[data-phase=running]{animation:rb-helper-bob 1s ease-in-out infinite}" +
    ".rb-helper[data-phase=red]::after,.rb-helper[data-phase=green]::after{content:'';position:absolute;top:-2px;right:-2px;width:11px;height:11px;border-radius:50%;border:2px solid #fffdf7}" +
    ".rb-helper[data-context]::before{content:'';position:absolute;top:-2px;left:-2px;width:11px;height:11px;border-radius:50%;border:2px solid #fffdf7;background:#e8a33d}" +
    ".rb-helper[data-context=handoff]::before{background:#c0392b;animation:rb-helper-bob 1s ease-in-out infinite}" +
    ".rb-helper[data-phase=red]::after{background:#c0392b}.rb-helper[data-phase=green]::after{background:#2f8f46}" +
    "@keyframes rb-helper-bob{50%{transform:translateY(-4px)}}" +
    ".rb-helper-card{width:min(420px,calc(100vw - 24px));background:#fffdf7;color:#222;border:2px solid #e8a33d;border-radius:10px;padding:10px 12px;box-shadow:0 6px 20px #0004}" +
    ".rb-helper-head{display:flex;align-items:center;gap:8px;font-weight:600}.rb-helper-head span:first-child{flex:1}" +
    ".rb-helper-clock{font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}" +
    ".rb-helper-job{font-size:12px;opacity:.75;margin-top:2px}" +
    ".rb-helper-log{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:12em;overflow:auto;font:12px/1.35 ui-monospace,monospace}" +
    ".rb-helper-card button{border:0;border-radius:6px;padding:6px 14px;font:inherit;font-weight:600;background:#2f8f46;color:#fff;cursor:pointer}" +
    ".rb-helper-card button:disabled{opacity:.5;cursor:default}";
  document.head.append(style);
  const row = el("div", { className: "rb-helper-row" });
  const box = el("div", { className: "rb-helpers", role: "region", ariaLabel: "Helpers" }, row);
  document.body.append(box);
  return { box, row };
}

const boot = () => start(mount());
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });

function start(m: { box: HTMLElement; row: HTMLElement }) {
  const states: Record<Name, EsterState> = { ester: IDLE, mervin: IDLE, dexter: IDLE };
  let open: Name | undefined, card: HTMLElement | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let code: ModeEvent[] = []; // the latest code-mode programs Dexter saw (a line each on his card, and an rb:code-mode event on window)
  let over: ContextAlert[] = [], live: string[] = []; // Dexter's watch on live sessions: what each carries and has used, and which should hand off (a dot on his badge, the lines on his card)
  const badges = {} as Record<Name, HTMLButtonElement>;

  const render = () => {
    for (const n of Object.keys(WHO) as Name[]) badges[n].dataset.phase = states[n].phase;
    if (over.length) badges.dexter.dataset.context = over.some((a) => a.level === "handoff") ? "handoff" : "warn";
    else delete badges.dexter.dataset.context;
    card?.remove();
    card = undefined;
    if (!open) return;
    const s = states[open], who = WHO[open];
    const go = el("button", { title: who.ask, disabled: s.phase === "running" }, s.phase === "running" ? "On it…" : s.phase === "idle" ? "Call on " + who.label : "Again");
    go.onclick = () => call(open!);
    const held = open === "mervin" && states.ester.hold.length ? `Ester says hold ${states.ester.hold.map((n) => `#${n}`).join(", ")}: don't merge ${states.ester.hold.length > 1 ? "them" : "it"} yet.\n` : "";
    card = el("div", { className: "rb-helper-card" },
      el("div", { className: "rb-helper-head" }, el("span", {}, `${who.label}: ${s.phase === "idle" ? who.ask : s.phase}`), el("span", { className: "rb-helper-clock" }, s.startedAt ? clock(s) : "")),
      el("div", { className: "rb-helper-job" }, who.job),
      el("div", { className: "rb-helper-log" }, held + (open === "dexter" && live.length ? [...live, ...over.map((a) => a.message), ...code.map((e) => e.message)].join("\n") + "\n" : "") + (s.error ? s.error + "\n" : "") + s.lines.slice(-40).join("\n")),
      go);
    m.box.prepend(card);
  };

  let stopped = false;
  hot("rb-ester", () => { stopped = true; clearTimeout(timer); m.box.remove(); document.querySelectorAll("style[data-rb-helpers]").forEach(n => n.remove()); });
  const poll = async () => {
    try {
      const res = await fetch("/__rb/helpers", { credentials: "same-origin" });
      // signed out (sent to /login), or an office without the route: nothing to show, no point asking again
      if (res.redirected || res.status === 401 || res.status === 404) return;
      if (res.ok) Object.assign(states, await res.json());
      const ctx = await fetch("/__rb/context", { credentials: "same-origin" }).then((c) => (c.ok ? (c.json() as Promise<{ lines: string[]; over: ContextAlert[]; fresh: ContextAlert[]; code?: ModeEvent[] }>) : null), () => null);
      if (ctx) {
        over = ctx.over; live = ctx.lines;
        if (ctx.code?.length) {
          code = [...ctx.code, ...code].slice(0, 5);
          for (const e of ctx.code) window.dispatchEvent(new CustomEvent("rb:code-mode", { detail: e }));
        }
        if (ctx.fresh.some((a) => a.level === "handoff")) open = "dexter"; // a session just passed the handoff line: his card opens once, naming it
      }
      render();
    } catch {}
    if (!stopped) timer = setTimeout(poll, Object.values(states).some((s) => s.phase === "running") ? 2000 : 15000);
  };

  async function call(n: Name) {
    try {
      const res = await fetch(`/__rb/helpers/${n}`, { method: "POST", credentials: "same-origin", headers: HEADER });
      if (!res.ok) states[n] = { ...IDLE, phase: "error", error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The office answered ${res.status}` };
      else states[n] = await res.json();
    } catch (e) { states[n] = { ...IDLE, phase: "error", error: (e as Error).message }; }
    render();
    clearTimeout(timer);
    timer = setTimeout(poll, 2000);
  }

  for (const n of Object.keys(WHO) as Name[]) {
    const b = el("button", { className: "rb-helper", title: `${WHO[n].label}: ${WHO[n].ask}`, ariaLabel: WHO[n].label });
    b.append(createElement(WHO[n].icon));
    b.onclick = () => { open = open === n ? undefined : n; render(); };
    badges[n] = b;
    m.row.append(b);
  }
  poll();
}
