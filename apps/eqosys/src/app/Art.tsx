// Key art for each app's poster card: inline SVG, 200x300, no requests and no image host (the page's CSP allows none).
// Each is a small scene in the app's own colours. An app without one gets rings in a hue taken from its id.
import type { ReactNode } from "react";

interface Look { sky: [string, string]; art: ReactNode }

const LOOKS: Record<string, Look> = {
  "park-hide-seek": {
    sky: ["#14532d", "#86efac"],
    art: <>
      <circle cx="150" cy="70" r="26" fill="#fef9c3" opacity=".9" />
      <path d="M0 210Q60 160 120 200T200 180V300H0Z" fill="#166534" />
      {([[40, 190, 22], [95, 205, 28], [155, 192, 20]] as const).map(([x, y, r]) => <g key={x}><rect x={x - 3} y={y} width="6" height="36" fill="#422006" /><circle cx={x} cy={y - 4} r={r} fill="#22c55e" /></g>)}
      <circle cx="120" cy="226" r="7" fill="#fde68a" /><rect x="114" y="232" width="12" height="16" rx="5" fill="#f97316" />
    </>,
  },
  "skate-tech-park": {
    sky: ["#312e81", "#fb923c"],
    art: <>
      <circle cx="140" cy="110" r="34" fill="#fde68a" opacity=".85" />
      <path d="M0 150Q0 250 90 250H200V300H0Z" fill="#1e1b4b" />
      <path d="M0 150Q0 250 90 250" fill="none" stroke="#f8fafc" strokeWidth="5" />
      <g transform="rotate(-22 130 170)"><rect x="95" y="165" width="70" height="12" rx="6" fill="#f8fafc" /><circle cx="108" cy="186" r="6" fill="#fb923c" /><circle cx="152" cy="186" r="6" fill="#fb923c" /></g>
    </>,
  },
  geoboxq: {
    sky: ["#0c4a6e", "#38bdf8"],
    art: <>
      <circle cx="100" cy="125" r="62" fill="#0ea5e9" stroke="#e0f2fe" strokeWidth="3" />
      <path d="M72 95q18-14 30 0t-6 28-26 6-4-18zM108 138q22-6 28 12t-20 20-12-18z" fill="#4ade80" />
      <ellipse cx="100" cy="125" rx="26" ry="62" fill="none" stroke="#e0f2fe" strokeWidth="1.5" opacity=".6" />
      <path d="M38 125h124" stroke="#e0f2fe" strokeWidth="1.5" opacity=".6" />
      <path d="M100 210l-14-20h28z" fill="#f43f5e" /><circle cx="100" cy="186" r="9" fill="#f43f5e" /><circle cx="100" cy="186" r="3.5" fill="#fff" />
    </>,
  },
  "alien-disc-golf": {
    sky: ["#3b0764", "#0f172a"],
    art: <>
      {[[30, 40], [160, 60], [60, 120], [175, 150], [20, 180]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.8" fill="#e9d5ff" />)}
      <ellipse cx="100" cy="100" rx="52" ry="14" fill="#a78bfa" /><path d="M72 96a28 26 0 0156 0z" fill="#c4b5fd" />
      <path d="M80 112L50 230h100l-30-118z" fill="#a3e635" opacity=".22" />
      <ellipse cx="100" cy="232" rx="60" ry="12" fill="#1e293b" />
      <rect x="97" y="190" width="6" height="42" fill="#cbd5e1" /><path d="M78 190q22 14 44 0" fill="none" stroke="#a3e635" strokeWidth="4" />
      <ellipse cx="136" cy="214" rx="14" ry="4" fill="#f472b6" />
    </>,
  },
  "delayed-reaction": {
    sky: ["#064e3b", "#7c3aed"],
    art: <>
      {[22, 44, 66, 88, 110].map((r, i) => <circle key={r} cx="100" cy="140" r={r} fill="none" stroke="#a7f3d0" strokeWidth="2.5" opacity={1 - i * 0.17} />)}
      <circle cx="100" cy="140" r="12" fill="#fde047" />
      <path d="M0 250q25-30 50 0t50 0 50 0 50 0V300H0z" fill="#022c22" />
    </>,
  },
  "two-fronts": {
    sky: ["#7f1d1d", "#1e3a8a"],
    art: <>
      <path d="M0 0h200L0 300z" fill="#b91c1c" opacity=".55" /><path d="M200 300H0L200 0z" fill="#1d4ed8" opacity=".6" />
      <path d="M200 0L0 300" stroke="#fef3c7" strokeWidth="3" />
      <path d="M40 110l22-44 22 44zM116 250l22-44 22 44z" fill="#fef3c7" />
      <circle cx="100" cy="150" r="18" fill="none" stroke="#fef3c7" strokeWidth="3" />
    </>,
  },
  "git-recon": {
    sky: ["#1c1917", "#4d7c0f"],
    art: <>
      <path d="M0 230l50-50 40 30 50-60 60 70v80H0z" fill="#365314" />
      <circle cx="100" cy="125" r="56" fill="none" stroke="#d9f99d" strokeWidth="3" />
      <path d="M100 55v36M100 159v36M30 125h36M134 125h36" stroke="#d9f99d" strokeWidth="3" />
      <circle cx="100" cy="125" r="4" fill="#ef4444" />
      <circle cx="100" cy="125" r="28" fill="none" stroke="#d9f99d" strokeWidth="1" opacity=".6" />
    </>,
  },
  "splat-rooms": {
    sky: ["#831843", "#f59e0b"],
    art: <>
      <rect x="40" y="70" width="120" height="150" rx="6" fill="#fff1f2" opacity=".18" /><rect x="40" y="70" width="120" height="150" rx="6" fill="none" stroke="#fff1f2" strokeWidth="3" />
      <path d="M72 120q-8-26 18-24t30-12 24 22 8 26-22 14-16 26-26-8-24 6-6-26z" fill="#ec4899" />
      <circle cx="132" cy="170" r="12" fill="#22d3ee" /><circle cx="70" cy="190" r="8" fill="#facc15" /><circle cx="152" cy="126" r="5" fill="#22d3ee" />
    </>,
  },
  "hippo-tycoon": {
    sky: ["#0e7490", "#fcd34d"],
    art: <>
      <path d="M0 210q50-14 100 0t100 0v90H0z" fill="#0891b2" /><path d="M0 232q50-14 100 0t100 0v68H0z" fill="#0e7490" />
      <ellipse cx="100" cy="196" rx="60" ry="42" fill="#a8a29e" />
      <ellipse cx="100" cy="208" rx="46" ry="28" fill="#d6d3d1" />
      <circle cx="84" cy="212" r="4" fill="#44403c" /><circle cx="116" cy="212" r="4" fill="#44403c" />
      <circle cx="68" cy="160" r="9" fill="#a8a29e" /><circle cx="132" cy="160" r="9" fill="#a8a29e" />
      <circle cx="82" cy="172" r="5" fill="#292524" /><circle cx="118" cy="172" r="5" fill="#292524" />
      <circle cx="160" cy="84" r="22" fill="#fef08a" />
    </>,
  },
  "splat-spray": {
    sky: ["#0f172a", "#0ea5e9"],
    art: <>
      <rect x="0" y="0" width="200" height="300" fill="#e2e8f0" opacity=".1" />
      <path d="M30 90q30-30 60 0t60 0M30 130q40-26 80 0t40 0" fill="none" stroke="#f472b6" strokeWidth="14" strokeLinecap="round" />
      <path d="M44 140v44M110 134v70M150 100v38" stroke="#f472b6" strokeWidth="6" strokeLinecap="round" />
      <circle cx="44" cy="190" r="5" fill="#f472b6" /><circle cx="110" cy="210" r="5" fill="#f472b6" /><circle cx="150" cy="144" r="4" fill="#f472b6" />
      <rect x="84" y="226" width="32" height="56" rx="8" fill="#e2e8f0" /><rect x="94" y="214" width="12" height="14" fill="#94a3b8" /><rect x="84" y="244" width="32" height="14" fill="#f472b6" />
    </>,
  },
  qcrm: {
    sky: ["#134e4a", "#5eead4"],
    art: <>
      {[80, 130, 180].map((y, i) => <g key={y}><rect x="28" y={y} width="144" height="38" rx="9" fill="#f0fdfa" opacity={0.95 - i * 0.18} /><circle cx="50" cy={y + 19} r="10" fill="#0d9488" /><rect x="68" y={y + 11} width={72 - i * 10} height="6" rx="3" fill="#134e4a" /><rect x="68" y={y + 23} width="44" height="5" rx="2.5" fill="#5eead4" /></g>)}
    </>,
  },
  qntbr: {
    sky: ["#18181b", "#52525b"],
    art: <>
      <circle cx="100" cy="125" r="58" fill="none" stroke="#fafafa" strokeWidth="18" />
      <path d="M118 150l36 38" stroke="#fb923c" strokeWidth="18" strokeLinecap="round" />
    </>,
  },
};

const hueOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** A poster's art. `id` keeps each card's gradient apart from the others on the page. */
export function Art({ id }: { id: string }) {
  const look = LOOKS[id];
  const h = hueOf(id);
  const sky: [string, string] = look?.sky ?? [`oklch(.38 .1 ${h})`, `oklch(.74 .12 ${h + 40})`];
  return (
    <svg className="art" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky[0]} /><stop offset="1" stopColor={sky[1]} /></linearGradient>
      </defs>
      <rect width="200" height="300" fill={`url(#sky-${id})`} />
      {look ? look.art : [40, 70, 100].map((r) => <circle key={r} cx="100" cy="125" r={r} fill="none" stroke="#fff" strokeWidth="3" opacity={0.7 - r / 200} />)}
    </svg>
  );
}
