// Mass headless simulator: `bun scripts/sim.ts --n 1000 --jobs 2 --hero none|marines|wooka|both --handicap 0,0.3,0.6`
// Plays thousands of Two Fronts ground battles on local cores (no cloud, nothing billed), then writes
// dist/balance/report.json and a self-contained report.html: win rates by sector and handicap, a
// heatmap of where each side stood with a time slider, and a replay of sampled battles to scrub.
import { mkdirSync, writeFileSync } from "node:fs";
import os, { cpus } from "node:os";
import { SECTORS } from "./balance.ts";
import { BINS, BIN_S, GRID, type Job, type Result } from "./sim-worker.ts";
import type { Faction, Side } from "../src/battle/contract.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const N = Number(arg("n", "120")), CAP = Math.max(1, Math.floor(cpus().length * 0.2)), JOBS = Math.min(CAP, Math.max(1, Number(arg("jobs", String(CAP))))), HERO = arg("hero", "none");
const HANDICAPS = arg("handicap", "0").split(",").map(Number), OUT = arg("out", "dist/balance"), REPLAYS = Number(arg("replays", "2"));

const jobs: Job[] = [];
for (let i = 0; i < N; i++) {
  const sector = SECTORS[i % SECTORS.length]!, attacker: Faction = (i >> 3) % 2 ? "wooka" : "marines";
  const heroFaction = HERO === "both" ? (i >> 4) % 2 ? "wooka" : "marines" : HERO;
  const hero: Side | null = heroFaction === "none" ? null : heroFaction === attacker ? "attacker" : "defender";
  const seen = jobs.filter((j) => j.sector === sector).length;
  jobs.push({ i, sector, seed: 1 + i, attacker, hero, handicap: HANDICAPS[i % HANDICAPS.length]!, record: seen < REPLAYS });
}

