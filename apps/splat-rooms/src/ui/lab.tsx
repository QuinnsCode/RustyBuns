// The gadget lab's hardware, all inline SVG drawn from the tokens in app.css: the crest, the constructivist trim band,
// the gadget-watch face (pause), the score gauge (win), the optic frame, charge cell and stopwatch (the hunt HUD), the
// satellite uplink and vacuum tube (the Room browser), the rotary dial (the menu's secure line) and the briefcase's
// gadgets (the field manual), plus the cheeky words on top (codenames, operation names, ranks). Nothing here is a real
// emblem, flag or slogan.
import { clamp, mulberry32 } from "@rustybuns/util";

const seedOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

const ADJ = ["Velvet", "Copper", "Silent", "Glass", "Midnight", "Tungsten", "Paper", "Quartz", "Crimson", "Frost", "Brass", "Hollow"] as const;
const NOUN = ["Heron", "Kettle", "Sparrow", "Lantern", "Marmot", "Teacup", "Pelican", "Abacus", "Owl", "Samovar", "Ferret", "Comet"] as const;

/** A room's operation name, the same every time for the same room: "Operation Velvet Kettle". */
export const operation = (id: string) => { const r = mulberry32(seedOf(id)); return `Operation ${pick(r, ADJ)} ${pick(r, NOUN)}`; };
/** The player's codename, from whatever this machine keeps steady (the scene folder): "Brass Heron". */
export const codename = (seed: string) => { const r = mulberry32(seedOf(`agent:${seed}`)); return `${pick(r, ADJ)} ${pick(r, NOUN)}`; };
/** A playful rank for how many hunts this machine has won. */
export const rank = (hunts: number) => hunts >= 40 ? "Lab Legend" : hunts >= 15 ? "Station Chief" : hunts >= 5 ? "Field Agent" : hunts >= 1 ? "Gadget Tester" : "Cadet";
/** The clearance a find earns, by stars. */
export const clearance = (stars: number) => ["Debrief pending", "Bronze clearance", "Silver clearance", "Gold clearance"][stars] ?? "";
/** A stencilled serial for a room or a gadget: "SR-0590". */
export const serial = (s: string) => `SR-${String(seedOf(s) % 10000).padStart(4, "0")}`;

/** The lab's crest: an aperture of six blades in a ticked ring, the ring's name round the edge. ~1 KB. */
export function Crest({ size = 64 }: { size?: number }) {
  const blades = Array.from({ length: 6 }, (_, i) => <path key={i} d="M0-22 L19-11 L6 -4 Z" transform={`rotate(${i * 60})`} />);
  const ticks = Array.from({ length: 36 }, (_, i) => <line key={i} y1={-34} y2={i % 3 ? -32 : -30} transform={`rotate(${i * 10})`} />);
  return (
    <svg className="crest" width={size} height={size} viewBox="-50 -50 100 100" aria-hidden>
      <defs><path id="crest-ring" d="M-41 0a41 41 0 1 1 82 0a41 41 0 1 1-82 0" /></defs>
      <circle r="47" className="crest-rim" />
      <circle r="35" className="crest-face" />
      <g className="crest-ticks">{ticks}</g>
      <g className="crest-blades">{blades}</g>
      <circle r="5" className="crest-eye" />
      <text className="crest-name"><textPath href="#crest-ring" startOffset="2%">GADGET LAB · FIELD DIVISION · SPLAT SECTION ·</textPath></text>
    </svg>
  );
}

/** The constructivist trim: a red wedge driven across cream hatching, with a stencilled serial. Edges and alerts wear it. ~0.6 KB. */
export function Band({ label }: { label?: string }) {
  return (
    <svg className="band" height="14" aria-hidden>
      <defs>
        <pattern id="band-hatch" width="8" height="14" patternUnits="userSpaceOnUse" patternTransform="skewX(-35)">
          <rect width="3" height="14" className="band-cream" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill="url(#band-hatch)" opacity=".5" />
      <path d="M0 0H178L164 14H0Z" className="band-red" />
      <path d="M186 0H200L186 14H172Z" className="band-red" />
      {label && <text x="10" y="10.2" className="band-text">{label}</text>}
    </svg>
  );
}

/**
 * The gadget watch: a brushed bezel with a crown, sixty ticks, a glowing chapter ring, hands that read the hunt's
 * clock (minutes and seconds), and a sub-dial for the charge left. ~2 KB.
 */
