// The swarm week as one animated SVG for a README (GitHub strips scripts, not SMIL): the backlog chart with a playhead
// sweeping the week, and a dot per PR changing colour with it. The live page is swarm-watch.html.
//
//   bun scripts/swarm-readme.ts [--week src/swarm-week.json] [--out docs/swarm-week.svg] [--seconds 30]
//   bun scripts/swarm-readme.ts --png docs/swarm-week.png     the git wall as one still frame, for viewers that drop SMIL
//                                                              (needs rsvg-convert); --at <minute> picks another frame
import { band, changes, timeline, gitPeak, OPEN, type Band, type Week } from "../src/swarm-replay.ts";

const FILL: Record<Band, string> = { unborn: "#f0f0f0", working: "#9a9a9a", git: "#b3261e", test: "#e8a10c", ready: "#2f7d32", merged: "#d0d7de", closed: "#d0d7de" };

/** The animated chart; with `at` (a minute of the week), one still frame of it instead, playhead and dots frozen there. */
export function svg(week: Week, seconds = 30, at?: number) {
  const W = 900, CH = 180, per = 50, cell = (W - 40) / per, rows = Math.ceil(week.rows.length / per), H = 70 + CH + rows * cell + 20;
  const tl = timeline(week, 15), top = Math.max(...tl.map((x) => OPEN.reduce((s, b) => s + x[b], 0)), 1);
  const X = (t: number) => 20 + (t / week.minutes) * (W - 40), Y = (v: number) => 50 + CH - (v / top) * (CH - 20);
  let base = tl.map(() => 0), areas = "";
  for (const b of ["git", "test", "working", "ready"] as const) {
    const up = tl.map((x, i) => base[i]! + x[b]);
    const pts = tl.map((x, i) => `${X(x.t).toFixed(1)},${Y(up[i]!).toFixed(1)}`).concat(tl.map((x, i) => `${X(x.t).toFixed(1)},${Y(base[i]!).toFixed(1)}`).reverse());
    areas += `<polygon points="${pts.join(" ")}" fill="${FILL[b]}"/>`;
    base = up;
  }
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "numeric", day: "numeric" });
  let days = "";
  for (let t = 0; t < week.minutes; t += 1440) days += `<line x1="${X(t)}" x2="${X(t)}" y1="50" y2="${50 + CH}" stroke="#eaeef2"/><text x="${X(t) + 3}" y="${50 + CH + 14}" font-size="10" fill="#57606a">${day.format(new Date(week.start + t * 6e4))}</text>`;
  const marks = week.marks.map((m, i) => `<line x1="${X(m.at)}" x2="${X(m.at)}" y1="44" y2="${50 + CH}" stroke="#e8590c" stroke-dasharray="3 3"/><text x="${X(m.at) + (i ? 4 : -4)}" y="42" font-size="11" text-anchor="${i ? "start" : "end"}" fill="#e8590c">${m.who}</text>`).join("");
  const peak = gitPeak(week, 15);
  const still = at !== undefined;
  const anim = (vals: string[], times: number[]) => `<animate attributeName="fill" calcMode="discrete" dur="${seconds}s" repeatCount="indefinite" values="${vals.join(";")}" keyTimes="${times.map((t) => +(t / week.minutes).toFixed(4)).join(";")}"/>`;
  const dots = week.rows.map((r, i) => {
    const ch = changes(r, week.minutes), x = 20 + (i % per) * cell + cell / 2, y = 70 + CH + Math.floor(i / per) * cell + cell / 2;
    if (ch[0]![0] !== 0) ch.unshift([0, "unborn"]);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(cell * 0.4).toFixed(1)}" fill="${FILL[still ? band(r, at) : ch[0]![1]]}">${!still && ch.length > 1 ? anim(ch.map(([, b]) => FILL[b]), ch.map(([t]) => t)) : ""}</circle>`;
  }).join("");
  const legend = OPEN.map((b, i) => `<rect x="${W - 380 + i * 92}" y="12" width="9" height="9" fill="${FILL[b]}"/><text x="${W - 367 + i * 92}" y="20" font-size="11" fill="#24292f">${{ working: "working", git: "stuck on git", test: "red check", ready: "ready" }[b]}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,sans-serif">`
    + `<rect width="${W}" height="${H}" fill="#fff"/>`
    + `<text x="20" y="20" font-size="13" font-weight="600" fill="#24292f">${week.rows.length} PRs in a week, one dot each: what the open ones were waiting on</text>${legend}`
    + days + areas + marks
    + `<text x="${X(peak) - 6}" y="60" font-size="11" text-anchor="end" fill="#b3261e">the git wall</text>`
    + (still ? `<line x1="${X(at)}" x2="${X(at)}" y1="44" y2="${50 + CH}" stroke="#24292f" stroke-width="2"/>` : `<line y1="44" y2="${50 + CH}" stroke="#24292f" stroke-width="2"><animate attributeName="x1" from="20" to="${W - 20}" dur="${seconds}s" repeatCount="indefinite"/><animate attributeName="x2" from="20" to="${W - 20}" dur="${seconds}s" repeatCount="indefinite"/></line>`)
    + dots + `</svg>`;
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const week = await Bun.file(arg("--week") ?? `${import.meta.dir}/../src/swarm-week.json`).json();
  const png = arg("--png");
  if (png) {
    const frame = svg(week, 30, +(arg("--at") ?? gitPeak(week, 15)));
    const r = Bun.spawnSync(["rsvg-convert", "-w", "1800", "-o", png], { stdin: new TextEncoder().encode(frame), stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`rsvg-convert: ${r.stderr.toString()}`);
    console.log(png);
  } else {
    const out = arg("--out") ?? `${import.meta.dir}/../docs/swarm-week.svg`;
    await Bun.write(out, svg(week, +(arg("--seconds") ?? 30)));
    console.log(out);
  }
}
