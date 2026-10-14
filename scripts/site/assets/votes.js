// The home page's favourite-features vote: a tier list to drag features into, and a stage that steps
// through the last 50 votes at 60 beats a minute as a staircase of columns, tallest first, gliding to
// their new places on each beat. The pure parts are exported (and tested); the page wiring is at the bottom.
export const POINTS = { S: 4, A: 3, B: 2, C: 1 };
export const BPM = 60;
const MAX = 4;

// The columns for one vote on stage, tallest first. `votes` is every vote kept; a column's `avg` is the
// average points it has across them (unranked counts 0), which the stage draws as a marker on each column.
export function columns(features, vote, votes) {
  const avg = (slug) => (votes.length ? votes.reduce((sum, v) => sum + (POINTS[v.tiers[slug]] ?? 0), 0) / votes.length : 0);
  return features
    .map((f, i) => ({ ...f, i, h: POINTS[vote?.tiers[f.slug]] ?? 0, avg: avg(f.slug) }))
    .sort((a, b) => b.h - a.h || b.avg - a.avg || a.i - b.i);
}

// Which vote plays next: the newest unseen one first (so a fresh vote ripples in), else round robin.
export function nextIndex(votes, at, seen) {
  const fresh = votes.findIndex((v) => !seen.has(v.id));
  return fresh >= 0 ? fresh : (at + 1) % Math.max(votes.length, 1);
}

// The ranking a ballot holds, as the API wants it: only ranked features.
export function ballot(zones) {
  const tiers = {};
  for (const [tier, slugs] of Object.entries(zones)) if (tier in POINTS) for (const s of slugs) tiers[s] = tier;
  return tiers;
}

if (typeof document !== "undefined") {
  const root = document.querySelector("section.vote");
  if (root) start(root);
}

