// The task queue's ✅ Finished list gets a search box, between its heading and Clear, loaded ahead of the office's
// own bundle like icons/. Nothing upstream is patched: the box goes in as the queue renders, and it matches each
// task's title, prompt, worker, branch and PR, plus the linked issue's title, body and labels, which it picks off
// the same socket messages the office's client reads them from.
import { issueNumber, issueText, issuesIn, matches } from "./match.ts";

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

function filter(h4: Element) {
  const list = h4.nextElementSibling;
  if (!list?.matches("ul.queue-list")) return;
  const items = [...list.children] as HTMLElement[];
  let shown = 0;
  for (const li of items) {
    const title = li.querySelector(".queue-title");
    const n = issueNumber(title?.querySelector("a")?.getAttribute("href"));
    const text = [li.textContent, title?.getAttribute("title"), n === undefined ? "" : issues.get(n)].join("\n");
    const hit = matches(query, text);
    li.style.display = hit ? "" : "none";
    if (hit) shown++;
  }
  const count = h4.querySelector(".count");
  if (count) count.textContent = query.trim() ? `${shown} / ${items.length}` : String(items.length);
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
  if (modal !== dialog) [dialog, query, focused] = [modal, "", false];
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
    ".queue h4 .rb-queue-search+.btn{margin-left:0}";
  document.head.append(style);
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