export function WatchFace({ seconds, charge, capacity, size = 220 }: { seconds: number; charge: number; capacity: number; size?: number }) {
  const ticks = Array.from({ length: 60 }, (_, i) => <line key={i} y1={-70} y2={i % 5 ? -66 : -60} className={i % 5 ? "w-tick" : "w-hour"} transform={`rotate(${i * 6})`} />);
  const sec = (seconds % 60) * 6, min = (seconds / 60 % 60) * 6;
  const full = charge / capacity, arc = 2 * Math.PI * 14;
  return (
    <svg className="watch" width={size} height={size} viewBox="-100 -100 200 200" role="img" aria-label={`${seconds.toFixed(1)} seconds on the clock, ${charge} of ${capacity} charge`}>
      <defs>
        <radialGradient id="w-metal" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#c9d2d9" /><stop offset=".45" stopColor="#6c7882" /><stop offset="1" stopColor="#262d33" /></radialGradient>
        <radialGradient id="w-face" cx="50%" cy="40%" r="70%"><stop offset="0" stopColor="#13202a" /><stop offset="1" stopColor="#05080b" /></radialGradient>
        <filter id="w-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
      </defs>
      <rect x="-30" y="-100" width="60" height="22" rx="4" className="w-lug" />
      <rect x="-30" y="78" width="60" height="22" rx="4" className="w-lug" />
      <rect x="86" y="-9" width="12" height="18" rx="2" className="w-crown" />
      <circle r="88" fill="url(#w-metal)" />
      <circle r="88" className="w-knurl" />
      <circle r="76" fill="url(#w-face)" />
      <circle r="73" className="w-ring-glow" filter="url(#w-glow)" />
      <circle r="73" className="w-ring" />
      <g>{ticks}</g>
      <path d="M-6-56H6L0-46Z" className="w-twelve" />
      {[["3", 47, 5], ["6", 0, 54], ["9", -47, 5]].map(([t, x, y]) => <text key={t} x={x} y={y} className="w-num">{t}</text>)}
      <text y="-24" className="w-brand">SPLAT · CHRONO</text>
      <g transform="translate(0 26)">
        <circle r="14" className="w-sub" />
        <circle r="14" className="w-sub-arc" strokeDasharray={`${arc * full} ${arc}`} transform="rotate(-90)" />
        <text y="3.5" className="w-sub-n">{charge}</text>
      </g>
      <line y2="-46" className="w-min" transform={`rotate(${min})`} />
      <line y1="12" y2="-64" className="w-sec" transform={`rotate(${sec})`} />
      <circle r="4" className="w-pin" />
    </svg>
  );
}

/** The score gauge: a half dial from 0 to 1000 in the three star bands, a needle on the points. ~1 KB. */
export function ScoreGauge({ points, size = 200 }: { points: number; size?: number }) {
  const pt = (p: number, r: number) => { const a = Math.PI * (1 - clamp(p, 0, 1000) / 1000); return [Math.cos(a) * r, -Math.sin(a) * r] as const; };
  const xy = (p: number, r: number) => pt(p, r).map((v) => v.toFixed(2)).join(" ");
  const band = (from: number, to: number, cls: string) => <path className={cls} d={`M${xy(from, 80)}A80 80 0 0 1 ${xy(to, 80)}`} />;
  const ticks = Array.from({ length: 21 }, (_, i) => {
    const [x1, y1] = pt(i * 50, 70), [x2, y2] = pt(i * 50, i % 5 ? 64 : 58);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="g-tick" />;
  });
  const [nx, ny] = pt(points, 74);
  return (
    <svg className="gauge" width={size} height={size * 0.58} viewBox="-100 -96 200 116" role="img" aria-label={`${points} points`}>
      <path className="g-bed" d="M-92 0A92 92 0 0 1 92 0Z" />
      {band(0, 450, "g-low")}{band(450, 750, "g-mid")}{band(750, 1000, "g-top")}
      {ticks}
      <line className="g-needle" x2={nx} y2={ny} />
      <circle r="7" className="g-pin" />
    </svg>
  );
}

/** The satellite-uplink readout: signal bars and a status line in the lab's mono. */
export function Uplink({ text }: { text: string }) {
  return (
    <p className="uplink">
      <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>{[0, 1, 2, 3].map((i) => <rect key={i} x={i * 5} y={9 - i * 3} width="3" height={3 + i * 3} />)}</svg>
      <span>{text}</span>
    </p>
  );
}

/**
 * The optic's frame over the hunt and the survey: four brushed corner brackets with a screw each, a ranging scale down
 * either edge, a ticked bearing ring round the crosshair and a stencilled plate in the corner. All hairlines, nothing
 * catches a pointer, and the rulers drop out on a phone. ~1.5 KB.
 */
