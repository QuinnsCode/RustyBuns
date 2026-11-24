// The README's sandwich scenes, drawn on one 800x450 canvas: `drawFrame(name, t)` paints scene `name` at `t` seconds.
// scripts/sandwich-gifs.ts loads this in a headless Chrome, steps `t` and packs the frames into docs/sandwich/*.gif.
// Plain browser JS on purpose: nothing imports it, and it runs as is in any page with a <canvas>.
(() => {
  const W = 800, H = 450;
  const C = { bg: "#fff7ea", ink: "#2a1a0e", soft: "#7a5a3a", orange: "#e85d04", gold: "#ffb703", rust: "#c2410c", plate: "#f1e4cf" };
  const FONT = '"SF Pro Rounded", ui-rounded, "Helvetica Neue", system-ui, sans-serif';

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const back = (x) => { x = clamp01(x); const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const rand = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };

  // The breads, one per place the app runs. `crust` is the outline, `dots` the topping.
  const BREADS = {
    page:    { name: "the page",    bread: "brioche",   sub: "Vite",           top: "#f2a93b", crust: "#c97a1c", dots: "#fff3d6" },
    worker:  { name: "a Worker",    bread: "pretzel",   sub: "the edge",       top: "#8a4b1f", crust: "#5e2f10", dots: "#ffffff" },
    server:  { name: "a server",    bread: "rye",       sub: "Bun + sqlite",   top: "#7a5236", crust: "#4f321e", dots: "#3a2414" },
    desktop: { name: "the desktop", bread: "bagel",     sub: "one file",       top: "#d9a45c", crust: "#a8732f", dots: "#f6e7c8" },
    phone:   { name: "the phone",   bread: "sourdough", sub: "crusty, careful", top: "#c8853e", crust: "#8f5520", dots: "#f3d7a8" },
  };
  const ORDER = ["page", "worker", "server", "desktop", "phone"];

  let ctx;
  const text = (s, x, y, size, color = C.ink, align = "center", weight = 800) => {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(s, x, y);
  };
  const pill = (s, x, y, size, fill, color = "#fff") => {
    ctx.font = `800 ${size}px ${FONT}`;
    const w = ctx.measureText(s).width + size * 1.2, h = size * 1.7;
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    text(s, x, y + 1, size, color);
  };
  const clear = () => { ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); };
  const plate = (cx, y, w) => {
    ctx.fillStyle = C.plate; ctx.beginPath(); ctx.ellipse(cx, y, w * 0.62, w * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e3d2b6"; ctx.lineWidth = 2; ctx.stroke();
  };

  // A bun half. `top` domes up from y (its bottom edge); a bottom half sits with its top edge at y.
  function bun(kind, cx, y, w, top, seed = 1) {
    const b = BREADS[kind], h = top ? w * 0.26 : w * 0.12, x = cx - w / 2;
    ctx.save(); ctx.beginPath();
    if (top) {
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - w * 0.02, y - h * 1.15, x + w * 1.02, y - h * 1.15, x + w, y);
      ctx.closePath();
    } else ctx.roundRect(x + w * 0.02, y, w * 0.96, h, [4, 4, h * 0.6, h * 0.6]);
    const g = ctx.createLinearGradient(0, y - (top ? h : 0), 0, y + (top ? 0 : h));
    g.addColorStop(0, b.top); g.addColorStop(1, b.crust);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = b.crust; ctx.stroke();
    ctx.clip();
    const r = rand(seed * 97 + kind.length);
    if (top) {
      if (kind === "phone") { // scored crust
        ctx.strokeStyle = b.dots; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) { const sx = x + w * (0.3 + i * 0.2); ctx.beginPath(); ctx.moveTo(sx - 14, y - h * 0.45); ctx.quadraticCurveTo(sx, y - h * 0.75, sx + 14, y - h * 0.5); ctx.stroke(); }
      } else if (kind === "desktop") { // the bagel's shine and seeds
        ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.beginPath(); ctx.ellipse(cx, y - h * 0.55, w * 0.18, h * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      }
      const n = kind === "server" ? 14 : kind === "worker" ? 12 : 18;
      ctx.fillStyle = b.dots;
      for (let i = 0; i < n; i++) {
        const dx = x + w * (0.12 + r() * 0.76), dy = y - h * (0.25 + r() * 0.6);
        ctx.save(); ctx.translate(dx, dy); ctx.rotate(r() * 3);
        ctx.beginPath();
        if (kind === "worker") ctx.rect(-3, -3, 6, 6); else ctx.ellipse(0, 0, kind === "server" ? 2.2 : 4, 2, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.restore();
      }
    }
    ctx.restore();
    return h;
  }

  // The meat: the same five layers on every sandwich. Returns the stack's height.
  const MEAT = [
    { kind: "patty", label: "types" },
    { kind: "cheese" },
    { kind: "patty", label: "state" },
    { kind: "tomato" },
    { kind: "patty", label: "rules" },
    { kind: "lettuce" },
  ];
  const layerH = (kind, w) => (kind === "patty" ? w * 0.11 : kind === "lettuce" ? w * 0.05 : w * 0.04);
  const meatHeight = (w) => MEAT.reduce((s, l) => s + layerH(l.kind, w) - 2, 0);

  function layer(kind, cx, y, w, label, tint) {
    const h = layerH(kind, w), x = cx - w / 2;
    ctx.save();
    if (kind === "patty") {
      ctx.fillStyle = tint || "#6b3a1f"; ctx.beginPath(); ctx.roundRect(x, y - h, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "rgba(255,200,150,.25)"; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) { const sx = x + w * (0.12 + i * 0.15); ctx.beginPath(); ctx.moveTo(sx, y - h * 0.3); ctx.lineTo(sx + 10, y - h * 0.7); ctx.stroke(); }
      if (label && w > 140) text(label, cx, y - h / 2 + 1, Math.max(10, w * 0.055), "#ffe9cf");
    } else if (kind === "cheese") {
      ctx.fillStyle = "#ffc93c"; ctx.beginPath(); ctx.moveTo(x - 6, y - h);
      ctx.lineTo(x + w + 6, y - h); ctx.lineTo(x + w + 6, y);
      for (let i = 4; i >= 0; i--) { const dx = x + w * (i / 4); ctx.lineTo(dx + 10, y); ctx.lineTo(dx, y + h * 1.3); ctx.lineTo(dx - 10, y); }
      ctx.closePath(); ctx.fill();
    } else if (kind === "tomato") {
      ctx.fillStyle = "#e63946"; ctx.beginPath(); ctx.roundRect(x + 6, y - h, w - 12, h, h / 2); ctx.fill();
    } else if (kind === "lettuce") {
      ctx.fillStyle = "#6ab04c"; ctx.beginPath(); ctx.moveTo(x - 8, y);
      const n = 10; for (let i = 0; i <= n; i++) { const dx = x - 8 + ((w + 16) * i) / n; ctx.quadraticCurveTo(dx - (w / n) / 2, y - h * (i % 2 ? 1.4 : 0.6), dx, y - h * 0.8); }
      ctx.lineTo(x + w + 8, y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return h - 2;
  }

  // The meat stacked up from `y` (its bottom). `drop(i)` lifts each layer while it falls in; `tint` recolors the patties.
  function meat(cx, y, w, drop = () => 0, tint) {
    let at = y;
    MEAT.forEach((l, i) => { at -= layer(l.kind, cx, at - drop(i), w, l.label, tint) * 1; });
    return y - at;
  }

  // A whole sandwich on its plate. `lift` moves the top bun up, `slide` moves both bun halves sideways.
  function sandwich(cx, baseY, w, kind, o = {}) {
    const { lift = 0, slide = 0, alpha = 1, tint, noMeat = false, seed = 1 } = o;
    plate(cx, baseY + 4, w);
    ctx.globalAlpha = alpha;
    const bh = bun(kind, cx + slide, baseY - w * 0.12, w, false, seed);
    ctx.globalAlpha = 1;
    const top = baseY - bh;
    const mh = noMeat ? 0 : meat(cx, top, w * 0.98, undefined, tint);
    ctx.globalAlpha = alpha;
    bun(kind, cx + slide, top - mh - lift, w, true, seed);
    ctx.globalAlpha = 1;
    return { top: top - mh - w * 0.26 - lift };
  }

  const fade = (t, len) => { const a = Math.min(seg(t, 0, 0.25), 1 - seg(t, len - 0.35, len)); if (a < 1) { ctx.globalAlpha = 1 - a; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; } };

  const SCENES = {
    // 1. The meat drops in, layer by layer, with no bread at all.
    meat: { seconds: 5, draw(t) {
      const cx = 400, y = 330, w = 330;
      text("1. Your business logic", 400, 52, 32);
      plate(cx, y + 4, w);
      let at = y;
      MEAT.forEach((l, i) => {
        const p = back(seg(t, 0.3 + i * 0.28, 0.75 + i * 0.28));
        ctx.globalAlpha = seg(t, 0.3 + i * 0.28, 0.4 + i * 0.28);
        const h = layer(l.kind, cx, at - (1 - p) * 260, w, l.label);
        ctx.globalAlpha = 1;
        at -= h;
      });
      const a = smooth(seg(t, 2.3, 2.8)); ctx.globalAlpha = a;
      text("SUPER MEATY", 400, 108, 46, C.orange);
      ctx.globalAlpha = smooth(seg(t, 2.9, 3.4));
      text("the rules, the state, the types. Written once.", 400, 392, 22, C.soft, "center", 700);
      text("No bread yet: it doesn't know where it runs.", 400, 422, 18, C.soft, "center", 600);
      ctx.globalAlpha = 1;
    } },

    // 2. The meat stays put while each bread slides in and out.
    swap: { seconds: 7.5, draw(t) {
      const cx = 400, y = 362, w = 280, each = 1.5;
      text("2. Swap the bread", 400, 46, 32);
      const i = Math.min(ORDER.length - 1, Math.floor(t / each)), p = (t - i * each) / each, kind = ORDER[i], b = BREADS[kind];
      const inn = 1 - back(seg(p, 0, 0.28)), out = smooth(seg(p, 0.8, 1));
      const slide = -inn * 520 + out * 520;
      sandwich(cx, y, w, kind, { slide, seed: i + 1 });
      const ta = Math.min(smooth(seg(p, 0.15, 0.3)), 1 - smooth(seg(p, 0.8, 0.92)));
      ctx.globalAlpha = ta;
      pill(b.name, 400, 90, 24, C.orange);
      text(`${b.bread} bread · ${b.sub}`, 400, 124, 18, C.soft, "center", 700);
      ctx.globalAlpha = 1;
      text("same meat, every time", 400, 410, 20, C.soft, "center", 700);
      ORDER.forEach((k, j) => { ctx.fillStyle = j === i ? C.orange : "#e3d2b6"; ctx.beginPath(); ctx.arc(400 + (j - 2) * 20, 436, 5, 0, Math.PI * 2); ctx.fill(); });
    } },

    // 3. One meat, copied out to five sandwiches; each brings its own bread.
    copy: { seconds: 6, draw(t) {
      text("3. Bring the bread. Copy the sandwich.", 400, 44, 30);
      const home = { x: 400, y: 190, w: 200 };
      const slots = ORDER.map((k, j) => ({ k, x: 88 + j * 156, y: 370, w: 118 }));
      const fly = smooth(seg(t, 0.9, 2.0));
      if (fly < 1) { plate(home.x, home.y + 4, home.w); meat(home.x, home.y, home.w); }
      slots.forEach((s, j) => {
        const q = smooth(seg(t, 0.8 + j * 0.12, 1.9 + j * 0.12));
        if (q <= 0) return;
        const x = home.x + (s.x - home.x) * q, y = home.y + (s.y - home.y) * q - Math.sin(q * Math.PI) * 60, w = home.w + (s.w - home.w) * q;
        const bq = back(seg(t, 2.2 + j * 0.25, 2.7 + j * 0.25));
        if (bq > 0 && q >= 1) {
          plate(x, y + 4, w);
          ctx.globalAlpha = clamp01(bq * 3);
          const bh = bun(s.k, x, y - w * 0.12 + (1 - bq) * 40, w, false, j + 1);
          ctx.globalAlpha = 1;
          const mh = meat(x, y - bh, w * 0.98);
          ctx.globalAlpha = clamp01(bq * 3);
          bun(s.k, x, y - bh - mh - (1 - bq) * 120, w, true, j + 1);
          ctx.globalAlpha = 1;
        } else { plate(x, y + 4, w); meat(x, y - w * 0.1, w); }
        ctx.globalAlpha = smooth(seg(t, 2.5 + j * 0.25, 2.8 + j * 0.25));
        text(BREADS[s.k].name, s.x, 410, 16, C.ink);
        text(BREADS[s.k].bread, s.x, 430, 13, C.soft, "center", 600);
        ctx.globalAlpha = 1;
      });
      ctx.globalAlpha = smooth(seg(t, 4.0, 4.5));
      pill("one meat, five sandwiches", 400, 130, 22, C.orange);
      ctx.globalAlpha = 1;
    } },

    // 4. A club: page bread on top, TypeScript meat, the wire, Rust meat, Worker bread below. A toothpick holds it.
    club: { seconds: 7, draw(t) {
      const cx = 330, y = 425, w = 240;
      text("4. Wild idea? Make it a club.", 400, 40, 30);
      plate(cx, y + 4, w);
      const d = (a) => (1 - back(seg(t, a, a + 0.45))) * 300;
      const show = (a) => clamp01(seg(t, a, a + 0.1));
      let at = y;
      ctx.globalAlpha = show(0.3); at -= bun("worker", cx, at - w * 0.12 - d(0.3), w, false, 2); ctx.globalAlpha = 1;
      const rustY = at;
      if (t > 0.7) { ctx.save(); ctx.translate(0, -d(0.7)); at -= meat(cx, at, w * 0.98, undefined, "#8f2d0c"); ctx.restore(); } else at -= meatHeight(w * 0.98);
      const wireY = at;
      ctx.globalAlpha = show(1.3);
      ctx.fillStyle = "#f3dcae"; ctx.strokeStyle = "#c99a55"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(cx - w / 2 + 4, at - 22 - d(1.3), w - 8, 22, 6); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1; at -= 20;
      const tsY = at;
      if (t > 1.8) { ctx.save(); ctx.translate(0, -d(1.8)); at -= meat(cx, at, w * 0.98, undefined, "#5a3a22"); ctx.restore(); } else at -= meatHeight(w * 0.98);
      ctx.globalAlpha = show(2.3); bun("page", cx, at - d(2.3), w, true, 1); ctx.globalAlpha = 1;
      const pick = back(seg(t, 2.9, 3.3));
      if (pick > 0) {
        const py = at - w * 0.3 - (1 - pick) * 120;
        ctx.strokeStyle = "#b08850"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, py); ctx.lineTo(cx, py + 70); ctx.stroke();
        ctx.fillStyle = C.orange; ctx.beginPath(); ctx.moveTo(cx, py); ctx.lineTo(cx + 34, py + 10); ctx.lineTo(cx, py + 20); ctx.fill();
      }
      // Labels on the right, each with a line to its layer.
      const tag = (s, sub, ly, at0, color) => {
        const a = smooth(seg(t, at0, at0 + 0.3)); if (!a) return; ctx.globalAlpha = a;
        ctx.strokeStyle = "#e3d2b6"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + w / 2 + 8, ly); ctx.lineTo(530, ly); ctx.stroke();
        text(s, 540, ly - 9, 19, color, "left"); text(sub, 540, ly + 12, 14, C.soft, "left", 600); ctx.globalAlpha = 1;
      };
      tag("the page", "brioche · Vite", at - 30, 2.5, C.ink);
      tag("TypeScript meat", "the rules, the state, the types", tsY - 40, 2.0, C.ink);
      tag("the wire", "the same types both ways", wireY - 10, 1.5, C.ink);
      tag("Rust meat", "same layers, compiled fast", rustY - 40, 0.9, C.rust);
      tag("a Worker", "pretzel · the edge", y - 18, 0.5, C.ink);
      const ok = smooth(seg(t, 4.0, 4.4));
      if (ok) { ctx.globalAlpha = ok; pill("TS answer = Rust answer", 600, 86, 20, C.orange); ctx.globalAlpha = 1; }
    } },

    // 5. The hard bread: a crusty sourdough that takes some sawing. Cut once, it goes in the bread box for good.
    hard: { seconds: 8, draw(t) {
      text("5. Some bread is hard to cut", 400, 40, 30);
      const lx = 400, ly = 300;
      const cut = t < 3.2;
      // The board.
      if (t < 3.6) {
        ctx.globalAlpha = 1 - smooth(seg(t, 3.2, 3.6));
        ctx.fillStyle = "#d9b07a"; ctx.beginPath(); ctx.roundRect(170, ly + 40, 460, 26, 10); ctx.fill();
        // The loaf, with its knife sawing.
        const a = 1 - smooth(seg(t, 3.2, 3.6)); ctx.globalAlpha = a;
        const g = ctx.createLinearGradient(0, ly - 110, 0, ly + 40); g.addColorStop(0, "#d08c43"); g.addColorStop(1, "#8f5520");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(lx, ly - 10, 200, 52, 0, Math.PI, 0); ctx.lineTo(lx + 200, ly + 40); ctx.lineTo(lx - 200, ly + 40); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#f3d7a8"; ctx.lineWidth = 4;
        for (let i = 0; i < 4; i++) { const sx = lx - 120 + i * 80; ctx.beginPath(); ctx.moveTo(sx - 26, ly - 30); ctx.quadraticCurveTo(sx, ly - 58, sx + 26, ly - 36); ctx.stroke(); }
        pill("the phone", lx - 90, ly + 6, 18, C.ink);
        const saw = Math.sin(t * 14) * 40, depth = smooth(seg(t, 0.4, 3.0)) * 80;
        ctx.save(); ctx.translate(lx + 120 + saw * 0.3, ly - 120 + depth); ctx.rotate(-0.08);
        ctx.fillStyle = "#d7dde3"; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(10, 150); ctx.lineTo(-6, 130); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#9aa4ad"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.roundRect(-12, -70, 24, 72, 8); ctx.fill();
        ctx.restore();
        // Crumbs.
        const r = rand(7);
        for (let i = 0; i < 30; i++) {
          const born = 0.4 + r() * 2.6, vx = (r() - 0.5) * 260, vy = -80 - r() * 160, s = 2 + r() * 4, age = t - born;
          if (age < 0 || age > 1.2) { r(); continue; }
          ctx.fillStyle = r() > 0.5 ? "#c8853e" : "#f3d7a8";
          ctx.beginPath(); ctx.arc(lx + 120 + vx * age, ly - 40 + vy * age + 300 * age * age, s, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (cut) {
          ctx.globalAlpha = smooth(seg(t, 0.6, 1.0));
          text("crusty, crumbly, takes a minute (mobile)", 400, 92, 20, C.soft, "center", 700);
          ctx.globalAlpha = 1;
        }
      }
      if (t >= 3.4) {
        // The bread box with every bread in it, then a sandwich made with the new one.
        const a = smooth(seg(t, 3.4, 3.8)); ctx.globalAlpha = a;
        text("cut it once, keep it in the bread box", 400, 92, 20, C.soft, "center", 700);
        ctx.fillStyle = "#f1e4cf"; ctx.strokeStyle = "#e3d2b6"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(70, 150, 230, 210, 18); ctx.fill(); ctx.stroke();
        text("your bread box", 185, 176, 17, C.ink);
        ORDER.forEach((k, j) => {
          const drop = k === "phone" ? back(seg(t, 3.6, 4.1)) : 1;
          const bx = 125 + (j % 2) * 110, by = 225 + Math.floor(j / 2) * 52 - (1 - drop) * 160;
          if (k === "phone" && drop <= 0) return;
          bun(k, bx, by, 90, true, j + 1);
          text(BREADS[k].bread, bx, by + 12, 12, C.soft, "center", 700);
        });
        ctx.globalAlpha = 1;
        const s = smooth(seg(t, 4.4, 5.0));
        if (s > 0) {
          ctx.globalAlpha = s;
          sandwich(540, 340, 230, "phone", { lift: (1 - back(seg(t, 4.8, 5.4))) * 50, seed: 5 });
          ctx.globalAlpha = smooth(seg(t, 5.5, 5.9));
          pill("now every sandwich can have it", 540, 160, 18, C.orange);
          ctx.globalAlpha = 1;
        }
      }
    } },
  };

  window.SCENES = Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [k, v.seconds]));
  window.drawFrame = (name, t) => {
    const canvas = document.querySelector("canvas");
    ctx = canvas.getContext("2d");
    ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
    clear();
    SCENES[name].draw(t);
    fade(t, SCENES[name].seconds);
    return canvas.toDataURL("image/png");
  };
})();