function start(root) {
  const features = JSON.parse(root.dataset.features);
  const title = Object.fromEntries(features.map((f) => [f.slug, f.title]));
  const $ = (sel) => root.querySelector(sel);

  // ---- the ballot: S A B C rows and the pool of features not ranked yet
  const tiersEl = $(".tiers");
  const zoneOf = {};
  for (const tier of [...Object.keys(POINTS), "pool"]) {
    const row = document.createElement("div");
    row.className = `tier tier-${tier}`;
    row.innerHTML = tier === "pool" ? `<span class="label">Unranked</span>` : `<span class="label" aria-label="Tier ${tier}">${tier}</span>`;
    const zone = document.createElement("div");
    zone.className = "zone";
    zone.dataset.tier = tier;
    zone.setAttribute("role", "group");
    zone.setAttribute("aria-label", tier === "pool" ? "Unranked features" : `Tier ${tier}`);
    row.append(zone);
    tiersEl.append(row);
    zoneOf[tier] = zone;
  }
  let picked = null;
  const pick = (chip) => {
    picked?.setAttribute("aria-pressed", "false");
    picked = chip && picked !== chip ? chip : null;
    picked?.setAttribute("aria-pressed", "true");
  };
  const move = (chip, tier) => { zoneOf[tier].append(chip); pick(null); chip.focus(); };
  for (const f of features) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = f.title;
    chip.dataset.slug = f.slug;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("keydown", (e) => {
      const tier = { s: "S", a: "A", b: "B", c: "C", u: "pool" }[e.key.toLowerCase()];
      if (tier && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); move(chip, tier); }
    });
    chip.addEventListener("pointerdown", (e) => drag(e, chip));
    zoneOf.pool.append(chip);
  }
  // With a feature picked, a click anywhere on a tier's row puts it there.
  tiersEl.addEventListener("click", (e) => {
    const zone = e.target.closest(".chip") ? null : e.target.closest(".tier")?.querySelector(".zone");
    if (picked && zone) move(picked, zone.dataset.tier);
  });

  // Pointer dragging works for mouse, pen and touch. A press that doesn't move is a click, which picks the chip.
  let dragged = false;
  function drag(down, chip) {
    if (down.button) return;
    const x0 = down.clientX, y0 = down.clientY;
    let ghost = null;
    const over = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest(".zone");
    const onmove = (e) => {
      if (!ghost && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      if (!ghost) { ghost = chip.cloneNode(true); ghost.classList.add("ghost"); document.body.append(ghost); chip.classList.add("lifted"); }
      ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
      for (const z of Object.values(zoneOf)) z.classList.toggle("hot", z === over(e));
    };
    const end = (e) => {
      removeEventListener("pointermove", onmove);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      for (const z of Object.values(zoneOf)) z.classList.remove("hot");
      if (ghost || Math.hypot(e.clientX - x0, e.clientY - y0) >= 5) { ghost?.remove(); chip.classList.remove("lifted"); const z = e.type === "pointerup" && over(e); if (z) move(chip, z.dataset.tier); dragged = true; setTimeout(() => (dragged = false)); }
    };
    addEventListener("pointermove", onmove);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  }
  tiersEl.addEventListener("click", (e) => { const chip = e.target.closest(".chip"); if (chip && !dragged) pick(chip); });

  const form = $("form.ballot");
  const sent = $(".sent");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const zones = Object.fromEntries(Object.entries(zoneOf).map(([t, z]) => [t, [...z.children].map((c) => c.dataset.slug)]));
    const tiers = ballot(zones);
    if (!Object.keys(tiers).length) { sent.textContent = "Drag at least one feature into a tier first."; return; }
    sent.textContent = "Sending...";
    try {
      const res = await fetch("/api/votes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tiers, comment: form.comment.value }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      sent.textContent = "Sent, thank you. It plays next on the stage.";
      form.comment.value = "";
      load(body.votes);
    } catch (err) {
      sent.textContent = `Couldn't send: ${err.message}`;
    }
  });

  // ---- the stage
  const canvas = $("canvas.stage");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let votes = [], beatAt = 0, last = 0;
  const seen = new Set();
  let at = -1;
  let playing = !reduced.matches;
  const cols = new Map(features.map((f, i) => [f.slug, { x: i, h: 0, avg: 0 }]));
  let target = columns(features, null, []);
  const play = $('[data-act="play"]');
  const setPlaying = (on) => { playing = on; play.innerHTML = on ? "&#10074;&#10074;" : "&#9654;"; play.setAttribute("aria-label", on ? "Pause" : "Play"); play.title = on ? "Pause" : "Play"; };
  setPlaying(playing);

  function show(i) {
    at = i;
    const vote = votes[i];
    seen.add(vote?.id);
    target = columns(features, vote, votes);
    target.forEach((c, rank) => { const col = cols.get(c.slug); col.tx = rank; col.th = c.h; col.tavg = c.avg; });
    const order = $(".order");
    order.replaceChildren(...target.filter((c) => c.h).map((c) => { const li = document.createElement("li"); li.textContent = `${Object.keys(POINTS).find((t) => POINTS[t] === c.h)}: ${title[c.slug]}`; return li; }));
    const said = $(".said");
    said.hidden = !vote?.comment;
    said.textContent = vote?.comment ?? "";
    $(".now").textContent = vote ? `Vote ${i + 1} of ${votes.length}, ${new Date(vote.at).toLocaleString()}` : "No votes yet, be the first.";
    const beat = $(".beat");
    beat.classList.remove("pulse"); void beat.offsetWidth; beat.classList.add("pulse");
  }
  function load(list) {
    votes = list;
    if (votes.some((v) => !seen.has(v.id))) beatAt = 0; // a vote nobody has watched yet plays on the next frame
    if (!votes.length) { at = -1; show(-1); }
  }
  async function poll() {
    try { load((await (await fetch("/api/votes")).json()).votes ?? []); } catch {}
  }
  for (const [act, fn] of Object.entries({ prev: () => show((at - 1 + votes.length) % votes.length), next: () => show((at + 1) % votes.length), play: () => setPlaying(!playing) }))
    $(`[data-act="${act}"]`).addEventListener("click", () => { if (votes.length || act === "play") fn(); });
  reduced.addEventListener?.("change", () => setPlaying(!reduced.matches));

  // One beat a second. A new vote jumps the queue (beatAt = 0 means "play now"); the columns glide.
  const css = () => getComputedStyle(root);
  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;
    if (votes.length && playing && now >= beatAt) {
      beatAt = now + 60000 / BPM;
      show(nextIndex(votes, at, seen));
    }
    const k = reduced.matches ? 1 : 1 - Math.exp(-dt * 7);
    for (const col of cols.values()) {
      col.x += ((col.tx ?? col.x) - col.x) * k;
      col.h += ((col.th ?? 0) - col.h) * k;
      col.avg += ((col.tavg ?? 0) - col.avg) * k;
    }
    draw();
    requestAnimationFrame(frame);
  }
  function draw() {
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = Math.round(w * 0.36);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = `${h}px`; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const style = css();
    const accent = style.getPropertyValue("--accent").trim() || "#9a5214";
    const fg = style.getPropertyValue("--fg").trim() || "#2a2118";
    const n = features.length;
    const depth = Math.min(w / n * 0.5, 26), pad = 16;
    const slot = (w - pad * 2 - depth) / n, bw = slot * 0.72, unit = (h - 40 - depth * 0.7) / MAX;
    const base = h - 18;
    ctx.strokeStyle = fg; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(pad, base + 0.5); ctx.lineTo(w - pad, base + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
    // Right to left, so a column on the left is drawn over the side of the one beside it.
    for (const f of [...features].sort((a, b) => cols.get(b.slug).x - cols.get(a.slug).x)) {
      const c = cols.get(f.slug);
      const x = pad + c.x * slot + (slot - bw) / 2, ch = Math.max(c.h, 0.04) * unit, top = base - ch;
      const dx = depth * 0.6, dy = depth * 0.45;
      const shade = (a, fill) => { ctx.globalAlpha = a; ctx.fillStyle = fill; ctx.fill(); };
      ctx.fillStyle = accent;
      // front, right side, top: the same accent with light and shadow laid over it
      ctx.beginPath(); ctx.rect(x, top, bw, ch); shade(0.35 + 0.6 * (c.h / MAX), accent);
      ctx.beginPath(); ctx.moveTo(x + bw, top); ctx.lineTo(x + bw + dx, top - dy); ctx.lineTo(x + bw + dx, base - dy); ctx.lineTo(x + bw, base); ctx.closePath(); shade(0.5, accent); shade(0.35, "#000");
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + dx, top - dy); ctx.lineTo(x + bw + dx, top - dy); ctx.lineTo(x + bw, top); ctx.closePath(); shade(0.6, accent); shade(0.4, "#fff");
      // the last 50 votes' average for this feature, a bar across the front
      const ay = base - c.avg * unit;
      ctx.globalAlpha = 1; ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 2, ay); ctx.lineTo(x + bw + 2, ay); ctx.stroke(); ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
  }

  poll();
  setInterval(() => { if (!document.hidden) poll(); }, 15000);
  requestAnimationFrame(frame);
}
