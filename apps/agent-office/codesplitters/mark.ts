// The codeSplitters mark: a pair of angle brackets, a black slice through the middle of both, and Twitter's
// notification dot in the corner when there's news.

export const DOT = "#1d9bf0";
const ORANGE = "#f97316";

/** The mark as SVG markup, 24×24. */
export function markSvg(dot = false, size = 24) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="M9 5.5 2.8 12 9 18.5M15 5.5 21.2 12 15 18.5" fill="none" stroke="${ORANGE}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M2 12h20" stroke="#fff" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M2.5 12h19" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>` +
    (dot ? `<circle cx="20" cy="4.5" r="3.6" fill="${DOT}" stroke="#fff" stroke-width="1.4"/>` : "") +
    `</svg>`;
}

/** The mark on a white tile, for a texture beside a board in the 3D office. */
export async function markCanvas(dot: boolean, px = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.strokeStyle = "#111";
  g.lineWidth = px / 24;
  g.beginPath();
  g.roundRect(g.lineWidth / 2, g.lineWidth / 2, px - g.lineWidth, px - g.lineWidth, px / 6);
  g.fill();
  g.stroke();
  const img = await svgImage(markSvg(dot, px));
  g.drawImage(img, px * 0.12, px * 0.12, px * 0.76, px * 0.76);
  return c;
}

/** `href` (the page's favicon) with the dot on it, as a data URL; `href` itself if it can't be drawn. */
export async function faviconWithDot(href: string, px = 64) {
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = href;
    });
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, px, px);
    g.fillStyle = DOT;
    g.strokeStyle = "#fff";
    g.lineWidth = px / 16;
    g.beginPath();
    g.arc(px * 0.78, px * 0.22, px * 0.19, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    return c.toDataURL("image/png");
  } catch { return href; }
}

function svgImage(svg: string) {
  return new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
