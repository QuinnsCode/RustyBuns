// The gadget lab's set dressing: codenames and ranks for the cheese, and the small SVG pieces every screen shares
// (the constructivist bands, the gadget watch, the uplink readout, the tube gauge). All of it is inline SVG drawn
// from a few numbers, about 3 KB of source together, no image files. Colours come from app.css's tokens.

const ADJ = ["Velvet", "Silent", "Copper", "Midnight", "Glass", "Frost", "Amber", "Iron", "Silver", "Polar", "Crimson", "Quiet", "Brass", "Neon", "Paper", "Arctic"];
const NOUN = ["Teapot", "Kestrel", "Samovar", "Locket", "Lantern", "Sparrow", "Gambit", "Monocle", "Cuckoo", "Thimble", "Dynamo", "Periscope", "Walnut", "Accordion", "Comet", "Hatbox"];
const AGENT = ["Nightjar", "Magpie", "Heron", "Lynx", "Marmot", "Osprey", "Stoat", "Wren", "Ibex", "Puffin", "Badger", "Merlin"];

/** A stable 32-bit hash of a string (FNV-1a), so a room or a name always gets the same codename. */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** A room's mission name on the board: "Operation Velvet Teapot". */
export const operation = (id: string) => { const h = hash(id); return `Operation ${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`; };
/** The agent card's codename for a player (or the guest). */
export const agentName = (who: string) => AGENT[hash(who.toLowerCase()) % AGENT.length]!;
/** The stencilled number on the agent card, stable per player. */
export const cardNo = (who: string) => `SR-${(hash(`card:${who.toLowerCase()}`) % 90000) + 10000}`;

/** Ranks by hunts won, lowest first: [won at least, rank]. */
export const RANKS: [number, string][] = [[0, "Recruit"], [1, "Probationer"], [5, "Field Agent"], [15, "Senior Operative"], [40, "Section Chief"]];
export const rankFor = (won: number) => RANKS.filter(([n]) => won >= n).at(-1)![1];
/** The debrief's verdict for a hunt's stars. */
export const VERDICT = { 1: "Desk duty", 2: "Field agent", 3: "Top gadgeteer" } as const;

/** Red and cream diagonal bands with a wedge: set dressing on edges and alerts. */
export function Bands({ className = "bands" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 140" aria-hidden preserveAspectRatio="xMaxYMax meet">
      <path d="M240 18 L240 52 L60 140 L0 140 Z" fill="var(--red)" />
      <path d="M240 64 L240 76 L112 140 L88 140 Z" fill="var(--cream)" />
      <path d="M240 88 L240 96 L156 140 L140 140 Z" fill="var(--cream)" opacity=".7" />
      <circle cx="214" cy="118" r="14" fill="none" stroke="var(--cream)" strokeWidth="3" />
      <path d="M214 104 A14 14 0 0 1 228 118 L214 118 Z" fill="var(--cream)" />
    </svg>
  );
}

/** A thin red-cream trim strip for the top of a panel. */
export const Trim = () => <span className="trim" aria-hidden />;