export function ScopeFrame({ plate }: { plate: string }) {
  const corner = (k: string) => (
    <svg key={k} className={`scope-corner scope-${k}`} width="64" height="64" viewBox="0 0 64 64">
      <path className="sc-metal" d="M2 62V10L10 2H62V12H16L12 16V62Z" />
      <path className="sc-glow" d="M7 60V12L12 7H60" />
      <circle className="sc-screw" cx="20" cy="20" r="3.2" /><path className="sc-slot" d="M18 21.6L22 18.4" />
    </svg>
  );
  const rule = (k: string) => (
    <svg key={k} className={`scope-rule scope-rule-${k}`} width="34" height="244" viewBox="0 -2 34 244">
      {Array.from({ length: 25 }, (_, i) => <line key={i} x1={k === "l" ? 0 : 34 - (i % 5 ? 6 : 12)} x2={k === "l" ? (i % 5 ? 6 : 12) : 34} y1={i * 10} y2={i * 10} />)}
      {[0, 1, 2, 3, 4].map((i) => <text key={i} x={k === "l" ? 15 : 19} y={i * 50 + 3} textAnchor={k === "l" ? "start" : "end"}>{(2 - i) * 5 || "0"}</text>)}
    </svg>
  );
  const ring = Array.from({ length: 72 }, (_, i) => i % 18 === 0 ? null : <line key={i} y1={-96} y2={i % 6 ? -92 : -88} transform={`rotate(${i * 5})`} />);
  return (
    <div className="scope" aria-hidden>
      {["tl", "tr", "bl", "br"].map(corner)}
      {["l", "r"].map(rule)}
      <svg className="scope-ring" viewBox="-110 -110 220 220">
        <circle r="96" className="sr-ring" />
        <g className="sr-ticks">{ring}</g>
        {[0, 90, 180, 270].map((a) => <path key={a} className="sr-chev" d="M-5-104L0-98L5-104" transform={`rotate(${a})`} />)}
      </svg>
      <p className="scope-plate">{plate}</p>
    </div>
  );
}

/** The charge cell: a glass capsule on brass end caps, twelve filaments that glow while charged. ~0.8 KB. */
export function ChargeCell({ charge, capacity }: { charge: number; capacity: number }) {
  const w = capacity * 7 + 8;
  return (
    <svg className="cell" width={w + 16} height="22" viewBox={`0 0 ${w + 16} 22`} role="img" aria-label={`charge ${charge} of ${capacity}`}>
      <rect x="0" y="5" width="9" height="12" rx="2" className="cell-cap" />
      <rect x={w + 7} y="5" width="9" height="12" rx="2" className="cell-cap" />
      <rect x="7" y="1.5" width={w} height="19" rx="9.5" className="cell-glass" />
      {Array.from({ length: capacity }, (_, i) => <rect key={i} x={13 + i * 7} y="6" width="4" height="10" rx="1.2" className={i < charge ? "cell-on" : "cell-off"} />)}
      <path d={`M14 4.5H${w}`} className="cell-shine" />
    </svg>
  );
}

/** The HUD's stopwatch: a small dial with a sweep hand on the seconds and a red sector for the first twenty. ~0.5 KB. */
export function Chrono({ seconds }: { seconds: number }) {
  const ticks = Array.from({ length: 12 }, (_, i) => <line key={i} y1={-13} y2={-10.5} transform={`rotate(${i * 30})`} />);
  return (
    <svg className="chrono" width="32" height="32" viewBox="-16 -16 32 32" aria-hidden>
      <circle r="15" className="ch-bezel" />
      <path d="M0 0V-12.5A12.5 12.5 0 0 1 10.83 6.25Z" className="ch-sector" />
      <g className="ch-ticks">{ticks}</g>
      <line y2="-11" className="ch-hand" transform={`rotate(${(seconds % 60) * 6})`} />
      <circle r="1.8" className="ch-pin" />
    </svg>
  );
}

/**
 * The satellite-uplink readout over the Room browser: a dish on its mount sending three arcs, a carrier trace seeded by
 * the room, and the link's numbers in the lab mono. The arcs pulse slowly. ~1.3 KB.
 */
