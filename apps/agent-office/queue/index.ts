// The task queue's ✅ Finished list gets a search box, between its heading and Clear, loaded ahead of the office's
// own bundle like icons/. Nothing upstream is patched: the box goes in as the queue renders, and it matches each
// task's title, prompt, worker, branch and PR, plus the linked issue's title, body and labels, which it picks off
// the same socket messages the office's client reads them from.
import { didntStart, issueNumber, issueText, issuesIn, matches } from "./match.ts";

const issues = new Map<number, string>();

// the client's socket, with one more listener; added before the client sets onmessage, so it hears first
const Native = window.WebSocket;
window.WebSocket = class extends Native {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.addEventListener("message", e => {
      const items = issuesIn(e.data);
      if (!items) return;
      issues.clear();
      for (const i of items) issues.set(i.number, issueText(i));
    });
  }
};

// the queue re-renders whole (on every change, and every 30s), so the box is rebuilt each time with what was typed
let query = "";
let focused = false;
let caret = 0;
let dialog: Element | null = null;
// show only the tasks that never started (the office files those under Finished too)
let failedOnly = false;

function filter(h4: Element) {
  const list = h4.nextElementSibling;
  if (!list?.matches("ul.queue-list")) return;
  const items = [...list.children] as HTMLElement[];
  let shown = 0;
  let failed = 0;
  for (const li of items) {
    const title = li.querySelector(".queue-title");
    const n = issueNumber(title?.querySelector("a")?.getAttribute("href"));
    const text = [li.textContent, title?.getAttribute("title"), n === undefined ? "" : issues.get(n)].join("\n");
    const bad = didntStart(li.textContent ?? "");
    li.classList.toggle("rb-queue-failed", bad);
    if (bad) failed++;
    const hit = matches(query, text) && (!failedOnly || bad);
    li.style.display = hit ? "" : "none";
    if (hit) shown++;
  }
  const count = h4.querySelector(".count");
  if (count) count.textContent = query.trim() || failedOnly ? `${shown} / ${items.length}` : String(items.length);
  const toggle = h4.querySelector<HTMLButtonElement>(".rb-queue-failed-toggle");
  if (toggle) {
    toggle.hidden = !failed && !failedOnly;
    toggle.querySelector("span")!.textContent = String(failed);
    toggle.setAttribute("aria-pressed", String(failedOnly));
    const tip = `${failed} didn't start (filed under Finished, but never ran): ${failedOnly ? "showing only these" : "show only these"}`;
    toggle.title = tip;
    toggle.setAttribute("aria-label", tip);
  }
  if (list.nextElementSibling?.classList.contains("rb-queue-none")) list.nextElementSibling.remove();
  if (!shown && items.length) {
    const none = document.createElement("p");
    none.className = "note rb-queue-none";
    none.textContent = "No finished task matches.";
    list.after(none);
  }
}

function enhance(h4: Element, clear: Element) {
  // a new opening of the queue starts with an empty box
  const modal = h4.closest(".modal");
  if (modal !== dialog) [dialog, query, focused, failedOnly] = [modal, "", false, false];
  // lucide triangle-alert with the count beside it; the words are the tooltip
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn rb-queue-failed-toggle";
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/></svg><span></span>';
  toggle.addEventListener("click", () => {
    failedOnly = !failedOnly;
    filter(h4);
  });
  const input = document.createElement("input");
  input.type = "search";
  input.className = "rb-queue-search";
  input.placeholder = "Search finished…";
  input.setAttribute("aria-label", "Search finished tasks and their issues");
  input.value = query;
  input.addEventListener("input", () => {
    query = input.value;
    caret = input.selectionStart ?? query.length;
    filter(h4);
  });
  input.addEventListener("keyup", () => (caret = input.selectionStart ?? caret));
  input.addEventListener("focus", () => (focused = true));
  // a re-render takes the box away mid-typing; only a blur that leaves it on the page is the user moving on
  input.addEventListener("blur", () => queueMicrotask(() => input.isConnected && (focused = false)));
  clear.before(input);
  clear.before(toggle);
  if (focused) {
    input.focus();
    input.setSelectionRange(caret, caret);
  }
  filter(h4);
}

function scan() {
  for (const h4 of document.querySelectorAll(".queue h4")) {
    if (h4.querySelector(".rb-queue-search")) continue;
    const clear = [...h4.querySelectorAll("button")].find(b => b.textContent?.trim() === "Clear");
    if (clear) enhance(h4, clear);
  }
}

function start() {
  const style = document.createElement("style");
  style.textContent = ".queue h4 .rb-queue-search{margin-left:auto;width:min(220px,45%);min-width:0;padding:3px 9px;" +
    "font:inherit;font-size:13px;font-weight:600;text-transform:none;letter-spacing:0;color:inherit;background:#fff;" +
    "border:2px solid var(--ink,#222);border-radius:9px}" +
    ".queue h4 .rb-queue-search+.btn{margin-left:0}" +
    ".queue h4 .rb-queue-failed-toggle{display:inline-flex;align-items:center;gap:4px;color:#b42318;white-space:nowrap}" +
    ".queue h4 .rb-queue-failed-toggle[aria-pressed=true]{background:#b42318;color:#fff}" +
    ".queue h4 .rb-queue-failed-toggle[hidden]{display:none}" +
    ".queue li.rb-queue-failed{border-color:#b42318!important;box-shadow:inset 6px 0 0 #b42318}";
  document.head.append(style);
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
