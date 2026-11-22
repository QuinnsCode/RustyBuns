// The page's side of the Steam bridge (main.cjs answers). @rustybuns/shell-bun/steam reads
// window.rbSteam; off Steam there is no rbSteam and it falls back to its no-op twin.
// On a Steam Deck a focused text field opens Steam's floating keyboard over it.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const call = (op, ...args) => ipcRenderer.invoke("rb-steam", op, ...args);

contextBridge.exposeInMainWorld("rbSteam", {
  info: () => call("info"),
  achievement: (id) => call("achievement", id),
  presence: (key, value) => call("presence", key, value),
  invite: () => call("invite"),
  keyboard: (x, y, w, h, multi) => call("keyboard", x, y, w, h, multi),
});

const TEXT = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);
let deck = null;
window.addEventListener("focusin", async (e) => {
  const el = e.target;
  const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT.has(el.type)) || (el instanceof HTMLElement && el.isContentEditable);
  if (!field) return;
  if (deck === null) deck = !!(await call("info"))?.deck;
  if (!deck) return;
  const r = el.getBoundingClientRect(), s = window.devicePixelRatio || 1;
  void call("keyboard", r.left * s, r.top * s, r.width * s, r.height * s, el instanceof HTMLTextAreaElement);
});
