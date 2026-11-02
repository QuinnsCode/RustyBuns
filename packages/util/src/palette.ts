// The Cmd/Ctrl+K palette over a page's commands (commands.ts): what an agent calls over WebMCP, a person finds by
// typing. codeSplitter's palette is the model. The core is plain markup with class names (rb-pal, rb-pal-q, ...) and
// no style; `skin: true` (the default) adds the house look once, which a game themes with its own --rb-pal-* tokens:
//
//   --rb-pal-bg  --rb-pal-fg  --rb-pal-muted  --rb-pal-line  --rb-pal-hover  --rb-pal-accent  --rb-pal-scrim  --rb-pal-font
//
// Keys typed into it stop at it, so a game under it doesn't steer while you type. A read-only command shows its
// answer in the palette; anything else closes it and runs.
import { askArgs, type Command, listCommands, rankCommands, runCommand, watchCommands } from "./commands.ts";
import { esc } from "./index.ts";

export interface PaletteOptions {
  /** The house look (default true). false leaves the markup unstyled for a page's own CSS. */
  skin?: boolean;
  /** The letter that opens it with Cmd or Ctrl (default "k"). */
  hotkey?: string;
  placeholder?: string;
  /** A small corner button that opens it, for a phone with no keyboard (a lucide `command` icon). Use it where the HUD has room. */
  button?: boolean;
  /** What the foot line says. */
  foot?: string;
}

export interface Palette { open(): void; close(): void; readonly el: HTMLElement }

let mounted: Palette | null = null;

