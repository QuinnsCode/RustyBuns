// The menu plates' painter (#3565), run inside headless Chrome by scripts/plates.ts: a seeded, procedural canvas bake
// of the warship's metal. Returns { name: dataUrl } for every image. Plain JS, so the page can run it as written.
// `medals` is { mode: lucide svg } for the vote cards' medallions, in MATCH_MODES order.
async (insigniaSvg, medals) => {
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
  // A power-armoured helmet in profile, raised out of the plate: domed crown, a brow ridge, the cold-blue visor slit, a
  // ribbed breather grille at the jaw and a gorget ring under it. Drawn facing +x from x0 to x1 (dir -1 mirrors it).
  function helmet(g, x0, x1, y0, dir) {
    const w = Math.abs(x1 - x0), h = 92, s = Math.min(w / 200, 1), ox = dir > 0 ? x0 + (w - 200 * s) / 2 : x0 - (w - 200 * s) / 2;
    g.save(); g.translate(ox, y0); g.scale(dir * s, s);
    const shell = () => { g.beginPath();
      g.moveTo(30, 82); g.lineTo(26, 54); g.bezierCurveTo(24, 20, 60, 2, 104, 2); g.bezierCurveTo(140, 2, 166, 18, 172, 40); // crown
      g.lineTo(184, 46); g.lineTo(186, 58); g.lineTo(170, 60); // brow and visor nose
      g.lineTo(176, 70); g.lineTo(168, 86); g.lineTo(130, 90); g.lineTo(120, 82); g.lineTo(60, 84); g.closePath(); };
    // the relief: a drop shadow down and right into the plate, then the shell lit from the top left
    g.save(); g.shadowColor = "rgba(0,0,0,0.8)"; g.shadowBlur = 8; g.shadowOffsetX = 3 * dir; g.shadowOffsetY = 4; shell(); g.fillStyle = "#1a1f26"; g.fill(); g.restore();
    const lit = g.createLinearGradient(0, 0, 0, h); lit.addColorStop(0, "#5d6874"); lit.addColorStop(0.45, "#2d343d"); lit.addColorStop(1, "#151a20");
    shell(); g.fillStyle = lit; g.fill();
    g.save(); shell(); g.clip(); g.globalAlpha = 0.5; g.fillStyle = g.createPattern(steel(256, 77, "#2a313a", false), "repeat"); g.fillRect(0, 0, 200, h); g.restore();
    shell(); g.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,0.85)"; g.stroke();
    g.beginPath(); g.moveTo(28, 58); g.bezierCurveTo(26, 24, 60, 5, 104, 5); g.bezierCurveTo(138, 5, 162, 18, 168, 38); g.lineWidth = 1.6; g.strokeStyle = "rgba(225,232,240,0.45)"; g.stroke(); // the crown's highlight
    // a brass crest stripe over the crown, the Marines' colour
    g.beginPath(); g.moveTo(40, 34); g.bezierCurveTo(56, 14, 84, 8, 112, 8); g.lineWidth = 5; g.strokeStyle = "#b8892c"; g.stroke(); g.lineWidth = 1; g.strokeStyle = "rgba(255,227,154,0.7)"; g.stroke();
    // seam between crown and face plate
    g.beginPath(); g.moveTo(120, 82); g.bezierCurveTo(116, 60, 124, 44, 150, 38); g.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,0.7)"; g.stroke();
    g.beginPath(); g.moveTo(122, 80); g.bezierCurveTo(118, 60, 126, 46, 150, 41); g.lineWidth = 1; g.strokeStyle = "rgba(220,228,238,0.25)"; g.stroke();
    // the visor slit, glowing
    g.save(); g.shadowColor = "rgba(120,200,255,0.9)"; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(140, 48); g.lineTo(180, 52); g.lineTo(178, 57); g.lineTo(138, 54); g.closePath(); g.fillStyle = "#8fd3ff"; g.fill(); g.restore();
    g.fillStyle = "rgba(230,248,255,0.9)"; g.fillRect(150, 51, 18, 1.4);
    // the breather grille: ribs on the jaw
    for (let k = 0; k < 5; k++) { const x = 140 + k * 6; g.fillStyle = "rgba(0,0,0,0.75)"; g.fillRect(x, 66, 3, 16); g.fillStyle = "rgba(220,228,238,0.2)"; g.fillRect(x + 3, 66, 1, 16); }
    // the ear housing: a bolted disc with a vent
    g.beginPath(); g.arc(86, 54, 15, 0, Math.PI * 2); g.fillStyle = "#20262e"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,0.8)"; g.stroke();
    g.beginPath(); g.arc(86, 54, 15, Math.PI * 1.05, Math.PI * 1.75); g.lineWidth = 1.2; g.strokeStyle = "rgba(225,232,240,0.4)"; g.stroke();
    for (let k = -1; k <= 1; k++) { g.fillStyle = "rgba(0,0,0,0.8)"; g.fillRect(78, 52 + k * 5, 16, 2); }
    // the gorget ring
    g.beginPath(); g.moveTo(34, 86); g.lineTo(164, 88); g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,0.6)"; g.stroke(); g.lineWidth = 1; g.strokeStyle = "rgba(220,228,238,0.25)"; g.beginPath(); g.moveTo(34, 84); g.lineTo(164, 86); g.stroke();
    g.restore();
  }

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
    // a Marine's helmet in relief on each outer bay, facing the insignia: the armour leads, not just the badge
    helmet(g, rim + 30, W * 0.3 - 26, H * 0.3 - 22, 1); helmet(g, W - rim - 30, W * 0.7 + 26, H * 0.3 - 22, -1);
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

  // --- 4. wear.webp: four frames of wear laid over the sunken cards, so no two cards in a row look alike: soot and
  // grime packed into the edges and corners, oil runs down from the top, chipped paint at the corners. Stretched to a
  // card's box (soft marks, so it can be), one frame per card in turn. Transparent.
  const FW = 160, FH = 100, FRAMES = 4;
  function wear(g, ox, seed) {
    const r = rng(seed), n = noise(r, 9), n2 = noise(r, 31), img = g.getImageData(ox, 0, FW, FH);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      // distance to the nearest edge, the foot weighted heavier (grime settles), broken up by noise
      const e = Math.min(x / FW, (FW - x) / FW, y / FH * 0.8, (FH - y) / FH * 0.45) * 2;
      const grit = n(x / FW, y / FH) * 0.7 + n2(x / FW, y / FH) * 0.3, k = Math.max(0, 0.28 - e) / 0.28;
      const a = Math.min(1, k * k * (0.45 + grit * 0.9) + (grit > 0.72 ? (grit - 0.72) * 0.9 : 0));
      const i = (y * FW + x) * 4; img.data[i] = 10; img.data[i + 1] = 9; img.data[i + 2] = 7; img.data[i + 3] = a * 210;
    }
    g.putImageData(img, ox, 0);
    g.save(); g.beginPath(); g.rect(ox, 0, FW, FH); g.clip();
    // oil runs: a soft dark streak from the top edge that wavers and thins as it drips, pooling a little at its foot
    g.filter = "blur(1.2px)";
    for (let k = 0, runs = 1 + Math.floor(r() * 3); k < runs; k++) {
      const x = ox + 14 + r() * (FW - 28), len = FH * (0.25 + r() * 0.45), w = 2.5 + r() * 3, sway = (r() - 0.5) * 6;
      const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, "rgba(10,8,5,0.7)"); gr.addColorStop(0.75, "rgba(14,11,6,0.4)"); gr.addColorStop(1, "rgba(14,11,6,0)");
      g.fillStyle = gr; g.beginPath(); g.moveTo(x - w * 2, 0); g.bezierCurveTo(x - w + sway, len * 0.4, x - w * 0.6 - sway, len * 0.7, x + sway * 0.5, len);
      g.bezierCurveTo(x + w * 0.6 - sway, len * 0.7, x + w + sway, len * 0.4, x + w * 2, 0); g.fill();
    }
    g.filter = "none";
    // chipped paint at a corner or two: small nicks of bare metal, a faint rust halo round a few
    for (let c = 0; c < 4; c++) if (r() < 0.5) {
      const cx = ox + (c % 2 ? FW - 6 : 6), cy = c < 2 ? 6 : FH - 6;
      for (let j = 0; j < 9; j++) {
        const x = cx + (r() - 0.5) * 12, y = cy + (r() - 0.5) * 8, rr = 0.4 + r() * 0.9;
        if (r() < 0.3) { g.beginPath(); g.arc(x, y, rr + 0.8, 0, Math.PI * 2); g.fillStyle = `rgba(110,62,28,${0.12 + r() * 0.15})`; g.fill(); }
        g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fillStyle = `rgba(205,214,226,${0.2 + r() * 0.3})`; g.fill();
      }
    }
    g.restore();
  }
  {
    const [c, g] = canvas(FW * FRAMES, FH);
    for (let f = 0; f < FRAMES; f++) wear(g, f * FW, 101 + f * 17);
    save("wear", c, 0.6);
  }

  // --- 5. serials.webp: stencilled serials sprayed on the cards and worn back, eight frames stacked. ------------------
  // The stencil face comes from the page's own font link, so the bake waits for it.
  const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Saira+Stencil+One&display=block" });
  document.head.append(link);
  await new Promise((ok, no) => { link.onload = ok; link.onerror = () => no(new Error("the font stylesheet did not load")); });
  await document.fonts.load('40px "Saira Stencil One"');
  if (!document.fonts.check('40px "Saira Stencil One"')) throw new Error("the stencil font did not load");
  const SERIALS = ["TM-0417 B", "HULL 07-C", "DECK 3 / 22", "TM-1180 A", "BAY 12-K", "LOT 559-D", "TM-0092 E", "FRAME 4-R"];
  const SW = 180, SH = 28;
  {
    const [c, g] = canvas(SW, SH * SERIALS.length), r = rng(303);
    g.font = '21px "Saira Stencil One"'; g.textBaseline = "middle"; g.textAlign = "right";
    SERIALS.forEach((t, i) => {
      const y = i * SH + SH / 2, paint = i % 3 === 1 ? "rgba(232,177,10,0.62)" : "rgba(214,222,232,0.5)";
      g.save(); g.beginPath(); g.rect(0, i * SH, SW, SH); g.clip();
      g.fillStyle = paint; g.fillText(t, SW - 4, y + 1);
      // overspray: a faint haze round the letters
      g.globalAlpha = 0.18; g.fillText(t, SW - 3, y + 2); g.globalAlpha = 1;
      // worn back: paint lost in specks and one scraped streak
      g.globalCompositeOperation = "destination-out";
      for (let k = 0; k < 110; k++) { g.fillStyle = `rgba(0,0,0,${0.4 + r() * 0.6})`; g.beginPath(); g.arc(r() * SW, i * SH + r() * SH, 0.5 + r() * 1.8, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 2 + r() * 3; g.strokeStyle = "rgba(0,0,0,0.7)"; g.beginPath(); const sy = i * SH + 6 + r() * (SH - 12); g.moveTo(r() * SW * 0.4, sy); g.lineTo(SW * (0.6 + r() * 0.4), sy + (r() - 0.5) * 8); g.stroke();
      g.restore();
    });
    save("serials", c, 0.7);
  }

  // --- 6. medals.webp: a medallion for each vote card, the mode's mark struck in brass on a riveted steel disc. -------
  {
    const M = 96, modes = Object.keys(medals), [c, g] = canvas(M * modes.length, M), b = bolt(64);
    for (const [i, mode] of modes.entries()) {
      const cx = i * M + M / 2, cy = M / 2, R = M * 0.44;
      // the disc: steel, a brass bezel ring, rivets at the cardinal points
      g.save(); g.beginPath(); g.arc(cx, cy + 3, R, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,0.6)"; g.filter = "blur(3px)"; g.fill(); g.restore();
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
      g.fillStyle = g.createPattern(steel(256, 211 + i * 13, "#232a33", false), "repeat"); g.fillRect(cx - R, cy - R, R * 2, R * 2);
      const dome = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, 2, cx, cy, R); dome.addColorStop(0, "rgba(255,255,255,0.16)"); dome.addColorStop(1, "rgba(0,0,0,0.45)"); g.fillStyle = dome; g.fillRect(cx - R, cy - R, R * 2, R * 2);
      g.restore();
      const bez = g.createLinearGradient(cx, cy - R, cx, cy + R); bez.addColorStop(0, "#ffe39a"); bez.addColorStop(0.45, "#d8a83f"); bez.addColorStop(1, "#7a5414");
      g.beginPath(); g.arc(cx, cy, R - 4, 0, Math.PI * 2); g.lineWidth = 7; g.strokeStyle = bez; g.stroke();
      g.beginPath(); g.arc(cx, cy, R - 8, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = "rgba(0,0,0,0.7)"; g.stroke();
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; g.drawImage(b, cx + Math.cos(a) * (R - 4) - 6, cy + Math.sin(a) * (R - 4) - 6, 12, 12); }
      // the mark: the lucide path, drawn thick, filled with brass, a dark strike line under it and a lit edge over it
      const mark = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(`the ${mode} mark did not load`));
        im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(medals[mode].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/stroke="currentColor"/, 'stroke="#fff"').replace(/stroke-width="2"/, 'stroke-width="2.4"').replace(/width="\d+" height="\d+"/, `width="${M}" height="${M}"`))}`; });
      const ms = R * 1.1, [mc, mg] = canvas(M, M);
      mg.drawImage(mark, (M - ms) / 2, (M - ms) / 2, ms, ms); mg.globalCompositeOperation = "source-in";
      const brass = mg.createLinearGradient(0, M * 0.25, 0, M * 0.75); brass.addColorStop(0, "#ffe7a6"); brass.addColorStop(0.5, "#d8a83f"); brass.addColorStop(1, "#8a6118"); mg.fillStyle = brass; mg.fillRect(0, 0, M, M);
      const [sc, sg] = canvas(M, M); sg.drawImage(mc, 0, 0); sg.globalCompositeOperation = "source-in"; sg.fillStyle = "#000"; sg.fillRect(0, 0, M, M);
      g.globalAlpha = 0.85; g.drawImage(sc, i * M + 1.5, 2.5); g.globalAlpha = 1;
      g.drawImage(mc, i * M, 0);
    }
    save("medals", c, 0.75);
  }
  return out;
}
