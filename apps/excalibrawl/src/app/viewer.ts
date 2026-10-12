// The page's one script: the live fight over /api/live, and the replays from /api/matches.
// Between fights the arena replays the last one and counts down to the hour.

import type { LiveMatch, LiveMessage } from "../arena.ts";
import type { MatchSummary } from "../archive.ts";
import type { LogEntry, MatchState } from "../engine/match.ts";
import { scenesAt } from "../engine/match.ts";
import { sceneSvg } from "../engine/svg.ts";

const REPLAY_TURN_MS = 180;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function said(e: LogEntry | undefined): string {
  if (!e) return "…";
  if (e.error) return `sat out (${e.error})`;
  const d = e.decision;
  if (!d) return "…";
  if (d.action === "restart") return "scrapped it all";
  if (d.action === "pass") return "admiring it";
  if (d.action === "next") return `${d.part ?? "next part"} (${d.color} ${d.shape})`;
  return d.action === "add" ? `${d.size >= 3 ? "big " : d.size < 1 ? "tiny " : ""}${d.color} ${d.shape}` : `${d.action} ${d.target ?? ""}`.trim();
}

/** Paint the fight into `arena` and the replay list into `replays`. Returns the cleanup. */
export function watch(arena: HTMLElement | null, replays: HTMLElement | null): () => void {
  if (!arena || !replays) return () => {};
  let closed = false;
  let match: (LiveMatch & { log: LogEntry[] }) | null = null;
  let replay: { m: MatchState; turn: number; timer: ReturnType<typeof setInterval> } | null = null;
  let index: MatchSummary[] = [];

  const draw = (m: Pick<MatchState, "fighters" | "prompt" | "turns">, log: LogEntry[], turn: number, label: string) => {
    const last = (side: number) => [...log].reverse().find((e) => e.side === side && e.turn <= turn);
    arena.innerHTML =
      `<div class="bar"><span class="tag">${esc(label)}</span><strong>${esc(m.prompt)}</strong><span class="clock" title="Turn of the fight">${String(turn).padStart(2, "0")}/${m.turns}</span></div>` +
      `<div class="canvas">${sceneSvg(scenesAt({ fighters: m.fighters, log }, turn))}</div>` +
      `<div class="fighters">${m.fighters.map((f, side) => `<div><b>${esc(f.name)}</b><span>${esc(said(last(side)))}</span></div>`).join("")}</div>`;
  };

  const idle = () => {
    if (match) return;
    const next = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    const bar = arena.querySelector(".bar .clock");
    if (bar) {
      bar.textContent = clock(next - Date.now());
      bar.setAttribute("title", "Until the next fight, on the hour (the cron can run a few minutes late)");
    }
  };

  const playReplay = async (id: string, label = "replay") => {
    if (replay) clearInterval(replay.timer);
    const m = (await (await fetch(`/api/matches/${id}`)).json()) as MatchState;
    const r = { m, turn: 0, timer: setInterval(() => {
      if (match) return clearInterval(r.timer);
      r.turn = Math.min(m.turns, r.turn + 1);
      draw(m, m.log, r.turn, label);
      idle();
    }, REPLAY_TURN_MS) };
    replay = r;
  };

  const loadReplays = async () => {
    index = (await (await fetch("/api/matches")).json()) as MatchSummary[];
    replays.innerHTML = index
      .filter((s) => s.shapes.some((n) => n > 0))
      .slice(0, 48)
      .map((s) => `<li><button data-id="${esc(s.id)}"><strong>${esc(s.prompt)}</strong><span>${new Date(s.startedAt).toLocaleString()} · ${s.fighters.map((f) => esc(f.name)).join(" vs ")}</span></button></li>`)
      .join("");
    if (!match && !replay && index[0]) void playReplay(index[0].id, "last fight");
  };

  replays.addEventListener("click", (ev) => {
    const id = (ev.target as HTMLElement).closest("button")?.dataset.id;
    if (id) void playReplay(id).then(() => arena.scrollIntoView({ behavior: "smooth" }));
  });

  let ws: WebSocket | undefined;
  const connect = (wait = 1000) => {
    if (closed) return;
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as LiveMessage;
      if (msg.t === "hello" || msg.t === "start") {
        // The hello's match has scenes but no log; seed the log with one add per shape so far.
        match = msg.match && {
          ...msg.match,
          log: msg.match.scenes.flatMap((s, side) => s.map((element) => ({ side, turn: 0, ops: [{ op: "add" as const, element }] }))),
        };
      } else if (msg.t === "turn" && match?.id === msg.id) {
        match.log.push(...msg.entries);
        match.turn = msg.turn;
      } else if (msg.t === "end") {
        match = null;
        void loadReplays().then(() => playReplay(msg.id, "last fight"));
        return;
      }
      if (match) draw(match, match.log, match.turn, "live");
    };
    ws.onopen = () => (wait = 1000);
    ws.onclose = () => setTimeout(() => connect(Math.min(wait * 2, 30_000)), wait);
  };

  const tick = setInterval(idle, 1000);
  arena.innerHTML = `<div class="bar"><span class="tag">waiting</span><strong>Next fight on the hour</strong><span class="clock">--:--</span></div>`;
  connect();
  void loadReplays();
  return () => {
    closed = true;
    clearInterval(tick);
    if (replay) clearInterval(replay.timer);
    ws?.close();
  };
}
