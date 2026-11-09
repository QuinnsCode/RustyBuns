// The super admin's Scale tab: what Qollab's rooms cost a month on each home as players grow, where each one gets
// cheaper than Durable Objects, the path from here to servers behind Cloudflare, and what hurts along the way.
import { btn } from "./Glass.tsx";
import { DEFAULT, PATHS, PRESETS, crossover, needs, sweep, type Load, type PathId } from "../scale.ts";

const COLOR: Record<PathId, string> = { do: "#e8743b", rivet: "#6c7bd9", hetzner: "#2fa58a", ha: "#c2559a" };
const usd = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 10_000 ? `$${Math.round(v / 1000).toLocaleString("en-US")}k` : `$${Math.round(v).toLocaleString("en-US")}`);
const people = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}k` : v.toLocaleString("en-US"));
const href = (l: Load) => `/?tab=scale&${new URLSearchParams(Object.entries(l).map(([k, v]) => [k, String(v)]))}`;

export const SCALE_CSS = `
.scale .rowhead{flex-wrap:wrap;row-gap:.5rem}.scale .range{flex-wrap:wrap}.scale .range a{white-space:nowrap}
.scale .lead{border-color:color-mix(in oklab,var(--acc) 60%,transparent)}
.scale .tile i{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;margin-right:.35rem}
.scale .tile ul{list-style:none;margin:.4rem 0 0;padding:0;font-size:.75rem;color:var(--mut)}
.scale .tile li{display:flex;justify-content:space-between;gap:.5rem}
.scale form.knobs{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.6rem;align-items:end}
.scale form.knobs label{display:grid;gap:.2rem;font-size:.78rem;color:var(--mut)}
.scale form.knobs input,.scale form.knobs select{width:100%}
.scale svg{width:100%;height:auto;display:block}
.scale svg text{fill:var(--mut);font-size:11px}
.scale svg .grid{stroke:var(--rim);stroke-width:1}
.scale .key{display:flex;flex-wrap:wrap;gap:.4rem 1rem;font-size:.8rem;margin-top:.5rem}
.scale .key i{display:inline-block;width:.9rem;height:.2rem;border-radius:2px;vertical-align:middle;margin-right:.35rem}
.scale .route{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.6rem;counter-reset:hop}
.scale .route>div{counter-increment:hop;font-size:.82rem}
.scale .route div b::before{content:counter(hop) ". ";color:var(--acc)}
.scale .pains{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.6rem}
.scale .pains p{margin:.3rem 0 0;font-size:.82rem;color:var(--mut)}
.scale .pains em{font-style:normal;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--acc)}
`;

/** Players online across the bottom, a month's bill up the side, both on log scales; dots where a path passes DOs. */
function Chart({ l }: { l: Load }) {
  const pts = sweep(l), W = 640, H = 260, L = 46, B = 24, T = 8;
  const all = pts.flatMap((p) => Object.values(p.usd));
  const lo = Math.log10(Math.max(1, Math.min(...all))), hi = Math.log10(Math.max(...all)) + 0.1;
  const x = (ccu: number) => L + ((Math.log10(ccu) - 1) / 6) * (W - L - 4);
  const y = (v: number) => T + (1 - (Math.log10(Math.max(1, v)) - lo) / (hi - lo)) * (H - T - B);
  const decades = Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => 10 ** (Math.ceil(lo) + i));
  const cross = PATHS.filter((p) => p.id !== "do").map((p) => ({ id: p.id, at: crossover(l, "do", p.id) }));
  return (
    <div className="card">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly cost against players online, one line per home">
        {decades.map((d) => <g key={d}><line className="grid" x1={L} x2={W - 4} y1={y(d)} y2={y(d)} /><text x={L - 6} y={y(d) + 4} textAnchor="end">{usd(d)}</text></g>)}
        {[10, 100, 1e3, 1e4, 1e5, 1e6, 1e7].map((c) => <text key={c} x={x(c)} y={H - 6} textAnchor={c === 1e7 ? "end" : "middle"}>{people(c)}</text>)}
        <line className="grid" x1={x(l.ccu)} x2={x(l.ccu)} y1={T} y2={H - B} strokeDasharray="3 3" />
        {PATHS.map((p) => <polyline key={p.id} fill="none" stroke={COLOR[p.id]} strokeWidth={2} points={pts.map((q) => `${x(q.ccu).toFixed(1)},${y(q.usd[p.id]).toFixed(1)}`).join(" ")} />)}
        {cross.map((c) => c.at !== null && <circle key={c.id} cx={x(c.at)} cy={y(PATHS.find((p) => p.id === c.id)!.cost({ ...l, ccu: c.at }).usd)} r={4} fill={COLOR[c.id]} stroke="var(--paper)" strokeWidth={1.5} />)}
      </svg>
      <div className="key">{PATHS.map((p) => <span key={p.id}><i style={{ background: COLOR[p.id] }} />{p.name}</span>)}<span className="mut">dots: where it gets cheaper than Durable Objects · dashes: you</span></div>
    </div>
  );
}

const KNOBS: { k: keyof Load; label: string; step: string }[] = [
  { k: "ccu", label: "players online at once", step: "1" }, { k: "room", label: "players per room", step: "1" },
  { k: "rate", label: "messages a player sends a second", step: "any" }, { k: "awake", label: "share of the month rooms are busy (0-1)", step: "any" },
  { k: "bytes", label: "bytes a message", step: "1" }, { k: "ms", label: "ms a DO spends on one message", step: "any" },
  { k: "perCore", label: "socket work one server vCPU does a second", step: "1000" }, { k: "roomMb", label: "MB a room holds", step: "any" },
];

const ROUTE = [
  ["Cloudflare edge", "every player connects to the same address; the proxy passes websockets through for nothing"],
  ["Router Worker", "hashes the room id to a server (rendezvous hashing): adding a box moves only its share of rooms"],
  ["Regional pools", "Hetzner boxes Alchemy spawns in Europe, the US and Singapore, each running the Bun shell"],
  ["Same DO classes", "packages/shell-bun runs our Durable Object code unchanged: no rewrite, rooms keep their storage"],
  ["Spares and R2", "a spare per region, room storage snapshotted to R2, so a dead box's rooms rebuild on another"],
] as const;

const PAINS: { who: string; pain: string; fix: string }[] = [
  { who: "Durable Objects", pain: "The bill follows awake time, not players.", fix: "A room that can't hibernate (accept(), a server tick loop) bills 128 MB all day: $4.05 a room a month. Sockets in @rustybuns/util/room hibernates; keep ticks on the client." },
  { who: "Durable Objects", pain: "Socket messages are 20 to 1, but they add up.", fix: "At 20 inputs a second, requests are most of the bill. Sending inputs 10 times a second halves it; outgoing frames and auto-answered pings are free." },
  { who: "Servers", pain: "A room lives on one machine.", fix: "Round robin breaks a room: everyone in it must reach the same box. The router picks the box by room id; the load balancer only health-checks and fails over." },
  { who: "Servers", pain: "A box dies and takes its rooms.", fix: "Snapshot each room's SQLite to R2; the router sends the room to the spare, which rebuilds it, and pages reconnect." },
  { who: "Servers", pain: "Deploys drop every socket.", fix: "Drain a box first: no new rooms, let rooms empty or move, then replace it, one box a region at a time." },
  { who: "Everyone", pain: "Reconnect storms.", fix: "After a deploy or failover every page reconnects at once. connectSocket lets each caller pick its wait; add jitter so they spread out." },
  { who: "Servers", pain: "Paying for 3 a.m.", fix: "Servers bill whether anyone plays; Durable Objects bill nothing while asleep. Below the crossover, idle boxes are the waste." },
  { who: "Rivet Cloud", pain: "Bills that step.", fix: "Node caps jump the plan from $10 to $120 to $900 at 3, 10 and 50 nodes; it runs in six Google Cloud regions, and egress isn't on the price page." },
  { who: "Servers", pain: "Traffic outside Europe.", fix: "Hetzner includes 20 TB a box in Europe but 1-5 TB in the US and Singapore, and Singapore overage is EUR 7.40 a TB. Big rooms fan out a lot." },
  { who: "Servers", pain: "Ops is ours.", fix: "OS patches, full disks, certificates, alerts. Cloudflare and Rivet do that for you; Alchemy makes the boxes, not their upkeep." },
];

export function Scale({ l }: { l: Load }) {
  const n = needs(l), costs = PATHS.map((p) => ({ ...p, c: p.cost(l) }));
  const best = costs.reduce((a, b) => (b.c.usd < a.c.usd ? b : a));
  const levels = [100, 1000, 10_000, 100_000, 1_000_000];
  return (
    <div className="scale" style={{ display: "contents" }}>
      <div className="rowhead">
        <h2>Scale<em>what Qollab's rooms cost a month as players grow</em></h2>
        <nav className="range" aria-label="Rooms">{PRESETS.map((p) => <a key={p.id} href={href({ ...DEFAULT, ...p.load, ccu: l.ccu, regions: l.regions })} title={p.what} aria-current={Object.entries(p.load).every(([k, v]) => l[k as keyof Load] === v) ? "page" : undefined}>{p.name}</a>)}</nav>
      </div>
      <div className="tiles">
        {costs.map((p) => (
          <div key={p.id} className={`card tile${p.id === best.id ? " hero lead" : ""}`}>
            <b>{usd(p.c.usd)}</b>
            <span><i style={{ background: COLOR[p.id] }} />{p.name}{p.id === best.id ? ", cheapest" : ""}</span>
            <ul>{p.c.lines.filter(([, v]) => v >= 0.5).map(([k, v]) => <li key={k}><span>{k}</span><span>{usd(v)}</span></li>)}</ul>
            <span className="mut" style={{ fontSize: ".72rem" }}>{p.c.note}</span>
          </div>
        ))}
      </div>
      <h2>Crossovers<em>players online where each gets cheaper than Durable Objects</em></h2>
      <div className="tiles">
        {PATHS.filter((p) => p.id !== "do").map((p) => {
          const at = crossover(l, "do", p.id);
          return <div key={p.id} className="card tile"><b>{at === null ? "never" : people(at)}</b><span><i style={{ background: COLOR[p.id] }} />{p.name}{at === null ? " (up to 10M)" : ""}</span></div>;
        })}
      </div>
      <Chart l={l} />
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Players online</th>{PATHS.map((p) => <th key={p.id} className="num">{p.name}</th>)}</tr></thead>
          <tbody>{levels.map((ccu) => {
            const row = PATHS.map((p) => p.cost({ ...l, ccu }).usd), min = Math.min(...row);
            return <tr key={ccu}><td>{people(ccu)}</td>{row.map((v, i) => <td key={PATHS[i]!.id} className="num">{v === min ? <b>{usd(v)}</b> : usd(v)}</td>)}</tr>;
          })}</tbody>
        </table>
      </div>
      <form className="card knobs" method="get" action="/">
        <input type="hidden" name="tab" value="scale" />
        {KNOBS.map((k) => <label key={k.k}>{k.label}<input name={k.k} type="number" min="0" step={k.step} defaultValue={l[k.k]} /></label>)}
        <label>regions<select name="regions" defaultValue={String(l.regions)}><option value="1">Europe</option><option value="2">Europe and US</option><option value="3">Europe, US, Singapore</option></select></label>
        <label>rooms hibernate<select name="hibernate" defaultValue={String(l.hibernate)}><option value="1">yes, between messages</option><option value="0">no (accept() or a tick loop)</option></select></label>
        <button className={btn(true)} type="submit">Work it out</button>
      </form>
      <p className="mut" style={{ margin: "0 .4rem", fontSize: ".8rem" }}>
        This load: {n.rooms.toLocaleString("en-US")} rooms, {Math.round(n.msgs / 1e6).toLocaleString("en-US")}M messages in and {n.tb.toFixed(1)} TB out a month,
        {" "}{n.cores.toFixed(1)} vCPU and {n.ramGb.toFixed(1)} GB at the busy hour. Prices read 2026-11-06, euros at 1.15; the load balancer's are third-party
        figures. The vCPU rate and DO ms come from a relay room under load (scripts/room-stress.ts), halved for a shared vCPU and padded
        for workerd. Sums in apps/eqosys/src/scale.ts.
      </p>
      <h2>The path out<em>Cloudflare in front, wherever Alchemy puts the boxes</em></h2>
      <div className="card route">{ROUTE.map(([b, t]) => <div key={b}><b>{b}</b><div className="mut">{t}</div></div>)}</div>
      <h2>What hurts on the way</h2>
      <div className="pains">{PAINS.map((p) => <div key={p.pain} className="card"><em>{p.who}</em><b style={{ display: "block" }}>{p.pain}</b><p>{p.fix}</p></div>)}</div>
    </div>
  );
}
