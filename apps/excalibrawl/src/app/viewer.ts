// The page's one script: the live fight over /api/live, and the replays from /api/matches.
// Between fights the arena loops the newest fight that drew something (or the sample, when none is archived)
// and counts down to the hour, so a first visitor sees a fight with no clicks.

import { getJson } from "@rustybuns/util/http";
import { esc } from "@rustybuns/util";
import { check } from "@rustybuns/util/guard";
import { LiveMessage, Replay, Summaries, type LiveMatch, type ReplayEntry } from "../live-wire.ts";
import { scenesAt } from "../engine/match.ts";
import { sceneSvg } from "../engine/svg.ts";
import { SAMPLE_ID, pickFight, sampleFight } from "./sample.ts";
import COPY from "../../content/first-screen.json";

// A replay takes about REPLAY_MS whatever its length (never under MIN_TURN_MS a turn), then holds the
// finished picture for HOLD_MS and starts again.
const REPLAY_MS = 8_000, MIN_TURN_MS = 180, HOLD_MS = 4_000;

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function said(e: ReplayEntry | undefined): string {
  if (!e) return "…";
  if (e.error) return `sat out (${e.error})`;
  if (e.pen) return e.pen.done && !e.pen.lines ? "done" : `${e.pen.lines} line${e.pen.lines === 1 ? "" : "s"}${e.pen.skipped ? `, ${e.pen.skipped} skipped` : ""}${e.pen.look ? ", looking" : ""}${e.pen.done ? ", done" : ""}`;
  const d = e.decision;
  if (!d) return "…";
  if (d.action === "restart") return "scrapped it all";
  if (d.action === "pass") return "admiring it";
  if (d.action === "next") return `${d.part ?? "next part"} (${d.color} ${d.shape})`;
  return d.action === "add" ? `${d.size >= 3 ? "big " : d.size < 1 ? "tiny " : ""}${d.color} ${d.shape}` : `${d.action} ${d.target ?? ""}`.trim();
}

/** Paint the fight into `arena` and the replay list into `replays`; `onShow` hears which fight is up (null for the sample). Returns the cleanup. */
export function watch(arena: HTMLElement | null, replays: HTMLElement | null, next?: HTMLElement | null, onShow?: (id: string | null) => void): () => void {
  if (!arena || !replays) return () => {};
  let shown: string | null | undefined;
  const show = (id: string | null) => { if (id !== shown) { shown = id; onShow?.(id); } };
  let closed = false;
  let match: (LiveMatch & { log: ReplayEntry[] }) | null = null;
  let replay: { m: Replay; label: string; turn: number; timer: ReturnType<typeof setInterval> } | null = null;
  let index: Summaries = [];

  const draw = (m: Pick<Replay, "fighters" | "prompt" | "turns" | "scores" | "winner">, log: ReplayEntry[], turn: number, label: string) => {
    const last = (side: number) => [...log].reverse().find((e) => e.side === side && e.turn <= turn);
    // Clef's verdict shows once the replay reaches the end: a trophy on the winner, each side's scores as a tooltip.
    const name = (f: { name: string }, side: number) => {
      const s = turn >= m.turns ? m.scores?.[side] : undefined;
      if (!s) return `<b>${esc(f.name)}</b>`;
      const tip = `Clef refs: likeness ${s.likeness.toFixed(1)}, craft ${s.craft.toFixed(1)} (of 4)`;
      return `<b title="${esc(tip)}">${esc(f.name)}${m.winner === side ? " 🏆" : ""}</b>`;
    };
    arena.innerHTML =
      `<div class="bar"><span class="tag">${esc(label)}</span><strong>${esc(m.prompt)}</strong><span class="clock" title="Turn of the fight">${String(turn).padStart(2, "0")}/${m.turns}</span></div>` +
      `<div class="canvas">${sceneSvg(scenesAt({ fighters: m.fighters, log }, turn))}</div>` +
      `<div class="fighters">${m.fighters.map((f, side) => `<div>${name(f, side)}<span>${esc(said(last(side)))}</span></div>`).join("")}</div>`;
  };

  const idle = () => {
    if (!next) return;
    if (match) { next.textContent = COPY.liveNow; return; }
    const at = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    next.textContent = `${COPY.nextFight.replace("{clock}", clock(at - Date.now()))}${replay?.m.id === SAMPLE_ID ? COPY.untilThen : ""}`;
  };

  const play = (m: Replay, label: string) => {
    if (replay) clearInterval(replay.timer);
    const every = Math.max(MIN_TURN_MS, REPLAY_MS / Math.max(1, m.turns));
    const hold = Math.ceil(HOLD_MS / every);
    const r = { m, label, turn: 0, timer: setInterval(() => {
      if (match) return clearInterval(r.timer);
      r.turn = r.turn >= m.turns + hold ? 1 : r.turn + 1;
      draw(m, m.log, Math.min(m.turns, r.turn), label);
      idle();
    }, every) };
    replay = r;
    show(m.id === SAMPLE_ID ? null : m.id);
    return r;
  };
  const playReplay = async (id: string, label = "replay") => {
    const m = await getJson(`/api/matches/${encodeURIComponent(id)}`, Replay);
    if (m) play(m, label);
  };
  const playSample = () => play(sampleFight(), "sample fight");

  const loadReplays = async () => {
    index = (await getJson("/api/matches", Summaries).catch(() => null)) ?? [];
    replays.innerHTML = index
      .filter((s) => s.shapes.some((n) => n > 0))
      .slice(0, 48)
      .map((s) => `<li><button data-id="${esc(s.id)}"><strong>${esc(s.prompt)}</strong><span>${new Date(s.startedAt).toLocaleString()} · ${s.fighters.map((f) => esc(f.name)).join(" vs ")}</span></button></li>`)
      .join("") || `<li class="none">${esc(COPY.noneYet)}</li>`;
    const best = pickFight(index);
    if (!match && (!replay || replay.m.id === SAMPLE_ID) && best) await playReplay(best.id, "last fight").catch(() => {});
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
      let raw: unknown;
      try { raw = JSON.parse(String(ev.data)); } catch { return; }
      const msg = check(LiveMessage, raw);
      if (!msg) return;
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
      if (match) { show(match.id); draw(match, match.log, match.turn, "live"); }
    };
    ws.onopen = () => (wait = 1000);
    ws.onclose = () => setTimeout(() => connect(Math.min(wait * 2, 30_000)), wait);
  };

  const tick = setInterval(idle, 1000);
  // The sample draws at once; the newest archived fight replaces it as soon as the list arrives.
  const sample = playSample();
  draw(sample.m, sample.m.log, 0, sample.label);
  idle();
  connect();
  void loadReplays();
  Object.assign(window, { excalibrawl: {
    state: () => ({
      showing: match ? "live" : replay?.label ?? null,
      id: match?.id ?? replay?.m.id ?? null,
      prompt: match?.prompt ?? replay?.m.prompt ?? null,
      turn: match?.turn ?? Math.min(replay?.turn ?? 0, replay?.m.turns ?? 0),
      turns: match?.turns ?? replay?.m.turns ?? 0,
      shapes: arena.querySelectorAll(".canvas svg > *").length,
      next: next?.textContent ?? null,
      replays: index.length,
    }),
  } });
  return () => {
    closed = true;
    clearInterval(tick);
    if (replay) clearInterval(replay.timer);
    ws?.close();
  };
}
