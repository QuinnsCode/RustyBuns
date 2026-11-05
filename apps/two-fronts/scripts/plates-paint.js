// The menu plates' painter (#3565), run inside headless Chrome by scripts/plates.ts: a seeded, procedural canvas bake
// of the warship's metal. Returns { name: dataUrl } for every image. Plain JS, so the page can run it as written.
async (insigniaSvg) => {
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
  const out = {};
  const save = (name, c, q = 0.78) => { out[name] = c.toDataURL("image/webp", q); };

  // Tileable value noise: a grid of `cells` random values that wraps, smoothly interpolated.
  const noise = (r, cells) => {
    const g = Array.from({ length: cells * cells }, r);
    const at = (x, y) => g[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
    const s = (t) => t * t * (3 - 2 * t);
    return (u, v) => { const x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  };
  // Draws `f` at (x, y) and at its wrapped copies, so a mark near an edge carries over into the next tile.
  const wrap = (S, x, y, pad, f) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) if (x + dx > -pad && x + dx < S + pad && y + dy > -pad && y + dy < S + pad) f(x + dx, y + dy); };

  // --- 1. steel.webp: brushed gunmetal, mottled, with oil blooms, scuffs and long scratches. Tiles both ways. ----------
  function steel(S, seed, base, dark) {
    const [c, g] = canvas(S, S), r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    // mottling: two octaves of wrapping noise, as light and shade
    const n1 = noise(r, 6), n2 = noise(r, 23), img = g.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = (n1(x / S, y / S) - 0.5) * 34 + (n2(x / S, y / S) - 0.5) * 14, i = (y * S + x) * 4;
      img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v * 1.08;
    }
    g.putImageData(img, 0, 0);
    // the brush: thousands of full-width hairlines, so it wraps sideways by construction
    for (let k = 0; k < S * 3.2; k++) {
      const y = r() * S, light = r() < 0.55;
      g.strokeStyle = light ? `rgba(220,230,242,${0.015 + r() * 0.05})` : `rgba(0,0,0,${0.03 + r() * 0.07})`;
      g.lineWidth = 0.5 + r() * 0.9; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 1.2); g.stroke();
    }
    // oil blooms and soot: soft dark pools
    for (let k = 0; k < 9; k++) {
      const x = r() * S, y = r() * S, rad = 30 + r() * 90, a = (dark ? 0.32 : 0.22) * (0.5 + r());
      wrap(S, x, y, rad, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, rad); gr.addColorStop(0, `rgba(6,7,9,${a})`); gr.addColorStop(0.6, `rgba(8,9,11,${a * 0.45})`); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); });
    }
    // scuffs: tight clusters of short bright strokes where boots and crates have rubbed
    for (let k = 0; k < 7; k++) {
      const cx = r() * S, cy = r() * S, ang = r() * Math.PI;
      for (let j = 0; j < 26; j++) {
        const x = cx + (r() - 0.5) * 60, y = cy + (r() - 0.5) * 26, len = 4 + r() * 16, a2 = ang + (r() - 0.5) * 0.4;
        wrap(S, x, y, 20, (px, py) => { g.strokeStyle = `rgba(225,232,240,${0.05 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 0.8; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a2) * len, py + Math.sin(a2) * len); g.stroke(); });
      }
    }
    // long scratches: a bright cut with a dark lip under it
    for (let k = 0; k < 14; k++) {
      const x = r() * S, y = r() * S, len = 60 + r() * 200, a = (r() - 0.5) * 0.9, bend = (r() - 0.5) * 30;
      wrap(S, x, y, len, (px, py) => {
        const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len, mx = (px + ex) / 2 + bend, my = (py + ey) / 2 - bend;
        g.lineWidth = 1.4; g.strokeStyle = "rgba(0,0,0,0.28)"; g.beginPath(); g.moveTo(px, py + 1); g.quadraticCurveTo(mx, my + 1, ex, ey + 1); g.stroke();
        g.lineWidth = 0.7; g.strokeStyle = `rgba(235,240,246,${0.16 + r() * 0.2})`; g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
      });
    }
    return c;
  }
  save("steel", steel(512, 7, "#1d222a", false), 0.72);
  save("inset", steel(256, 19, "#12161c", true), 0.72); // the darker, sunken steel of a card set into a plate

  // --- 2. bolt.webp: a hex bolt head, lit from the top left, in its counter-sunk seat. --------------------------------
  function bolt(S) {
    const [c, g] = canvas(S, S), cx = S / 2, cy = S / 2, R = S * 0.36;
    const seat = g.createRadialGradient(cx, cy + 2, R * 0.9, cx, cy + 2, R * 1.35); seat.addColorStop(0, "rgba(0,0,0,0.75)"); seat.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = seat; g.fillRect(0, 0, S, S);
    const hex = (rad, rot = Math.PI / 6) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = rot + (i * Math.PI) / 3; g[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.closePath(); };
    // six faces, each its own shade for the light from the top left
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI / 6 + (i * Math.PI) / 3, a1 = a0 + Math.PI / 3, mid = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(mid - (-Math.PI * 0.75));
      g.fillStyle = `rgb(${40 + lit * 150},${44 + lit * 152},${50 + lit * 156})`;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); g.closePath(); g.fill();
    }
    const top = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, 1, cx, cy, R * 0.72); top.addColorStop(0, "#c3cad3"); top.addColorStop(1, "#58606b");
    hex(R * 0.7); g.fillStyle = top; g.fill();
    hex(R); g.lineWidth = S / 40; g.strokeStyle = "#0d1014"; g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.26, 0, Math.PI * 2); g.fillStyle = "#2a2f36"; g.fill(); g.lineWidth = S / 64; g.strokeStyle = "rgba(220,226,234,0.5)"; g.stroke();
    return c;
  }
  save("bolt", bolt(64), 0.9);

  // --- 3. hero.webp: the title's hero plate, a heavy bulkhead plate with the Thunder Marines' insignia set in it. ------
  const insignia = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(insigniaSvg)}`; });
  function hero(W, H, seed) {
    const [c, g] = canvas(W, H), r = rng(seed), ch = 34;
    const shape = (inset) => { const k = ch - inset * 0.4; g.beginPath(); g.moveTo(inset + k, inset); g.lineTo(W - inset - k, inset); g.lineTo(W - inset, inset + k); g.lineTo(W - inset, H - inset - k); g.lineTo(W - inset - k, H - inset); g.lineTo(inset + k, H - inset); g.lineTo(inset, H - inset - k); g.lineTo(inset, inset + k); g.closePath(); };
    // the plate: steel, clipped to its chamfered outline, with a thick rim
    g.save(); shape(0); g.clip();
    g.fillStyle = g.createPattern(steel(512, seed + 1, "#20262f", false), "repeat"); g.fillRect(0, 0, W, H);
    // rim: lit top and left faces, dark bottom and right, then the plate's face recessed inside it
    const rim = 16;
    g.lineWidth = rim * 2; shape(0); g.strokeStyle = "rgba(0,0,0,0.35)"; g.stroke();
    const lit = g.createLinearGradient(0, 0, 0, H); lit.addColorStop(0, "rgba(190,200,212,0.32)"); lit.addColorStop(0.18, "rgba(120,130,142,0.08)"); lit.addColorStop(0.82, "rgba(0,0,0,0.05)"); lit.addColorStop(1, "rgba(0,0,0,0.45)");
    g.lineWidth = rim; shape(rim / 2); g.strokeStyle = lit; g.stroke();
    g.lineWidth = 2; shape(rim); g.strokeStyle = "rgba(0,0,0,0.75)"; g.stroke();
    g.lineWidth = 1; shape(rim + 1.5); g.strokeStyle = "rgba(210,220,230,0.16)"; g.stroke();
    // worn rim: paint and oxide chipped off along the outer edge
    for (let k = 0; k < 140; k++) {
      const side = Math.floor(r() * 4), t = r(), d = r() * rim * 0.9, w = 2 + r() * 10, h = 1 + r() * 3;
      const [x, y] = side === 0 ? [ch + t * (W - 2 * ch), d] : side === 1 ? [W - d, ch + t * (H - 2 * ch)] : side === 2 ? [ch + t * (W - 2 * ch), H - d] : [d, ch + t * (H - 2 * ch)];
      g.fillStyle = r() < 0.75 ? `rgba(200,210,222,${0.12 + r() * 0.25})` : `rgba(96,58,30,${0.25 + r() * 0.3})`;
      g.fillRect(x - w / 2, y - h / 2, side % 2 ? h : w, side % 2 ? w : h);
    }
    // panel seams: two grooves either side of the insignia's seat
    for (const sx of [W * 0.3, W * 0.7]) { g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(sx - 1.5, rim + 4, 3, H - 2 * rim - 8); g.fillStyle = "rgba(210,220,232,0.12)"; g.fillRect(sx + 1.5, rim + 4, 1, H - 2 * rim - 8); }
    // vent slats on the outer bays
    for (const [x0, x1] of [[rim + 30, W * 0.3 - 26], [W * 0.7 + 26, W - rim - 30]]) for (let k = 0; k < 6; k++) {
      const y = H * 0.3 + k * 14; g.fillStyle = "rgba(0,0,0,0.7)"; g.fillRect(x0, y, x1 - x0, 6); g.fillStyle = "rgba(220,228,238,0.14)"; g.fillRect(x0, y + 6, x1 - x0, 1.2);
    }
    // readout windows under the slats: cold blue bar graphs, as if the ship's state is live
    for (const x0 of [rim + 30, W * 0.7 + 26]) {
      const ww = W * 0.3 - 26 - rim - 30, y0 = H * 0.3 + 6 * 14 + 10, hh = H - rim - 22 - y0;
      g.fillStyle = "#081018"; g.fillRect(x0, y0, ww, hh); g.strokeStyle = "rgba(0,0,0,0.8)"; g.lineWidth = 2; g.strokeRect(x0, y0, ww, hh);
      for (let k = 0; k < 14; k++) { const bh = (0.2 + r() * 0.75) * (hh - 10), bx = x0 + 6 + k * ((ww - 12) / 14); g.fillStyle = `rgba(120,200,255,${0.35 + r() * 0.4})`; g.fillRect(bx, y0 + hh - 5 - bh, (ww - 12) / 14 - 3, bh); }
      for (let y = y0; y < y0 + hh; y += 3) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x0, y, ww, 1); }
    }
    // the insignia's seat: a recessed disc, then the insignia lit and casting a shadow into it
    const cx = W / 2, cy = H / 2, sr = H * 0.4;
    const pit = g.createRadialGradient(cx, cy - sr * 0.2, sr * 0.2, cx, cy, sr); pit.addColorStop(0, "rgba(0,0,0,0.15)"); pit.addColorStop(1, "rgba(0,0,0,0.6)");
    g.beginPath(); g.arc(cx, cy, sr, 0, Math.PI * 2); g.fillStyle = pit; g.fill();
    g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,0.8)"; g.beginPath(); g.arc(cx, cy, sr, Math.PI * 0.95, Math.PI * 2.05); g.stroke();
    g.strokeStyle = "rgba(210,220,232,0.2)"; g.beginPath(); g.arc(cx, cy, sr + 1.5, Math.PI * 0.05, Math.PI * 0.95); g.stroke();
    const iw = sr * 2.3, ih = iw * (80 / 120);
    g.save(); g.shadowColor = "rgba(0,0,0,0.85)"; g.shadowBlur = 14; g.shadowOffsetY = 6; g.drawImage(insignia, cx - iw / 2, cy - ih / 2, iw, ih); g.restore();
    // a warning chevron strip, once, along the foot of the plate
    const hy = H - rim - 12, hx0 = W * 0.36, hx1 = W * 0.64;
    g.save(); g.beginPath(); g.rect(hx0, hy, hx1 - hx0, 7); g.clip();
    for (let x = hx0 - 20; x < hx1 + 20; x += 16) { g.fillStyle = "#d9a50c"; g.beginPath(); g.moveTo(x, hy + 7); g.lineTo(x + 8, hy); g.lineTo(x + 16, hy); g.lineTo(x + 8, hy + 7); g.closePath(); g.fill(); }
    g.restore(); g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(hx0, hy + 7, hx1 - hx0, 1);
    g.restore();
    // hex bolts round the rim
    const b = bolt(64), bs = 22;
    const at = [[ch + 4, rim / 2 + 1], [W - ch - 4, rim / 2 + 1], [ch + 4, H - rim / 2 - 1], [W - ch - 4, H - rim / 2 - 1], [rim / 2 + 1, H / 2], [W - rim / 2 - 1, H / 2], [W * 0.3, rim / 2 + 1], [W * 0.7, rim / 2 + 1], [W * 0.3, H - rim / 2 - 1], [W * 0.7, H - rim / 2 - 1]];
    for (const [x, y] of at) g.drawImage(b, x - bs / 2, y - bs / 2, bs, bs);
    return c;
  }
  save("hero", hero(960, 300, 41), 0.8);
  return out;
}
