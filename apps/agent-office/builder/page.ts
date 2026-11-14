// Settings › You gets a "Build computer" card: whether the builder Mac answers, the one-line setup when it doesn't, and
// last night's desktop builds (builder/server.ts).
import { createElement, Hammer } from "lucide";
import { el } from "@rustybuns/util/dom";
import { getJson } from "@rustybuns/util/http";
import { BuilderReply } from "../connect/types.ts";
import { nightlyLine } from "../setup/model.ts";

export { nightlyLine };

export function statusLine(s: Pick<BuilderReply, "connections">): string {
  const c = s.connections[0];
  if (!c || c.status === "unset") return "No build computer yet: BUILDER_HOST is not set";
  return c.status === "ok" ? `${c.account} answers` : `${c.account} does not answer over ssh`;
}

/** The setup command in a block that wraps on a narrow screen. */
function setupLine(text: string) {
  const code = el("code", {}, text);
  code.style.cssText = "display:block;white-space:pre-wrap;overflow-wrap:anywhere";
  return code;
}

function section() {
  const root = el("div", { className: "setting rb-builder" });
  const draw = (s: BuilderReply) => {
    const c = s.connections[0];
    const ok = c?.status === "ok";
    root.replaceChildren(
      el("div", { className: "setting-head" }, el("h4", {}, "Build computer"), el("span", { className: "scope", title: c?.status ?? "unset" }, createElement(Hammer), ok ? "Reachable" : "Needs a look")),
      el("p", { className: "setting-note" }, statusLine(s)),
      ...(ok ? [el("p", { className: "setting-note" }, nightlyLine(s.nightly))]
        : [el("p", { className: "setting-note" }, "On the build Mac, run:"), setupLine(s.setup), el("p", { className: "setting-note" }, "then, here: echo 'export BUILDER_HOST=you@Your-Mac.local' >> ~/.zshenv, and restart the office")]));
  };
  const failed = () => root.replaceChildren(el("p", { className: "setting-note" }, "The build computer's card did not load"));
  getJson("/__rb/builder", BuilderReply).then((b) => (b ? draw(b) : failed())).catch(failed);
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
