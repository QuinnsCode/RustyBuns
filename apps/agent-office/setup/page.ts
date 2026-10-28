// Settings › Connections: one card per thing the office is connected to (status light, Test, Revoke), an empty state, and
// a first-run walk-through. Data and wording come from model.ts; this file only draws.
import { CircleAlert, Hammer, KeyRound, Plug, RefreshCw, Trash2, createElement, type IconNode } from "lucide";
import { LIGHT, WALKTHROUGH, accessWords, act, connectGithub, isFirstRun, loadBuilder, loadSetup, nightlyLine, type Builder, type Connection, type Pending, type Setup } from "./model.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
// a card carries its kind, id and status as data-attributes (dataset is read-only, so it can't go through el's props)
const data = <E extends HTMLElement>(e: E, d: Record<string, string>) => { Object.assign(e.dataset, d); return e; };
const icon = (node: IconNode) => createElement(node);
// an icon button: the word is the tooltip and the accessible name, so nothing wraps on a narrow screen
const button = (node: IconNode, word: string, onclick: () => void) => el("button", { className: "rb-setup-btn", title: word, ariaLabel: word, onclick }, icon(node));

const STYLE = `
.rb-setup-card{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 0;border-top:1px solid rgba(128,128,128,.25)}
.rb-setup-card .grow{flex:1 1 140px;min-width:0;overflow-wrap:anywhere}
.rb-setup-light{width:10px;height:10px;border-radius:50%;flex:none;background:#888}
.rb-setup-light.green{background:#2da44e}.rb-setup-light.red{background:#d1242f}.rb-setup-light.amber{background:#d4a72c}
.rb-setup-badge{font-size:11px;padding:1px 6px;border-radius:8px;border:1px solid currentColor;opacity:.8;white-space:nowrap}
.rb-setup-btn{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px}
.rb-setup-btn svg{width:16px;height:16px}
.rb-setup-code{font:600 20px/1.2 monospace;letter-spacing:.15em;user-select:all}
.rb-setup-steps{margin:4px 0 8px;padding-left:20px}
`;

function card(c: Connection, busy: string | null, run: (what: "test" | "revoke", id: string) => void) {
  const light = LIGHT[c.status];
  const ico = c.kind === "builder" ? Hammer : c.kind === "github" ? KeyRound : Plug;
  return data(el("div", { className: "rb-setup-card" },
    el("span", { className: `rb-setup-light ${light.tone}`, title: light.words, role: "img", ariaLabel: light.words }),
    icon(ico),
    el("span", { className: "grow" }, el("strong", {}, c.kind), " ", c.account || "(none)"),
    el("span", { className: "rb-setup-badge", title: c.access === "write" ? "Can change things" : "Can only look" }, accessWords(c.access)),
    busy === c.id ? el("span", { className: "setting-note" }, "Working…") : "",
    button(RefreshCw, `Test ${c.kind} ${c.account}`, () => run("test", c.id)),
    // the builder is the office's own setting (BUILDER_HOST): nothing here to revoke
    ...(c.kind === "builder" ? [] : [button(Trash2, `Revoke ${c.kind} ${c.account}`, () => run("revoke", c.id))])), { kind: c.kind, id: c.id, status: c.status });
}

function waiting(p: Pending, cancel: () => void) {
  return data(el("div", { className: "rb-setup-card" },
    el("span", { className: `rb-setup-light ${LIGHT.pending.tone}`, title: LIGHT.pending.words, role: "img", ariaLabel: LIGHT.pending.words }),
    el("span", { className: "grow" }, "Enter ", el("span", { className: "rb-setup-code" }, p.userCode), " at ",
      el("a", { href: p.uri, target: "_blank", rel: "noopener" }, p.uri.replace(/^https?:\/\//, "")), ". This page updates when you're done."),
    button(Trash2, "Cancel this sign-in", cancel)), { kind: "pending", id: p.id });
}

function section() {
  const root = el("div", { className: "setting rb-setup" }, el("style", {}, STYLE));
  const body = el("div");
  const note = el("p", { className: "setting-note", role: "status" });
  root.append(body, note);
  let state: Setup | null = null, builder: Builder | null = null, busy: string | null = null, timer: ReturnType<typeof setTimeout> | undefined;

  const say = (e: unknown) => { note.textContent = e instanceof Error ? e.message : String(e); };
  // the builder card costs an ssh, so it reloads on open and on its own Test, not on every look at a waiting sign-in
  const refresh = async (withBuilder = true) => {
    clearTimeout(timer);
    try { state = await loadSetup(); if (withBuilder) builder = await loadBuilder(); note.textContent = state.error ?? ""; } catch (e) { say(e); }
    draw();
    // while a sign-in waits, look again until the account shows up
    if (root.isConnected && state?.pending.length) timer = setTimeout(() => void refresh(false), 3000);
  };
  const run = async (what: "test" | "revoke" | "cancel", id: string) => {
    busy = id; draw();
    // the builder isn't on the connections route: its Test is just asking /__rb/builder again
    try { if (id !== "builder") await act(what, id); } catch (e) { say(e); }
    busy = null;
    await refresh(id === "builder");
  };
  const connect = async () => { try { await connectGithub(); } catch (e) { say(e); } await refresh(false); };

  const draw = () => {
    if (!state) return body.replaceChildren(el("p", { className: "setting-note" }, "Loading…"));
    const cards = [...state.connections, ...(builder?.connections ?? [])];
    const bld = builder?.connections[0];
    body.replaceChildren(
      el("div", { className: "setting-head" }, el("h4", {}, "Connections"),
        el("button", { title: "Connect another GitHub account", disabled: !state.ready, onclick: () => void connect() }, icon(Plug), " Connect GitHub")),
      ...(!state.ready ? [el("p", { className: "setting-note" }, icon(CircleAlert), " GitHub sign-in isn't set up on this office yet.")] : []),
      ...(isFirstRun(state) ? [el("p", { className: "setting-note" }, "First time here? Three steps:"), el("ol", { className: "rb-setup-steps" }, ...WALKTHROUGH.map((s) => el("li", {}, s)))] : []),
      ...state.pending.map((p) => waiting(p, () => void run("cancel", p.id))),
      ...(state.connections.length || state.pending.length ? [] : [el("p", { className: "setting-note" }, "Nothing is connected yet.")]),
      ...cards.map((c) => card(c, busy, (w, id) => void run(w, id))),
      ...(builder && bld ? [el("p", { className: "setting-note" }, bld.status === "ok" ? nightlyLine(builder.nightly)
        : ["On the build Mac, run: ", el("code", {}, builder.setup), ", then here: echo 'export BUILDER_HOST=you@Your-Mac.local' >> ~/.zshenv, and restart the office"])] : []));
  };
  void refresh();
  return root;
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-setup")) pane.append(section());
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
