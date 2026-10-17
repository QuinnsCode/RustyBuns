// The logo: a redwood at the top whose trunk runs down into the end of a skateboard deck, trucks and wheels
// underneath. The deck is the trunk, masked: the same bark furrows carry on through it. One tall SVG, so the
// intro can pan down it like a nature documentary and the menu can show it whole.
export const LOGO = { w: 400, h: 1340 } as const;

// A tiny seeded wobble, so the bark is the same every load.
const wob = (i: number, k: number) => Math.sin(i * 12.9898 + k * 78.233) * 43758.5453 % 1;

// Trunk and deck as one outline: the trunk flares into the deck's top face, the deck kicks up at both ends.
const BODY = "M150,300 C148,560 142,820 132,1040 C126,1110 100,1150 60,1160 C40,1162 28,1150 20,1128 C18,1156 22,1182 52,1198 L348,1198 C378,1182 382,1156 380,1128 C372,1150 360,1162 340,1160 C300,1150 274,1110 268,1040 C258,820 252,560 250,300 Z";

function bark(): string {
  let out = "";
  for (let i = 0; i < 46; i++) {
    const x = 18 + i * 8.4 + wob(i, 1) * 3, w = 1.4 + Math.abs(wob(i, 2)) * 2.6, lean = wob(i, 3) * 10;
    let d = `M${x.toFixed(1)},290`;
    for (let y = 290; y < 1210; y += 92) d += ` Q${(x + wob(i + y, 4) * 9 + lean * (y / 1200)).toFixed(1)},${y + 46} ${(x + lean * ((y + 92) / 1200)).toFixed(1)},${y + 92}`;
    out += `<path d="${d}" stroke="#4d2112" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${(0.5 + Math.abs(wob(i, 5)) * 0.4).toFixed(2)}"/>`;
    if (i % 3 === 0) out += `<path d="${d}" transform="translate(${(w + 2).toFixed(1)},0)" stroke="#d9835a" stroke-width="1.2" fill="none" opacity="0.45"/>`;
  }
  return out;
}

function foliage(): string {
  const tiers: [number, number, number, string][] = [[200, 70, 120, "#1d4a2c"], [200, 140, 150, "#245a35"], [200, 215, 170, "#2c6b3e"], [200, 290, 185, "#347a46"]];
  return tiers.map(([cx, y, r, fill], t) => {
    let d = `M${cx},${y - r * 0.9}`;
    const n = 9;
    for (let i = 0; i <= n; i++) { const x = cx - r + (2 * r * i) / n, drop = y + 30 + (i % 2 ? 22 : 0) + Math.abs(wob(i + t * 9, 6)) * 14; d += ` L${x.toFixed(1)},${drop.toFixed(1)}`; }
    return `<path d="${d} Z" fill="${fill}" stroke="#1b1b1f" stroke-width="4" stroke-linejoin="round"/>`;
  }).join("");
}

function wheel(cx: number, cy: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="36" fill="#f6ead2" stroke="#1b1b1f" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="14" fill="#e2572b" stroke="#1b1b1f" stroke-width="4"/>`;
}

function truck(cx: number): string {
  return `<rect x="${cx - 44}" y="1198" width="88" height="10" rx="3" fill="#bfc3c7" stroke="#1b1b1f" stroke-width="4"/>`
    + `<path d="M${cx - 30},1208 L${cx + 30},1208 L${cx + 16},1258 L${cx - 16},1258 Z" fill="#9ea3a8" stroke="#1b1b1f" stroke-width="4" stroke-linejoin="round"/>`
    + `<rect x="${cx - 22}" y="1210" width="44" height="12" rx="5" fill="#e2572b" stroke="#1b1b1f" stroke-width="3"/>`
    + `<rect x="${cx - 54}" y="1254" width="108" height="10" rx="5" fill="#5b5f64" stroke="#1b1b1f" stroke-width="4"/>`
    + wheel(cx, 1290);
}

/** The whole logo as SVG markup. `id` keeps the clip path unique when it appears twice on a page. */
export function logoSvg(id = "logo"): string {
  return `<svg class="logo" viewBox="0 0 ${LOGO.w} ${LOGO.h}" role="img" aria-label="Skate Tech Park: a redwood whose trunk runs into a skateboard" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><clipPath id="${id}-body"><path d="${BODY}"/></clipPath>`
    + `<linearGradient id="${id}-shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".34"/></linearGradient></defs>`
    + `<path d="${BODY}" fill="#9a4a2a"/>`
    + `<g clip-path="url(#${id}-body)">${bark()}<rect x="0" y="280" width="400" height="940" fill="url(#${id}-shade)"/>`
    // the deck's own edge: lighter plies along the underside, and the grip line where the trunk meets the top face
    + `<rect x="0" y="1176" width="400" height="22" fill="#6b2f19"/><path d="M0,1180 H400 M0,1187 H400" stroke="#d9835a" stroke-width="2" opacity=".7"/></g>`
    + `<path d="${BODY}" fill="none" stroke="#1b1b1f" stroke-width="5" stroke-linejoin="round"/>`
    + `<path d="M64,1160 C100,1166 150,1166 200,1166 C250,1166 300,1166 336,1160" fill="none" stroke="#1b1b1f" stroke-width="3" opacity=".55"/>`
    + `${truck(110)}${truck(290)}${foliage()}</svg>`;
}

/** A small side-on board for the title to skate in on. */
export function boardSvg(): string {
  return `<svg class="roller" viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<path d="M4,6 C6,16 12,20 20,20 L100,20 C108,20 114,16 116,6 C118,22 112,26 104,26 L16,26 C8,26 2,22 4,6 Z" fill="#9a4a2a" stroke="#1b1b1f" stroke-width="3" stroke-linejoin="round"/>`
    + `<rect x="24" y="26" width="18" height="5" rx="2" fill="#bfc3c7" stroke="#1b1b1f" stroke-width="2.5"/><rect x="78" y="26" width="18" height="5" rx="2" fill="#bfc3c7" stroke="#1b1b1f" stroke-width="2.5"/>`
    + `<circle cx="33" cy="35" r="7" fill="#f6ead2" stroke="#1b1b1f" stroke-width="3"/><circle cx="87" cy="35" r="7" fill="#f6ead2" stroke="#1b1b1f" stroke-width="3"/></svg>`;
}
