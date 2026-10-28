// The arena: one Durable Object ("live") runs the hour's fight. The cron starts it, an
// alarm plays one turn every PACE_MS, every viewer's WebSocket gets each turn as it lands,
// and Clef referees the finished fight before it goes to R2 as a replay. It also counts today's
// model calls: Workers AI has no spend cap of its own, so past DAILY_CALLS fighters sit their turns out.

import { DurableObject } from "cloudflare:workers";
import { CANVAS, finished, judgeMatch, newMatch, playTurn, type Fighter, type MatchState, type TurnDeps } from "./engine/match.ts";
import { practiceAnswers } from "./engine/brain.ts";
import { regionFor } from "./engine/ops.ts";
import { practicePen } from "./engine/pen-fighter.ts";
import { PLANNER, parsePlan, planRequest, practicePlan } from "./engine/plan.ts";
import { promptFor } from "./engine/prompts.ts";
import { take } from "./budget.ts";
import { addToIndex, type MatchSummary, summarize } from "./archive.ts";
import type { LiveMatch, LiveMessage } from "./live-wire.ts";

/** Turns per fighter, and the gap between them: about three minutes of fight. A plan is 5–12 parts and a
 * finished drawing can pass, so more turns mostly bought clutter (the bake-off, src/lab/run.ts). */
export const TURNS = 24;
export const PACE_MS = 5_000;
/** A fight older than this is stale (a lost alarm), so the next start replaces it. */
const STALE_MS = 20 * 60_000;
const DEFAULT_DAILY_CALLS = 1_000;

/** The hour's fight, alternating: Clef vs Clef Flash, then pen vs pen ("Clef refs, LLMs fight"). */
export const MATCHUPS: Fighter[][] = [
  [
    { model: "clef", name: "Clef" },
    { model: "clef-flash", name: "Clef Flash" },
  ],
  [
    { model: "gpt-oss-20b", name: "GPT-OSS 20B" },
    { model: "scout", name: "Llama 4 Scout" },
  ],
];

/** The matchup for an hour, with sides swapped every other round so neither model always gets the left. */
export function fightersFor(now: number): Fighter[] {
  const hour = Math.floor(now / 3_600_000);
  const pair = MATCHUPS[hour % MATCHUPS.length]!;
  return Math.floor(hour / MATCHUPS.length) % 2 ? [...pair].reverse() : pair;
}

const live = ({ log: _l, nextId: _n, talks: _t, ...m }: MatchState): LiveMatch => m;

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
    const m = newMatch(`m-${now}`, promptFor(now), fightersFor(now), TURNS, now);
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
    // Clef referees. Saved too, so a retry neither judges nor pays twice.
    await judgeMatch(m, this.deps());
    await this.ctx.storage.put("match", m);
    const summary = summarize(m);
    if (this.env.ARCHIVE) {
      const { talks: _t, ...replay } = m;
      await this.env.ARCHIVE.put(`matches/${m.id}.json`, JSON.stringify(replay), { httpMetadata: { contentType: "application/json" } });
      const prev = await this.env.ARCHIVE.get("index.json");
      const index = addToIndex(prev ? await prev.json() : [], summary);
      await this.env.ARCHIVE.put("index.json", JSON.stringify(index), { httpMetadata: { contentType: "application/json" } });
    }
    await this.ctx.storage.delete("match");
    this.send({ t: "end", id: m.id, summary });
  }

  /** The models, metered against today's budget. */
  private deps(): TurnDeps {
    // Local dev would reach the real (billed) Workers AI, so dev fights are practice unless EXCALIBRAWL_REAL_AI=1.
    const ai = import.meta.env.VITE_IS_DEV_SERVER && !import.meta.env.VITE_REAL_AI ? undefined : this.env.AI;
    const cap = Number(this.env.DAILY_CALLS) || DEFAULT_DAILY_CALLS;
    return {
      // No AI: a practice fight on random answers (or random pen lines), free.
      run: ai
        ? (model, input) => ai.run(model as keyof AiModels, input as never)
        : async (_m, input) => ((input as { messages?: unknown }).messages ? { response: practicePen(regionFor(0, 2, CANVAS)) } : practiceAnswers(input)),
      plan: ai ? async (prompt, persona) => parsePlan(await ai.run(PLANNER as keyof AiModels, planRequest(prompt, persona) as never)) : async () => practicePlan(),
      take: async () => {
        if (!ai) return true;
        const today = new Date().toISOString().slice(0, 10);
        const next = take((await this.ctx.storage.get<{ day: string; n: number }>("budget")) ?? { day: today, n: 0 }, today, cap);
        if (next.ok) await this.ctx.storage.put("budget", { day: next.day, n: next.n });
        return next.ok;
      },
    };
  }

  /** Play one turn, tell the viewers, and set the alarm for the next. */
  private async turn(m: MatchState) {
    const entries = await playTurn(m, this.deps());
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