// Never more than a fifth of the machine's cores (--jobs can only go lower), at the lowest priority, so the desk stays responsive.
try { os.setPriority(19); } catch { /* best effort */ }
console.log(`${JOBS} of ${cpus().length} cores`);
const started = performance.now();
const results: Result[] = [];
await new Promise<void>((done) => {
  let live = JOBS;
  for (let w = 0; w < JOBS; w++) {
    const worker = new Worker(new URL("./sim-worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<Result | "done">) => {
      if (e.data === "done") { worker.terminate(); if (--live === 0) done(); return; }
      results.push(e.data);
      if (results.length % 100 === 0) console.log(`${results.length}/${N}`);
    };
    worker.postMessage(jobs.filter((_, i) => i % JOBS === w));
  }
});
const secs = (performance.now() - started) / 1000;

// Marines' wins, by sector and by handicap on the hero's foe.
const marinesWon = (r: Result) => (r.winner === "attacker") === (r.job.attacker === "marines");
const heroWon = (r: Result) => r.job.hero !== null && r.winner === r.job.hero;
const rate = (rs: Result[], f: (r: Result) => boolean) => (rs.length ? Math.round((1000 * rs.filter(f).length) / rs.length) / 10 : null);
const summary = {
  battles: results.length, seconds: Math.round(secs), perBattle: Math.round((secs / results.length) * JOBS * 100) / 100, hero: HERO,
  marinesWinPct: rate(results, marinesWon),
  bySector: Object.fromEntries(SECTORS.map((s) => { const rs = results.filter((r) => r.job.sector === s); return [s, { n: rs.length, marinesWinPct: rate(rs, marinesWon), marinesAttackPct: rate(rs.filter((r) => r.job.attacker === "marines"), marinesWon), wookaAttackPct: rate(rs.filter((r) => r.job.attacker === "wooka"), marinesWon), avgPostsTakenByAttacker: Math.round((rs.reduce((t, r) => t + r.posts, 0) / Math.max(1, rs.length)) * 10) / 10 }]; })),
  byHandicap: Object.fromEntries(HANDICAPS.map((h) => { const rs = results.filter((r) => r.job.handicap === h && r.job.hero); return [String(h), { n: rs.length, heroWinPct: rate(rs, heroWon) }]; })),
};
// Where each side stood, per sector, summed over every battle: heat[sector][side*BINS+bin][cell].
const heat: Record<string, number[][]> = {};
for (const r of results) {
  const h = (heat[r.job.sector] ??= Array.from({ length: 2 * BINS }, () => new Array<number>(GRID * GRID).fill(0)));
  r.heat.forEach((layer, l) => layer.forEach((c, i) => { h[l]![i]! += c; }));
}
const replays = results.filter((r) => r.frames).map((r) => ({ title: `${r.job.sector} seed ${r.job.seed}: ${r.job.attacker} attack${r.job.hero ? `, hero ${r.job.hero}` : ""}, ${r.winner} won at ${r.time}s`, sector: r.job.sector, half: r.half, posts: r.postsAt, frames: r.frames }));
const report = { summary, heat, grid: GRID, bins: BINS, binSeconds: BIN_S, replays };

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/report.json`, JSON.stringify(report));
writeFileSync(`${OUT}/report.html`, html(report));
console.log(JSON.stringify(summary, null, 1));
console.log(`${results.length} battles in ${Math.round(secs)}s on ${JOBS} threads -> ${OUT}/report.html`);

function html(data: unknown) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Two Fronts balance report</title>
<style>
:root{--bg:#fff;--fg:#1c1c1c;--mut:#6b6b6b;--line:#ddd;--a:#2f6fdb;--d:#d9822b}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#e8e8e8;--mut:#9a9a9a;--line:#333;--a:#6aa3ff;--d:#f0a050}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;max-width:900px;margin-inline:auto}
h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}
canvas{width:100%;max-width:520px;aspect-ratio:1;background:var(--line);border-radius:6px;display:block}input[type=range]{width:100%;max-width:520px}.mut{color:var(--mut)}label{margin-right:12px}
.a{color:var(--a)}.d{color:var(--d)}
</style><h1>Two Fronts balance report</h1><div id="sum" class="mut"></div>
<h2>Win rates by sector</h2><table id="sect"></table><div id="hand"></div>
<h2>Where they stood</h2><div class="mut">Summed over every battle on the sector. <span class="a">Attacker</span> and <span class="d">defender</span> density; the slider moves through the battle in ${BIN_S}-second steps.</div>
<p><select id="hs"></select></p><canvas id="hc" width="480" height="480"></canvas><input id="hr" type="range" min="0" max="${BINS - 1}" value="0"><div id="ht" class="mut"></div>
<h2>Replay</h2><p><select id="rs"></select></p><canvas id="rc" width="480" height="480"></canvas><input id="rr" type="range" min="0" max="0" value="0"><div id="rt" class="mut"></div>
<script>
const D=${JSON.stringify(data).replace(/</g, "\\u003c")};const $=i=>document.getElementById(i);
const col=n=>getComputedStyle(document.documentElement).getPropertyValue(n);
const s=D.summary;$("sum").textContent=s.battles+" battles in "+s.seconds+"s; hero: "+s.hero+"; Marines won "+s.marinesWinPct+"%";
$("sect").innerHTML="<tr><th>Sector</th><th>Battles</th><th>Marines win %</th><th>Marines attacking</th><th>Wooka attacking</th><th>Posts the attacker took</th></tr>"+Object.entries(s.bySector).map(([k,v])=>"<tr><td>"+k+"</td><td>"+v.n+"</td><td>"+v.marinesWinPct+"</td><td>"+v.marinesAttackPct+"</td><td>"+v.wookaAttackPct+"</td><td>"+v.avgPostsTakenByAttacker+"</td></tr>").join("");
const hs=Object.entries(s.byHandicap).filter(([,v])=>v.n);
if(hs.length)$("hand").innerHTML="<h2>The human hero against a bigger foe</h2><table><tr><th>Foe has this much more</th><th>Battles</th><th>Hero wins %</th></tr>"+hs.map(([k,v])=>"<tr><td>+"+Math.round(k*100)+"%</td><td>"+v.n+"</td><td>"+v.heroWinPct+"</td></tr>").join("")+"</table>";
const G=D.grid,B=D.bins;
for(const k of Object.keys(D.heat))$("hs").add(new Option(k,k));
function heat(){const k=$("hs").value,b=+$("hr").value,h=D.heat[k],c=$("hc").getContext("2d"),W=c.canvas.width,w=W/G;c.clearRect(0,0,W,W);
 const mx=Math.max(1,...h.slice(b,b+1).flat(),...h.slice(B+b,B+b+1).flat());
 for(const [side,l,rgb] of [[0,b,"47,111,219"],[1,B+b,"217,130,43"]])h[l].forEach((v,i)=>{if(!v)return;c.fillStyle="rgba("+rgb+","+Math.min(.85,v/mx*.85+.1)+")";c.fillRect((i%G)*w,(G-1-Math.floor(i/G))*w,w,w)});
 $("ht").textContent="t = "+b*D.binSeconds+"-"+(b+1)*D.binSeconds+"s (attackers start at the bottom)"}
$("hs").onchange=$("hr").oninput=heat;heat();
D.replays.forEach((r,i)=>$("rs").add(new Option(r.title,i)));
function rep(){const r=D.replays[+$("rs").value];if(!r){$("rt").textContent="no replays recorded";return}
 $("rr").max=r.frames.length-1;const f=r.frames[Math.min(+$("rr").value,r.frames.length-1)],c=$("rc").getContext("2d"),W=c.canvas.width,X=v=>(v+r.half)/(2*r.half)*W,Z=v=>W-(v+r.half)/(2*r.half)*W;
 c.clearRect(0,0,W,W);c.fillStyle=col("--bg");c.fillRect(0,0,W,W);
 r.posts.forEach((p,i)=>{const o=f.posts[i];c.strokeStyle=o==="attacker"?col("--a"):o==="defender"?col("--d"):col("--mut");c.lineWidth=3;c.beginPath();c.arc(X(p.x),Z(p.z),12/360*W,0,7);c.stroke()});
 for(const [x,z,s,k] of f.u){c.fillStyle=s?col("--d"):col("--a");const q=k?5:2.5;c.fillRect(X(x)-q/2,Z(z)-q/2,k===2?7:q,k===2?7:q)}
 $("rt").textContent="t = "+f.t+"s; tickets: attacker "+f.tk[0]+", defender "+f.tk[1]}
$("rs").onchange=()=>{$("rr").value=0;rep()};$("rr").oninput=rep;rep();
</script>`;
}
