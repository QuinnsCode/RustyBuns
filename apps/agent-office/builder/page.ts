// Settings › You gets a "Build computer" card: whether the builder Mac answers, the one-line setup when it doesn't, and
// last night's desktop builds (builder/server.ts).
import { createElement, Hammer } from "lucide";
import type { Nightly, Status } from "./server.ts";

type State = { connections: { account: string; status: Status }[]; setup: string; nightly: Nightly | null };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

export function statusLine(s: State): string {
  const c = s.connections[0];
  if (!c || c.status === "unset") return "No build computer yet: BUILDER_HOST is not set";
  return c.status === "ok" ? `${c.account} answers` : `${c.account} does not answer over ssh`;
}

export function nightlyLine(n: Nightly | null): string {
  if (!n) return "No nightly results yet";
  const bad = n.results.filter((r) => !r.ok).map((r) => r.app);
  return `${new Date(n.at).toLocaleString()}: ${n.results.length - bad.length} of ${n.results.length} built${bad.length ? `, failed: ${bad.join(", ")}` : ""}`;
}

function section() {
  const root = el("div", { className: "setting rb-builder" });
  const draw = (s: State) => {
    const c = s.connections[0];
    const ok = c?.status === "ok";
    root.replaceChildren(
      el("div", { className: "setting-head" }, el("h4", {}, "Build computer"), el("span", { className: "scope", title: c?.status ?? "unset" }, createElement(Hammer), ok ? "Reachable" : "Needs a look")),
      el("p", { className: "setting-note" }, statusLine(s)),
      ...(ok ? [el("p", { className: "setting-note" }, nightlyLine(s.nightly))]
        : [el("p", { className: "setting-note" }, "On the build Mac, run:"), el("code", { style: "display:block;white-space:pre-wrap;overflow-wrap:anywhere" }, s.setup), el("p", { className: "setting-note" }, "then, here: echo 'export BUILDER_HOST=you@Your-Mac.local' >> ~/.zshenv, and restart the office")]));
  };
  fetch("/__rb/builder").then((r) => r.json()).then((b: State) => draw(b)).catch(() => root.replaceChildren(el("p", { className: "setting-note" }, "The build computer's card did not load")));
  return root;
}

function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-builder")) pane.append(section());
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
