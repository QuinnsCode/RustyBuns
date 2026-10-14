// Tells an open page when the office's code changed. A new page script or skin: the page refreshes itself (or offers
// Refresh while you're typing). New server code: says a restart is needed, with a Restart button when office:mama
// is minding the office, then shows "coming back" until the new office answers, and reloads. The state is the
// office's (live/reload.ts, /__rb/reload).
import type { ReloadState } from "../live/reload.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const typing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
};

function mount() {
  const style = el("style");
  style.textContent =
    ".rb-reload{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;display:none;align-items:center;gap:10px;" +
    "background:#fffdf7;color:#222;border:2px solid #e8a33d;border-radius:10px;padding:8px 12px;box-shadow:0 6px 20px #0004;font:13px/1.4 system-ui,sans-serif;max-width:calc(100vw - 24px)}" +
    ".rb-reload[data-on]{display:flex}.rb-reload button{border:2px solid #e8a33d;background:#fff;border-radius:6px;padding:2px 10px;cursor:pointer;font:inherit}";
  const text = el("span"), button = el("button");
  const bar = el("div", { className: "rb-reload", role: "status" }, text, button);
  document.head.append(style);
  document.body.append(bar);
  const show = (msg: string, action?: [string, () => void]) => {
    text.textContent = msg;
    button.hidden = !action;
    if (action) { button.textContent = action[0]; button.onclick = action[1]; }
    bar.dataset.on = "1";
  };

  let first: ReloadState | undefined, restarting = false, misses = 0, timer: ReturnType<typeof setTimeout>;
  const next = () => { timer = setTimeout(poll, restarting || misses ? 1000 : 2500); };

  async function restart() {
    restarting = true;
    show("Restarting the office, coming back in a moment (workers keep running)…");
    try {
      const res = await fetch("/__rb/reload/restart", { method: "POST", credentials: "same-origin", headers: { "x-rb-triage": "1" } });
      if (!res.ok) { restarting = false; show(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The office answered ${res.status}`); }
    } catch {}
  }

  async function poll() {
    try {
      const res = await fetch("/__rb/reload", { credentials: "same-origin" });
      // signed out (sent to /login), or an office without the route: nothing to watch
      if (res.redirected || res.status === 401 || res.status === 404) return;
      const now = (await res.json()) as ReloadState;
      misses = 0;
      first ??= now;
      if (now.boot !== first.boot) return location.reload();
      if (now.page !== first.page) {
        if (!typing()) return location.reload();
        show("Agent Office was updated.", ["Refresh", () => location.reload()]);
      } else if (now.stale && !restarting) {
        show(now.canRestart ? "Server code changed: the office needs a restart." : "Server code changed: restart the office (bun run office:update, or run it under bun run office:mama).",
          now.canRestart ? ["Restart", restart] : undefined);
      }
    } catch {
      if (first && ++misses >= 2) show(restarting ? "Restarting the office, coming back in a moment (workers keep running)…" : "The office isn't answering; reconnecting…");
    }
    next();
  }
  void poll();
  addEventListener("visibilitychange", () => { if (!document.hidden) { clearTimeout(timer); void poll(); } });
}

if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);
