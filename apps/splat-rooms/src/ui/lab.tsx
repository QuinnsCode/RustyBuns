// The gadget lab's hardware: the crest, the constructivist trim band, the gadget-watch face (the pause screen) and the
// score gauge (the win screen), all inline SVG drawn from the tokens in app.css, plus the cheeky words on top
// (codenames, operation names, ranks). Nothing here is a real emblem, flag or slogan.
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
      {[["12", 0, -44], ["3", 47, 5], ["6", 0, 54], ["9", -47, 5]].map(([t, x, y]) => <text key={t} x={x} y={y} className="w-num">{t}</text>)}
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
