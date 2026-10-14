// The time on the issues and PR boards, and a Time zone setting for it. The boards' "Updated …" line is patched
// (scripts/rustybunsify.ts) to put globalThis.__rbClock(fetchedAt) in front of it; this defines that, and adds
// the setting to Settings › You as the office opens it. Kept in this browser, like the office's other "Just you"
// settings. Automatic follows the browser's zone.
import { hot } from "../reload/hot.ts";
import { KEY, browserZone, clock, zones } from "./time.ts";

const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const save = (zone: string) => { try { zone ? localStorage.setItem(KEY, zone) : localStorage.removeItem(KEY); } catch {} };

(globalThis as { __rbClock?: (at: number) => string }).__rbClock = (at) => clock(at, saved());

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

/** The setting, built like the office's own (div.setting, its head, a "Just you" scope). */
function setting() {
  // styled like the office's own pickers (the default worker's provider)
  const select = el("select", { className: "provider-select", ariaLabel: "Time zone" });
  const auto = browserZone();
  select.append(el("option", { value: "" }, `Automatic (${auto})`), ...zones().map(z => el("option", { value: z }, z.replaceAll("_", " "))));
  const now = saved();
  // a zone saved by a browser that knew it, read by one that doesn't, still shows as picked
  if (now && ![...select.options].some(o => o.value === now)) select.append(el("option", { value: now }, now));
  select.value = now ?? "";
  const note = el("p", { className: "setting-note" });
  const show = () => (note.textContent = `The issues and PR boards show when they last updated, like ${clock(Date.now(), saved()).slice(0, -3)}.`);
  select.addEventListener("change", () => { save(select.value); show(); });
  show();
  const scope = el("span", { className: "scope you", title: "Only for you, kept in this browser" }, "Just you");
  return el("div", { className: "setting rb-timezone" }, el("div", { className: "setting-head" }, el("h4", {}, "Time zone"), scope), select, note);
}

// the settings dialog lands whole, its panes already in it
function addTo(modal: Element) {
  const pane = modal.querySelector<HTMLElement>('section.settings-pane[aria-label="You"]');
  if (pane && !pane.querySelector(".rb-timezone")) pane.append(setting());
}

function watch() {
  document.querySelectorAll(".modal.settings").forEach(addTo);
  const observer = new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches(".modal.settings")) addTo(n);
      else n.querySelectorAll(".modal.settings").forEach(addTo);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  hot("rb-clock", () => { observer.disconnect(); document.querySelectorAll(".rb-timezone").forEach(n => n.remove()); });
}

if (document.body) watch();
else document.addEventListener("DOMContentLoaded", watch, { once: true });