export function SatUplink({ room, objects }: { room: string | null; objects: number }) {
  const r = mulberry32(seedOf(room ?? "idle"));
  const trace = Array.from({ length: 33 }, (_, i) => `${i ? "L" : "M"}${84 + i * 4} ${21 + Math.sin(i * 0.9 + r() * 6) * (room ? 4 + r() * 5 : 1)}`).join("");
  const link = room ? 91 + Math.floor(r() * 9) : 0;
  return (
    <div className="sat">
      <svg className="sat-art" viewBox="0 -4 220 46" aria-hidden>
        <path className="sat-mount" d="M22 28L14 42H30Z" />
        <path className="sat-dish" d="M8 16A20 20 0 0 0 32 36Z" />
        <line className="sat-feed" x1="20" y1="26" x2="36" y2="12" />
        <g className={room ? "sat-arcs on" : "sat-arcs"}>{[7, 12, 17].map((d) => <path key={d} d={`M${arcAt(d, -0.9)}A${d} ${d} 0 0 1 ${arcAt(d, 0.25)}`} />)}</g>
        <rect x="80" y="6" width="136" height="30" rx="3" className="sat-scope" />
        <path className="sat-trace" d={trace} />
      </svg>
      <dl className="sat-read">
        <dt>Uplink</dt><dd>{room ? `SAT-${(seedOf(room) % 9) + 1} · locked` : "standing by"}</dd>
        <dt>Signal</dt><dd>{link}%</dd>
        <dt>Site</dt><dd>{room ? `${serial(room)} · ${objects} tagged` : "pick a room"}</dd>
      </dl>
    </div>
  );
}

const arcAt = (d: number, a: number) => `${(36 + Math.cos(a) * d).toFixed(1)} ${(12 + Math.sin(a) * d).toFixed(1)}`;

/** The vacuum-tube ornament: a glass envelope, a grid and a filament whose glow follows `level` (0 to 1). ~0.6 KB. */
export function Tube({ level, size = 34 }: { level: number; size?: number }) {
  return (
    <svg className="tube" width={size * 0.6} height={size} viewBox="0 0 24 40" aria-hidden style={{ ["--lvl" as string]: clamp(level, 0, 1) }}>
      <path className="tube-glass" d="M4 30V12A8 8 0 0 1 20 12V30Z" />
      <path className="tube-grid" d="M8 28V14M12 28V11M16 28V14M7 18H17M7 23H17" />
      <path className="tube-fil" d="M10 27L12 16L14 27" />
      <rect x="3" y="30" width="18" height="5" rx="1" className="tube-base" />
      {[6, 10, 14, 18].map((x) => <line key={x} x1={x} x2={x} y1="35" y2="39" className="tube-pin" />)}
    </svg>
  );
}

/** The secure line's rotary dial: ten finger holes round a cream centre card, a finger stop at four o'clock. ~0.7 KB. */
export function RotaryDial({ size = 46 }: { size?: number }) {
  const holes = Array.from({ length: 10 }, (_, i) => {
    const a = (-60 - i * 27) * Math.PI / 180;
    return <g key={i}><circle cx={Math.cos(a) * 15} cy={-Math.sin(a) * 15} r="4.2" className="rd-hole" />
      <text x={Math.cos(a) * 15} y={-Math.sin(a) * 15 + 2} className="rd-n">{(i + 1) % 10}</text></g>;
  });
  return (
    <svg className="rotary" width={size} height={size} viewBox="-23 -23 46 46" aria-hidden>
      <circle r="22" className="rd-plate" />
      {holes}
      <circle r="8" className="rd-card" />
      <text y="2" className="rd-card-t">SR</text>
      <path d="M17 9L21 14" className="rd-stop" />
    </svg>
  );
}

/** One foam cut-out in the field manual's briefcase, with the gadget that lives in it. ~0.3 KB each. */
export function Gadget({ kind }: { kind: "spray" | "watch" | "lens" | "cell" }) {
  const art = {
    spray: <><rect x="14" y="12" width="14" height="24" rx="3" className="gd-metal" /><rect x="17" y="6" width="8" height="6" rx="1" className="gd-dark" /><path d="M25 8h6" className="gd-line" /><path d="M14 20h14" className="gd-glow" /></>,
    watch: <><rect x="15" y="4" width="12" height="34" rx="3" className="gd-dark" /><circle cx="21" cy="21" r="10" className="gd-metal" /><circle cx="21" cy="21" r="7" className="gd-face" /><path d="M21 21V16M21 21l3 2" className="gd-glow" /></>,
    lens: <><circle cx="21" cy="21" r="13" className="gd-metal" /><circle cx="21" cy="21" r="9" className="gd-face" /><path d="M21 14v14M14 21h14" className="gd-glow" /></>,
    cell: <><rect x="8" y="15" width="26" height="12" rx="6" className="gd-face" /><rect x="5" y="17" width="4" height="8" rx="1" className="gd-metal" /><rect x="33" y="17" width="4" height="8" rx="1" className="gd-metal" /><path d="M13 21h16" className="gd-glow" /></>,
  }[kind];
  return <svg className="gadget" width="42" height="42" viewBox="0 0 42 42" aria-hidden><rect x="1" y="1" width="40" height="40" rx="9" className="gd-cut" />{art}</svg>;
}
