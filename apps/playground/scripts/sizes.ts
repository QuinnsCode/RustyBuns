// Every screen size the playground has to fit, side by side in real-size iframes (scaled down to look at).
// `bun run dev` in one shell, then `bun run sizes` and open http://localhost:8800. Pass a different page URL as the argument.
export const SIZES: [string, number, number][] = [
  ["iPhone SE", 375, 667],
  ["iPhone 15", 393, 852],
  ["iPhone Pro Max", 430, 932],
  ["Surface Duo, one screen", 540, 720],
  ["Surface Duo, spanned", 1114, 720],
  // iPhone Duo: 1398x2034 outer and 1878x2670 inner at 3x. The 3x is my reading of the ppi (460 and 430), not Apple's number: fix it here if the real points differ.
  ["iPhone Duo, outer", 466, 678],
  ["iPhone Duo, open", 626, 890],
  ["iPhone Duo, open sideways", 890, 626],
  ["iPad", 820, 1180],
  ["Laptop", 1440, 900],
];

if (import.meta.main) {
  const page = process.argv[2] ?? "http://localhost:8787";
  const cell = ([name, w, h]: (typeof SIZES)[number]) =>
    `<figure><figcaption>${name} ${w}x${h}</figcaption><div style="width:${w * 0.4}px;height:${h * 0.4}px"><iframe src="${page}" width="${w}" height="${h}" style="transform:scale(.4);transform-origin:0 0;border:0"></iframe></div></figure>`;
  const html = `<!doctype html><title>Sizes</title><body style="margin:16px;font:13px system-ui;display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">${SIZES.map(cell).join("")}`;
  Bun.serve({ port: 8800, fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });
  console.log("sizes on http://localhost:8800");
}