/** Mount the palette (once per page; a second call answers with the first). */
export function mountPalette(o: PaletteOptions = {}): Palette {
  if (mounted) return mounted;
  if (o.skin !== false && !document.getElementById("rb-pal-skin")) {
    const st = document.createElement("style");
    st.id = "rb-pal-skin";
    st.textContent = SKIN;
    document.head.append(st);
  }
  const el = document.createElement("div");
  el.className = "rb-pal";
  el.hidden = true;
  el.innerHTML = `<div class="rb-pal-sheet" role="dialog" aria-modal="true" aria-label="Commands">
  <div class="rb-pal-q"><span class="rb-pal-ask" hidden></span><input aria-label="Command" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
  <ul class="rb-pal-list" role="listbox"></ul>
  <pre class="rb-pal-out" hidden></pre>
  <div class="rb-pal-foot">${esc(o.foot ?? "Every command here is a tool an agent in the browser can call too.")}</div>
</div>`;
  document.body.append(el);
  const input = el.querySelector("input")!, list = el.querySelector("ul")!, out = el.querySelector("pre")!, askTag = el.querySelector<HTMLElement>(".rb-pal-ask")!;
  const placeholder = o.placeholder ?? "Type a command";
  let shown: Command[] = [], at = 0, asking: Command | null = null, back: Element | null = null;

  const say = (text: string, bad = false) => { out.hidden = !text; out.textContent = text; out.classList.toggle("bad", bad); };
  const render = () => {
    if (asking) {
      list.innerHTML = `<li class="on" role="option" aria-selected="true"><span>${esc(asking.title)}: press Enter</span></li>`;
      return;
    }
    shown = rankCommands(listCommands().filter((c) => c.palette !== false), input.value);
    at = Math.min(at, Math.max(0, shown.length - 1));
    const sections = !input.value.trim();
    let group: string | undefined;
    list.innerHTML = shown.length ? shown.map((c, i) => (sections && c.group && c.group !== group ? `<li class="rb-pal-group" role="presentation">${esc((group = c.group))}</li>` : "")
      + `<li data-i="${i}" role="option" aria-selected="${i === at}" class="${i === at ? "on" : ""}"><span>${esc(c.title)}${c.ask ? "…" : ""}</span>${c.keys ? `<kbd>${esc(c.keys)}</kbd>` : ""}</li>`).join("")
      : `<li class="rb-pal-none" role="presentation">No command matches</li>`;
    list.querySelector("li.on")?.scrollIntoView({ block: "nearest" });
  };
  const open = () => {
    asking = null; askTag.hidden = true; input.placeholder = placeholder; say("");
    if (el.hidden) back = document.activeElement;
    el.hidden = false; input.value = ""; at = 0; render(); input.focus();
  };
  const close = () => { el.hidden = true; if (back instanceof HTMLElement) back.focus(); back = null; };
  const run = async (c: Command | undefined) => {
    if (!c) return;
    if (c.ask && !asking) { asking = c; askTag.hidden = false; askTag.textContent = c.title; input.value = ""; input.placeholder = c.ask; say(""); render(); return; }
    const line = input.value.trim();
    if (c.ask && !line) return;
    const keep = !!c.annotations?.readOnlyHint;
    if (!keep) close();
    try {
      const answer = await runCommand(c.name, c.ask ? askArgs(c, line) : {});
      if (keep) say(typeof answer === "string" ? answer : JSON.stringify(answer, null, 1));
    } catch (e) {
      if (el.hidden) open();
      say(e instanceof Error ? e.message : String(e), true);
    }
  };

  input.addEventListener("input", () => { at = 0; say(""); render(); });
  el.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the game under it doesn't get the keys
    if (e.key === "Escape") { e.preventDefault(); return asking ? open() : close(); }
    if (asking) { if (e.key === "Enter") { e.preventDefault(); void run(asking); } return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length); render(); }
    else if (e.key === "Enter") { e.preventDefault(); void run(shown[at]); }
  });
  el.addEventListener("keyup", (e) => e.stopPropagation());
  list.addEventListener("click", (e) => { const li = e.target instanceof Element ? e.target.closest<HTMLElement>("li[data-i]") : null; if (li) void run(shown[Number(li.dataset.i)]); });
  el.addEventListener("click", (e) => { if (e.target === el) close(); });
  const key = (o.hotkey ?? "k").toLowerCase();
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key) { e.preventDefault(); e.stopPropagation(); el.hidden ? open() : close(); }
  }, { capture: true });
  if (o.button) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "rb-pal-btn"; b.title = b.ariaLabel = "Commands";
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>`;
    b.addEventListener("click", () => (el.hidden ? open() : close()));
    document.body.append(b);
  }
  watchCommands(() => { if (!el.hidden) render(); });
  return (mounted = { open, close, el });
}

// The house look: codeSplitter's sheet (white, one grey outline, the one orange), dark under prefers-color-scheme.
const SKIN = `
.rb-pal { --_bg: var(--rb-pal-bg, #fff); --_fg: var(--rb-pal-fg, #0a0a0a); --_muted: var(--rb-pal-muted, #6b6b6b); --_line: var(--rb-pal-line, #cfcfcf);
  --_hover: var(--rb-pal-hover, #f3f3f3); --_accent: var(--rb-pal-accent, #e8590c); --_scrim: var(--rb-pal-scrim, rgba(255,255,255,.6));
  position: fixed; inset: 0; z-index: 2147483000; background: var(--_scrim); backdrop-filter: blur(3px); display: grid; justify-items: center; align-items: start; padding: 12vh 16px 0;
  font: 14px/1.4 var(--rb-pal-font, ui-sans-serif, system-ui, -apple-system, sans-serif); color: var(--_fg); }
@media (prefers-color-scheme: dark) { .rb-pal { --_bg: var(--rb-pal-bg, #121212); --_fg: var(--rb-pal-fg, #f2f2f2); --_muted: var(--rb-pal-muted, #a0a0a0);
  --_line: var(--rb-pal-line, #3d3d3d); --_hover: var(--rb-pal-hover, #232323); --_accent: var(--rb-pal-accent, #f08c4a); --_scrim: var(--rb-pal-scrim, rgba(0,0,0,.6)); } }
.rb-pal-btn { position: fixed; right: max(10px, env(safe-area-inset-right)); bottom: max(10px, env(safe-area-inset-bottom)); z-index: 2147482999; width: 40px; height: 40px; display: grid; place-items: center; padding: 0; cursor: pointer;
  border: 2px solid var(--rb-pal-line, #cfcfcf); border-radius: 12px; background: var(--rb-pal-bg, #fff); color: var(--rb-pal-fg, #0a0a0a); opacity: .85; }
@media (prefers-color-scheme: dark) { .rb-pal-btn { border-color: var(--rb-pal-line, #3d3d3d); background: var(--rb-pal-bg, #121212); color: var(--rb-pal-fg, #f2f2f2); } }
.rb-pal[hidden] { display: none; }
.rb-pal-sheet { width: min(600px, 100%); background: var(--_bg); border: 2px solid var(--_line); border-radius: 14px; box-shadow: 0 24px 64px -16px rgba(0,0,0,.3); overflow: hidden; }
.rb-pal-q { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--_line); }
.rb-pal-q input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: 16px; padding: 4px 0; }
.rb-pal-ask { font-size: 12px; font-weight: 600; border: 1px solid var(--_line); border-radius: 6px; padding: 1px 7px; white-space: nowrap; }
.rb-pal kbd { margin-left: auto; font: 500 11px ui-monospace, Menlo, monospace; border: 1px solid var(--_line); border-radius: 5px; padding: 0 5px; color: var(--_muted); }
.rb-pal-list { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow: auto; }
.rb-pal-list li { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; cursor: pointer; }
.rb-pal-list li.on { background: var(--_hover); box-shadow: inset 3px 0 0 var(--_accent); }
.rb-pal-list .rb-pal-group { padding: 10px 10px 3px; font: 600 11px ui-monospace, Menlo, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--_muted); cursor: default; }
.rb-pal-list .rb-pal-none { color: var(--_muted); cursor: default; }
.rb-pal-out { margin: 0; padding: 10px 14px; max-height: 30vh; overflow: auto; border-top: 1px solid var(--_line); font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
.rb-pal-out.bad { color: #d32f2f; }
.rb-pal-foot { padding: 8px 14px; border-top: 1px solid var(--_line); font-size: 12px; color: var(--_muted); }
`;
