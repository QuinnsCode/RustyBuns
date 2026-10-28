// The dry run for the migration's manual run (#967): where each step stands, without a deploy or a billed call.
// Pure: the CLI (scripts/dry-run.ts) hands it the config's cron, the cap and a fetch.
import { arr, num, obj, opt, str } from "@rustybuns/util/guard";

export interface Step { step: string; state: "done" | "todo" | "unknown"; note: string }

const Index = arr(obj({ id: str(), startedAt: num(0, Infinity), shapes: arr(num(0, Infinity)), turns: opt(num(0, Infinity)) }));

/** The next time an "M * * * *" cron fires after `now` (hourly crons are all this app has). */
export function nextFire(cron: string, now: number): Date {
  const minute = Number(cron.split(" ")[0]), d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(minute);
  if (d.getTime() <= now) d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

export async function dryRun(o: { site: string; cron: string; dailyCalls: number; now: number; fetch: typeof fetch }): Promise<Step[]> {
  const out: Step[] = [];
  let index: ReturnType<typeof Index> | null = null, reach = "";
  try {
    const r = await o.fetch(`${o.site}/api/matches`);
    if (!r.ok) reach = `${o.site}/api/matches answered ${r.status}`;
    else {
      const body: unknown = await r.json().catch(() => null);
      try { index = Index(body); } catch { reach = `${o.site}/api/matches is not the new Worker's index (the old site, or not deployed)`; }
    }
  } catch (e) { reach = `${o.site} is unreachable: ${e instanceof Error ? e.message : String(e)}`; }

  out.push({ step: "Stop the old site's cron", state: "unknown", note: "lives in ~/Documents/projects/excalibrawl/wrangler.jsonc (`59 * * * *`); nothing here can see it" });
  out.push({ step: "Deploy apps/excalibrawl", state: index ? "done" : "todo", note: index ? "the new Worker answers /api/matches" : reach });
  out.push({ step: "Point the domain at it", state: index ? "done" : "todo", note: index ? `${o.site} serves the new Worker` : reach });
  const next = nextFire(o.cron, o.now).toISOString();
  out.push({ step: "Cron", state: "todo", note: `\`${o.cron}\` in rustybuns.config.ts; next fight ${next}${index ? "" : " once deployed"}` });
  const drawn = index?.find((m) => m.shapes.every((n) => n > 0));
  out.push({
    step: "First billed fight",
    state: drawn ? "done" : "todo",
    note: drawn
      ? `${drawn.id} drew shapes on both sides`
      : `${index ? `${index.length} fights listed, none with shapes on both sides` : "nothing deployed to bill yet"}; expect about $0.017 for a Clef fight, capped at ${o.dailyCalls} calls a day (about $0.60)`,
  });
  return out;
}

export const render = (steps: Step[]) => steps.map((s) => `${{ done: "[x]", todo: "[ ]", unknown: "[?]" }[s.state]} ${s.step}: ${s.note}`).join("\n");
