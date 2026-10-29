// Manual-run harness for the shipper link: post one sample parcel through ratesApi (src/rates.ts) to the linked
// aggregator and print the rates. RATES_URL and RATES_KEY come from varlock (.env.schema), never typed here.
//   bunx varlock run -- bun scripts/rates.ts
//   bunx varlock run -- bun scripts/rates.ts --box 8x6x4 --from 10001 --to 94103 --weight 2
// Exits 1 with the reason when the link is missing, the aggregator fails, or it answers no usable rates.
import { ratesApi, type Rate, type RatesEnv } from "../src/rates.ts";

export interface Ask { box: { l: number; w: number; h: number }; from: string; to: string; weight?: number }
export const SAMPLE: Ask = { box: { l: 8, w: 6, h: 4 }, from: "10001", to: "94103", weight: 2 };

/** Parses `--box LxWxH --from ZIP --to ZIP --weight N` over the sample parcel. */
export function parseAsk(argv: string[]): Ask {
  const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const ask: Ask = { ...SAMPLE, box: { ...SAMPLE.box } };
  const box = get("box");
  if (box) {
    const [l = NaN, w = NaN, h = NaN] = box.split("x").map(Number);
    ask.box = { l, w, h };
  }
  ask.from = get("from") ?? ask.from;
  ask.to = get("to") ?? ask.to;
  const weight = get("weight");
  if (weight !== undefined) ask.weight = Number(weight);
  return ask;
}

/** One request through the same code the Worker runs; returns the lines to print and whether it worked. */
export async function run(env: RatesEnv, ask: Ask = SAMPLE, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; lines: string[] }> {
  if (!env.RATES_URL) return { ok: false, lines: ["RATES_URL is not set: run through varlock (op://qcrm/geoboxq/rates-url, see .env.schema)"] };
  const { status, body } = await ratesApi(JSON.stringify(ask), env, fetcher);
  if (status !== 200) return { ok: false, lines: [`${status}: ${(body as { error?: string }).error ?? "failed"}`] };
  const rates = (body as { rates: Rate[] }).rates;
  if (!rates.length) return { ok: false, lines: ["the aggregator answered, but no usable rates came back"] };
  return { ok: true, lines: rates.map((r) => `${r.carrier} ${r.service}: ${r.amount.toFixed(2)} ${r.currency}${r.days ? `, ${r.days} days` : ""}`) };
}

if (import.meta.main) {
  const { ok, lines } = await run({ RATES_URL: Bun.env.RATES_URL, RATES_KEY: Bun.env.RATES_KEY }, parseAsk(process.argv.slice(2)));
  for (const l of lines) (ok ? console.log : console.error)(l);
  process.exit(ok ? 0 : 1);
}