/** The gadget watch: a bezel with 60 ticks, the charge as a glowing arc and the hunt clock on its hands. */
export function Watch({ seconds, charge, capacity }: { seconds: number; charge: number; capacity: number }) {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i * 6 * Math.PI) / 180, major = i % 5 === 0, r1 = major ? 70 : 74;
    return <line key={i} x1={100 + Math.sin(a) * r1} y1={100 - Math.cos(a) * r1} x2={100 + Math.sin(a) * 79} y2={100 - Math.cos(a) * 79}
      stroke={major ? "var(--ink)" : "var(--dim)"} strokeWidth={major ? 2.2 : 1} />;
  });
  const arc = Math.max(0, Math.min(1, charge / capacity)), len = 2 * Math.PI * 62;
  const hand = (deg: number, r: number, w: number, c: string) => {
    const a = (deg * Math.PI) / 180;
    return <line x1="100" y1="100" x2={100 + Math.sin(a) * r} y2={100 - Math.cos(a) * r} stroke={c} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <svg className="watch" viewBox="0 0 200 200" role="img" aria-label={`${seconds.toFixed(1)} seconds, charge ${charge} of ${capacity}`}>
      <defs>
        <radialGradient id="bezel" cx="40%" cy="30%"><stop offset="0" stopColor="#d9e1e6" /><stop offset=".55" stopColor="#6f7d86" /><stop offset="1" stopColor="#2a3238" /></radialGradient>
        <radialGradient id="face" cx="50%" cy="38%"><stop offset="0" stopColor="#14202a" /><stop offset="1" stopColor="#05080b" /></radialGradient>
      </defs>
      <rect x="186" y="92" width="10" height="16" rx="2" fill="url(#bezel)" />
      <circle cx="100" cy="100" r="92" fill="url(#bezel)" />
      <circle cx="100" cy="100" r="84" fill="url(#face)" stroke="#0008" strokeWidth="2" />
      {ticks}
      <circle cx="100" cy="100" r="62" fill="none" stroke="var(--edge)" strokeWidth="5" />
      <circle className="watch-charge" cx="100" cy="100" r="62" fill="none" stroke="var(--accent)" strokeWidth="5"
        strokeDasharray={`${len * arc} ${len}`} transform="rotate(-90 100 100)" strokeLinecap="round" />
      <text x="100" y="72" textAnchor="middle" className="watch-word">LAB · 7</text>
      <text x="100" y="140" textAnchor="middle" className="watch-num">{seconds.toFixed(1)}s</text>
      {hand(seconds * 0.6, 44, 4, "var(--ink)") /* once round in ten minutes */}
      {hand((seconds % 60) * 6, 66, 1.6, "var(--red)")}
      <circle cx="100" cy="100" r="4" fill="var(--cream)" />
    </svg>
  );
}

/** The satellite-uplink readout: a dish and four signal bars that breathe. */
export function Uplink() {
  return (
    <svg className="uplink" viewBox="0 0 44 20" aria-hidden>
      <path d="M2 16 A9 9 0 0 1 14 4" fill="none" stroke="var(--dim)" strokeWidth="1.6" />
      <line x1="6" y1="12" x2="13" y2="5" stroke="var(--dim)" strokeWidth="1.2" />
      <circle cx="13" cy="5" r="1.6" fill="var(--accent)" />
      {[0, 1, 2, 3].map((i) => <rect key={i} className="uplink-bar" x={22 + i * 5.5} y={14 - i * 3.5} width="3.5" height={4 + i * 3.5} rx=".8" style={{ animationDelay: `${i * 0.18}s` }} />)}
    </svg>
  );
}

/** A vacuum-tube needle gauge, 0..1: ornament on the agent card. */
export function Gauge({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value)), a = (-60 + v * 120) * (Math.PI / 180);
  return (
    <svg className="gauge" viewBox="0 0 120 74" role="img" aria-label={label}>
      <path d="M14 62 A48 48 0 0 1 106 62" fill="none" stroke="var(--edge)" strokeWidth="8" />
      <path d="M86 26 A48 48 0 0 1 106 62" fill="none" stroke="var(--red)" strokeWidth="8" />
      {Array.from({ length: 9 }, (_, i) => { const t = (-60 + i * 15) * (Math.PI / 180); return <line key={i} x1={60 + Math.sin(t) * 38} y1={66 - Math.cos(t) * 38} x2={60 + Math.sin(t) * 44} y2={66 - Math.cos(t) * 44} stroke="var(--dim)" strokeWidth="1.2" />; })}
      <line x1="60" y1="66" x2={60 + Math.sin(a) * 46} y2={66 - Math.cos(a) * 46} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" className="gauge-needle" />
      <circle cx="60" cy="66" r="5" fill="var(--cream)" />
    </svg>
  );
}

/** A tick box for the mission board's objectives. */
export const Tick = ({ on }: { on: boolean }) => (
  <svg className={on ? "tick on" : "tick"} viewBox="0 0 14 14" aria-hidden>
    <rect x="1" y="1" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    {on && <path d="M3.5 7.2 L6 9.6 L10.6 4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
);
