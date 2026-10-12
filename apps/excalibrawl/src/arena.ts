// The arena: one Durable Object ("live") runs the hour's fight. The cron starts it, an
// alarm plays one turn every PACE_MS, every viewer's WebSocket gets each turn as it lands,
// and the finished fight goes to R2 as a replay. It also counts today's Clef calls: Workers
// AI has no spend cap of its own, so past DAILY_CALLS fighters sit their turns out.

import { DurableObject } from "cloudflare:workers";
import { finished, newMatch, playTurn, type Fighter, type LogEntry, type MatchState } from "./engine/match.ts";
import { practiceAnswers } from "./engine/brain.ts";
import { promptFor } from "./engine/prompts.ts";
import { take } from "./budget.ts";
import { addToIndex, type MatchSummary, summarize } from "./archive.ts";

/** Turns per fighter, and the gap between them: about four minutes of fight. */
export const TURNS = 36;
export const PACE_MS = 5_000;
/** A fight older than this is stale (a lost alarm), so the next start replaces it. */
const STALE_MS = 20 * 60_000;
const DEFAULT_DAILY_CALLS = 2_000;

const FIGHTERS: Fighter[] = [
  { model: "clef", name: "Clef" },
  { model: "clef-flash", name: "Clef Flash" },
];

/** What a viewer or the office needs to draw the fight so far. */
export type LiveMatch = Omit<MatchState, "log" | "nextId">;

/** Everything the live socket sends. */
export type LiveMessage =
  | { t: "hello"; match: LiveMatch | null }
  | { t: "start"; match: LiveMatch }
  | { t: "turn"; id: string; turn: number; entries: LogEntry[] }
  | { t: "end"; id: string; summary: MatchSummary };

const live = ({ log: _l, nextId: _n, ...m }: MatchState): LiveMatch => m;

export class Arena extends DurableObject<Cloudflare.Env> {
  private load = () => this.ctx.storage.get<MatchState>("match");

  private send(msg: LiveMessage) {
    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        /* gone */
      }
    }
  }

  /** Start the hour's fight, unless one is already running. */
  async start(now = Date.now()): Promise<{ ok: boolean; id?: string; reason?: string }> {
    const cur = await this.load();
    if (cur && now - cur.startedAt < STALE_MS) return { ok: false, reason: "a fight is on", id: cur.id };
    // Swap sides every hour so neither model always gets the left.
    const hour = Math.floor(now / 3_600_000);
    const fighters = hour % 2 ? [...FIGHTERS].reverse() : FIGHTERS;
    const m = newMatch(`m-${now}`, promptFor(now), fighters, TURNS, now);
    await this.ctx.storage.put("match", m);
    await this.ctx.storage.setAlarm(now + 1_000);
    this.send({ t: "start", match: live(m) });
    return { ok: true, id: m.id };
  }

  async alarm() {
    const m = await this.load();
    if (!m) return;
    if (!finished(m)) await this.turn(m);
    // Saved before archiving: if R2 fails, the alarm's retry archives without replaying a turn.
    if (!finished(m)) return;
    m.endedAt ??= Date.now();
    await this.ctx.storage.put("match", m);
    const summary = summarize(m);
    if (this.env.ARCHIVE) {
      await this.env.ARCHIVE.put(`matches/${m.id}.json`, JSON.stringify(m), { httpMetadata: { contentType: "application/json" } });
      const prev = await this.env.ARCHIVE.get("index.json");
      const index = addToIndex(prev ? await prev.json() : [], summary);
      await this.env.ARCHIVE.put("index.json", JSON.stringify(index), { httpMetadata: { contentType: "application/json" } });
    }
    await this.ctx.storage.delete("match");
    this.send({ t: "end", id: m.id, summary });
  }

  /** Play one turn, tell the viewers, and set the alarm for the next. */
  private async turn(m: MatchState) {
    // Local dev proxies AI to the real (billed) Workers AI, so dev fights are always practice.
    const ai = import.meta.env.VITE_IS_DEV_SERVER ? undefined : this.env.AI;
    const cap = Number(this.env.DAILY_CALLS) || DEFAULT_DAILY_CALLS;
    const entries = await playTurn(m, {
      // No AI: a practice fight on random answers, free.
      run: ai ? (model, input) => ai.run(model as keyof AiModels, input as never) : async (_m, input) => practiceAnswers(input),
      take: async () => {
        if (!ai) return true;
        const today = new Date().toISOString().slice(0, 10);
        const next = take((await this.ctx.storage.get<{ day: string; n: number }>("budget")) ?? { day: today, n: 0 }, today, cap);
        if (next.ok) await this.ctx.storage.put("budget", { day: next.day, n: next.n });
        return next.ok;
      },
    });
    this.send({ t: "turn", id: m.id, turn: m.turn, entries });
    await this.ctx.storage.put("match", m);
    if (!finished(m)) await this.ctx.storage.setAlarm(Date.now() + PACE_MS);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server!);
    const m = await this.load();
    server!.send(JSON.stringify({ t: "hello", match: m ? live(m) : null } satisfies LiveMessage));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage() {}
  webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* closed */
    }
  }
}
