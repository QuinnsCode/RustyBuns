// Cold starts on a live Worker: time to first byte, asked again and again with a gap, so some requests land on a
// fresh isolate. A warm Worker (Lighthouse, a quick curl) hides a slow startup; this is what a visitor after a quiet
// spell gets. Each URL is asked once per round with a fresh query string (no cache), all URLs at the same time.
//
//   bun scripts/ttfb.ts <url> [url ...] [--rounds 20] [--gap 30]
//
// Per request: server time (first byte minus the TLS handshake, so most of the network is taken out) and the colo
// from cf-ray. At the end, one line per URL: median, p90, max, and how many requests took over 500 ms.
// Paid and free Workers both have 1 s of CPU for startup (parse + execute the bundle); `wrangler check startup`
// measures that on a built bundle, this measures what people see.
import { help } from "./help.ts";

help(import.meta.path);

const argv = process.argv.slice(2);
const flag = (name: string, def: number): number => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : Number(argv.splice(i, 2)[1]);
};
const rounds = flag("rounds", 20);
const gap = flag("gap", 30);
const urls = argv.filter((a) => !a.startsWith("--"));
if (!urls.length) {
  console.error("usage: bun scripts/ttfb.ts <url> [url ...] [--rounds 20] [--gap 30]");
  process.exit(2);
}

/** One request: server time in ms (first byte after the TLS handshake), HTTP status and the colo. */
async function once(url: string): Promise<{ ms: number; status: number; colo: string }> {
  const u = new URL(url);
  u.searchParams.set("cb", `${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
  const p = Bun.spawn(["curl", "-s", "-o", "/dev/null", "-D", "-", "-w", "\n%{time_appconnect} %{time_starttransfer} %{http_code}", u.href]);
  const out = await new Response(p.stdout).text();
  await p.exited;
  const [tls, first, code] = out.trim().split("\n").at(-1)!.split(" ");
  const colo = /^cf-ray: *\S+-(\w+)/im.exec(out)?.[1] ?? "?";
  return { ms: Math.round((Number(first) - Number(tls)) * 1000), status: Number(code), colo };
}

const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

const times = new Map<string, number[]>(urls.map((u) => [u, []]));
const width = Math.max(...urls.map((u) => new URL(u).host.length));
for (let r = 1; r <= rounds; r++) {
  const got = await Promise.all(urls.map(once));
  got.forEach((g, i) => {
    times.get(urls[i])!.push(g.ms);
    console.log(`round ${String(r).padStart(2)}  ${new URL(urls[i]).host.padEnd(width)}  ${String(g.ms).padStart(5)} ms  ${g.status}  ${g.colo}`);
  });
  if (r < rounds) await Bun.sleep(gap * 1000);
}
console.log("");
for (const [u, xs] of times) {
  const slow = xs.filter((x) => x > 500).length;
  console.log(`${new URL(u).host.padEnd(width)}  median ${pct(xs, 0.5)} ms  p90 ${pct(xs, 0.9)} ms  max ${Math.max(...xs)} ms  over 500 ms: ${slow}/${xs.length}`);
}
