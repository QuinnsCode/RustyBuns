// The page: one canvas, three cameras (project.ts) over one scene (layout.ts), five modes. Reads /api/fleet every
// two seconds (204 while nothing changed); `?demo` or no server draws the demo fleet. `window.hemyviz` is the probe's
// handle: state(), set({ dim, mode, stack }), pick(fqn), views().
import { createElement, Box, HeartPulse, History, Layers, Maximize, Network, Orbit, Radar, Search, Shapes, Square, X, ExternalLink, type IconNode } from "lucide";
import { readJson } from "@rustybuns/util/http";
import { BUSY, Fleet, kindOf, providerOf } from "./api.ts";
import { DIMS, MODES, STATUS_COLOR, layout, type Block, type Dim, type Mode, type Scene } from "./layout.ts";
import { boxFaces, camFor, fitScale, inside, project, type Cam, type Pt } from "./project.ts";
import { demoFleet } from "./demo.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (node: IconNode) => createElement(node);
const canvas = $<HTMLCanvasElement>("view"), ctx = canvas.getContext("2d")!;

const DIM_INFO: Record<Dim, { icon: IconNode; label: string }> = { "2d": { icon: Square, label: "2D" }, "2.5d": { icon: Layers, label: "2.5D" }, "3d": { icon: Box, label: "3D" } };
const MODE_INFO: Record<Mode, { icon: IconNode; label: string; tip: string }> = {
  map: { icon: Network, label: "Map", tip: "Each stack an island, columns by what depends on what" },
  health: { icon: HeartPulse, label: "Health", tip: "By status: anything in flight pulses" },
  age: { icon: History, label: "Age", tip: "A lane per stack, oldest change left, newest right and tallest" },
  kinds: { icon: Shapes, label: "Kinds", tip: "Grouped by resource type" },
  blast: { icon: Radar, label: "Blast", tip: "Height is how much depends on it; what a destroy keeps stands apart" },
};

const q = new URLSearchParams(location.search);
const pickOf = <T extends string>(list: readonly T[], v: string | null, d: T): T => (list as readonly string[]).includes(v ?? "") ? (v as T) : d;
const st = {
  dim: pickOf(DIMS, q.get("dim"), "2.5d"),
  mode: pickOf(MODES, q.get("mode"), "map"),
  stack: q.get("stack") ?? "",
  find: "",
  demo: q.has("demo"),
  orbit: true,
  fleet: { version: "", at: 0, stacks: [] } as Fleet,
  scene: null as Scene | null,
  cams: {} as Partial<Record<Dim, Cam>>,
  scale: 1,
  hover: null as Block | null,
  selected: null as string | null,
  hits: [] as { b: Block; polys: Pt[][] }[],
  dirty: true,
};

// ---- controls ----

function segButtons<T extends string>(el: HTMLElement, list: readonly T[], info: Record<T, { icon: IconNode; label: string; tip?: string }>, on: (v: T) => void) {
  el.replaceChildren(...list.map((v) => {
    const b = document.createElement("button");
    b.dataset.v = v;
    b.title = info[v].tip ?? info[v].label;
    b.append(icon(info[v].icon), Object.assign(document.createElement("span"), { textContent: info[v].label }));
    b.onclick = () => on(v);
    return b;
  }));
}
segButtons($("dims"), DIMS, DIM_INFO, (d) => set({ dim: d }));
segButtons($("modes"), MODES, MODE_INFO, (m) => set({ mode: m }));
$("search-icon").replaceWith(icon(Search));
$("orbit").append(icon(Orbit));
$("fit").append(icon(Maximize));
$("orbit").onclick = () => { st.orbit = !st.orbit; sync(); };
$("fit").onclick = () => { delete st.cams[st.dim]; rebuild(); };
$<HTMLSelectElement>("stack").onchange = (e) => set({ stack: (e.target as HTMLSelectElement).value });
$<HTMLInputElement>("find").oninput = (e) => { st.find = (e.target as HTMLInputElement).value.trim().toLowerCase(); st.dirty = true; };

function set(o: { dim?: Dim; mode?: Mode; stack?: string }) {
  if (o.dim && o.dim !== st.dim) st.dim = o.dim;
  if (o.mode && o.mode !== st.mode) { st.mode = o.mode; st.cams = {}; }
  if (o.stack !== undefined && o.stack !== st.stack) { st.stack = o.stack; st.cams = {}; }
  rebuild();
}

function sync() {
  for (const b of $("dims").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === st.dim));
  for (const b of $("modes").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === st.mode));
  $("orbit").hidden = st.dim !== "3d";
  $("orbit").setAttribute("aria-pressed", String(st.orbit));
  const u = new URLSearchParams();
  if (st.dim !== "2.5d") u.set("dim", st.dim);
  if (st.mode !== "map") u.set("mode", st.mode);
  if (st.stack) u.set("stack", st.stack);
  if (st.demo) u.set("demo", "");
  history.replaceState(null, "", `${location.pathname}${u.size ? `?${u.toString().replace(/=(&|$)/g, "$1")}` : ""}`);
  st.dirty = true;
}

/** The stack ids the filter picks: a stack name picks all its stages, a `stack/stage` id just that one. */
const chosen = () => !st.stack ? [] : st.fleet.stacks.filter((s) => s.id === st.stack || s.stack === st.stack).map((s) => s.id);

function rebuild() {
  st.scene = layout(st.fleet, st.mode, chosen());
  const sel = $<HTMLSelectElement>("stack");
  const names = [...new Set(st.fleet.stacks.map((s) => s.stack))];
  const opts: [string, string][] = [["", `All stacks (${st.fleet.stacks.length})`]];
  for (const n of names) {
    const stages = st.fleet.stacks.filter((s) => s.stack === n);
    opts.push([n, stages.length > 1 ? `${n} (${stages.length} stages)` : stages[0]!.id]);
    if (stages.length > 1) for (const s of stages) opts.push([s.id, `  ${s.id}`]);
  }
  sel.replaceChildren(...opts.map(([v, t]) => Object.assign(document.createElement("option"), { value: v, textContent: t, selected: v === st.stack })));
  if (st.selected && !st.scene.blocks.some((b) => b.id === st.selected)) st.selected = null;
  stats();
  legend();
  panel();
  const empty = $("empty");
  empty.hidden = st.fleet.stacks.length > 0;
  if (!empty.hidden) empty.innerHTML = `<div><p><b>No Alchemy state found.</b></p><p>Deploy something, or point hemyviz at a state dir:<br><code>bun run hemyviz --state path/to/.alchemy/state</code></p><p><a href="?demo">Show the demo fleet</a></p></div>`;
  sync();
}

function stats() {
  const all = st.scene?.blocks ?? [];
  const busy = all.filter((b) => BUSY.has(b.r.status)).length, kept = all.filter((b) => b.r.kept).length;
  const stages = new Set(all.map((b) => `${b.stack}/${b.stage}`)).size;
  const chips = [`<b>${stages}</b> stack stages`, `<b>${all.length}</b> resources`, `<b>${kept}</b> kept`];
  if (busy) chips.push(`<b style="color:${STATUS_COLOR.updating}">${busy}</b> in flight`);
  if (st.demo) chips.push("demo fleet");
  $("stats").innerHTML = chips.map((c) => `<span>${c}</span>`).join("");
}
function legend() {
  $("legend").innerHTML = (st.scene?.legend ?? []).map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

function panel() {
  const el = $("panel"), b = st.scene?.blocks.find((x) => x.id === st.selected);
  el.hidden = !b;
  if (!b) return;
  const r = b.r, stackId = b.id.split("::")[0]!;
  const ups = st.scene!.blocks.filter((x) => x.id.startsWith(`${stackId}::`) && x.r.downstream.includes(r.fqn));
  const downs = r.downstream.map((d) => `${stackId}::${d}`);
  const row = (k: string, v: string) => `<dt>${k}</dt><dd>${v}</dd>`;
  el.innerHTML = `
    <button class="icon close" aria-label="Close"></button>
    <h2>${esc(r.fqn)}</h2>
    <div class="type">${esc(kindOf(r.type))} · ${esc(providerOf(r.type))}</div>
    <dl>
      ${row("Status", `<span class="pill"><i style="background:${STATUS_COLOR[r.status]}"></i>${r.status}</span>`)}
      ${row("Stack", esc(b.stack))}${row("Stage", esc(b.stage))}
      ${r.name ? row("Name", esc(r.name)) : ""}
      ${r.url ? row("URL", `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url.replace(/^https?:\/\//, ""))}<span class="ext"></span></a>`) : ""}
      ${row("Changed", `${new Date(r.updatedAt).toLocaleString()} (${ago(r.updatedAt)})`)}
      ${row("On destroy", r.kept ? "kept" : "removed")}
      ${row("Mode", r.mode)}
      ${row("Depends on it", `${b.reach} (all the way down)`)}
      ${row("Props / bindings", `${r.props} / ${r.bindings}`)}
    </dl>
    ${ups.length ? `<h3>Feeds it</h3><ul>${ups.map((u) => `<li><button data-id="${esc(u.id)}">${esc(u.label)}</button></li>`).join("")}</ul>` : ""}
    ${downs.length ? `<h3>It feeds</h3><ul>${downs.map((d) => `<li><button data-id="${esc(d)}">${esc(d.split("::")[1]!.split("/").pop()!)}</button></li>`).join("")}</ul>` : ""}`;
  el.querySelector(".close")!.append(icon(X));
  el.querySelector(".ext")?.append(icon(ExternalLink));
  (el.querySelector(".close") as HTMLButtonElement).onclick = () => { st.selected = null; panel(); st.dirty = true; };
  for (const btn of el.querySelectorAll<HTMLButtonElement>("li button")) btn.onclick = () => { st.selected = btn.dataset.id!; panel(); st.dirty = true; };
}

// ---- drawing ----

let colors: Record<string, string> = {};
const readColors = () => { const cs = getComputedStyle(document.documentElement); colors = Object.fromEntries(["--bg", "--ground", "--zone", "--zone-line", "--ink", "--muted", "--link", "--hot"].map((k) => [k, cs.getPropertyValue(k).trim()])); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); st.dirty = true; });

function shade(hex: string, k: number): string {
  const m = hex.match(/^#(..)(..)(..)$/), rgb = m ? m.slice(1).map((h) => parseInt(h, 16)) : (hex.match(/\d+/g) ?? ["128", "128", "128"]).map(Number);
  return `rgb(${rgb.map((v) => Math.round(Math.min(255, v * k))).join(",")})`;
}

function cam(): Cam {
  const s = st.scene!;
  let c = st.cams[st.dim];
  if (!c) {
    c = camFor(st.dim, s.w / 2, s.d / 2, Math.max(s.w, s.d));
    st.cams[st.dim] = c;
    const tall = st.dim === "2d" ? 0 : Math.max(1, ...s.blocks.map((b) => b.h));
    // Leave the stats row above and the legend below clear.
    st.scale = fitScale(c, canvas.clientWidth, Math.max(120, canvas.clientHeight - 110), s.w, s.d, tall);
  }
  return c;
}

const poly = (pts: Pt[]) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

function draw(t: number) {
  const s = st.scene;
  const W = canvas.clientWidth, H = canvas.clientHeight, dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors["--bg"]!;
  ctx.fillRect(0, 0, W, H);
  st.hits = [];
  if (!s || !s.blocks.length) return;
  const c = cam(), flat = st.dim === "2d", P = (x: number, y: number, z: number) => project(c, W, H, st.scale, x, y, z);
  const px = st.scale * c.zoom;

  // Ground plates per zone, with their names.
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  for (const z of s.zones) {
    const pts = [P(z.x, 0, z.z), P(z.x + z.w, 0, z.z), P(z.x + z.w, 0, z.z + z.d), P(z.x, 0, z.z + z.d)];
    if (pts.some((p) => !p)) continue;
    poly(pts.map((p) => p!.p));
    ctx.fillStyle = colors["--zone"]!;
    ctx.fill();
    ctx.strokeStyle = colors["--zone-line"]!;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const focus = st.hover?.id ?? st.selected;
  const match = (b: Block) => !st.find || b.r.fqn.toLowerCase().includes(st.find) || b.r.type.toLowerCase().includes(st.find) || (b.r.name ?? "").toLowerCase().includes(st.find);
  const byId = new Map(s.blocks.map((b) => [b.id, b]));
  const height = (b: Block) => (flat ? 0.02 : b.h);

  // Links: what feeds what. Lifted into an arc off the ground in 2.5D and 3D.
  const links = () => {
    for (const l of s.links) {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) continue;
      const on = focus && (l.from === focus || l.to === focus);
      if (s.mode !== "map" && !on) continue;
      const ax = a.x + a.w / 2, az = a.z + a.d / 2, bx = b.x + b.w / 2, bz = b.z + b.d / 2;
      const lift = flat ? 0 : Math.max(height(a), height(b)) + 0.8 + Math.hypot(bx - ax, bz - az) * 0.15;
      const p0 = P(ax, height(a), az), p1 = P(bx, height(b), bz), pm = P((ax + bx) / 2, lift, (az + bz) / 2);
      if (!p0 || !p1 || !pm) continue;
      ctx.strokeStyle = on ? colors["--hot"]! : colors["--link"]!;
      ctx.lineWidth = on ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(...p0.p);
      if (flat) ctx.lineTo(...p1.p); else ctx.quadraticCurveTo(2 * pm.p[0] - (p0.p[0] + p1.p[0]) / 2, 2 * pm.p[1] - (p0.p[1] + p1.p[1]) / 2, ...p1.p);
      ctx.stroke();
      if (flat) { // arrowhead at the dependent
        const ang = Math.atan2(p1.p[1] - p0.p[1], p1.p[0] - p0.p[0]), r = Math.min(px * 0.5, 14), tip: Pt = [p1.p[0] - Math.cos(ang) * px * 0.5, p1.p[1] - Math.sin(ang) * px * 0.5];
        ctx.beginPath();
        ctx.moveTo(...tip);
        ctx.lineTo(tip[0] - Math.cos(ang - 0.45) * r * 0.6, tip[1] - Math.sin(ang - 0.45) * r * 0.6);
        ctx.lineTo(tip[0] - Math.cos(ang + 0.45) * r * 0.6, tip[1] - Math.sin(ang + 0.45) * r * 0.6);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }
  };
  if (flat) links();

  // Blocks, far to near.
  const order = s.blocks.map((b) => ({ b, d: P(b.x + b.w / 2, height(b) / 2, b.z + b.d / 2)?.depth ?? -Infinity })).sort((a, b) => a.d - b.d);
  const pulse = 0.5 + 0.5 * Math.sin(t / 260);
  for (const { b } of order) {
    const faces = boxFaces(c, W, H, st.scale, { x: b.x, z: b.z, w: b.w, d: b.d, h: height(b) });
    const dim = !match(b);
    ctx.globalAlpha = dim ? 0.18 : 1;
    for (const f of faces) {
      poly(f.pts);
      ctx.fillStyle = shade(b.color, f.shade);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    const outline = b.id === focus || (b.pulse && !dim);
    if (outline) {
      ctx.strokeStyle = b.id === focus ? colors["--ink"]! : `rgba(79,142,247,${0.35 + 0.65 * pulse})`;
      ctx.lineWidth = b.id === focus ? 2.2 : 2 + 2 * pulse;
      for (const f of faces) { poly(f.pts); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    st.hits.push({ b, polys: faces.map((f) => f.pts) });
  }
  if (!flat) links();

  // Labels: inside each tile in 2D when there's room, above the hovered and picked ones otherwise.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { b } of order) {
    const big = flat ? px > 46 : px > 70;
    if (!big && b.id !== focus && !(st.find && match(b))) continue;
    const top = P(b.x + b.w / 2, height(b), b.z + b.d / 2);
    if (!top) continue;
    const y = flat ? top.p[1] : top.p[1] - 12;
    const text = b.label.length > 18 && flat ? `${b.label.slice(0, 16)}…` : b.label;
    ctx.font = `${b.id === focus ? 700 : 500} ${flat ? Math.min(12, px * 0.22) : 12}px ui-sans-serif, system-ui, sans-serif`;
    if (!flat) {
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = colors["--bg"]!;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(top.p[0] - w / 2, y - 9, w, 18);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = flat ? "#fff" : colors["--ink"]!;
    ctx.fillText(text, top.p[0], y);
  }
  ctx.textAlign = "start";

  // Zone names last, on a chip, so no block hides them.
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (const z of s.zones) {
    const at = flat ? P(z.x, 0, z.z) : P(z.x, 0, z.z + z.d);
    if (!at) continue;
    const w = ctx.measureText(z.label).width + 12, x = at.p[0] + (flat ? 0 : -w / 2), y = at.p[1] + (flat ? -12 : 14);
    ctx.fillStyle = colors["--bg"]!;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(x, y - 9, w, 18, 9);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors["--muted"]!;
    ctx.fillText(z.label, x + 6, y);
  }
}

function hitAt(x: number, y: number): Block | null {
  for (let i = st.hits.length - 1; i >= 0; i--) if (st.hits[i]!.polys.some((p) => inside([x, y], p))) return st.hits[i]!.b;
  return null;
}

// ---- pointer: drag pans (turns in 3D, shift pans), wheel and pinch zoom, click picks ----

const pointers = new Map<number, Pt>();
let dragged = 0, pinch = 0;
canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.offsetX, e.offsetY]); dragged = 0; canvas.classList.add("dragging"); });
canvas.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    const b = hitAt(e.offsetX, e.offsetY);
    if (b !== st.hover) { st.hover = b; st.dirty = true; }
    tip(b, e.offsetX, e.offsetY);
    return;
  }
  const c = st.cams[st.dim];
  if (!c) return;
  const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  dragged += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a![0] - b![0], a![1] - b![1]);
    if (pinch) c.zoom = Math.max(0.2, Math.min(8, c.zoom * (d / pinch)));
    pinch = d;
  } else if (st.dim === "3d" && !e.shiftKey) {
    c.yaw -= dx * 0.008;
    c.pitch = Math.max(0.12, Math.min(1.45, c.pitch + dy * 0.006));
  } else { c.panX += dx; c.panY += dy; }
  st.dirty = true;
});
const up = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  canvas.classList.remove("dragging");
  if (e.type === "pointerup" && dragged < 5) { const b = hitAt(e.offsetX, e.offsetY); st.selected = b?.id ?? null; panel(); st.dirty = true; }
};
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);
canvas.addEventListener("pointerleave", () => { if (st.hover) { st.hover = null; st.dirty = true; } tip(null, 0, 0); });
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const c = st.cams[st.dim];
  if (!c) return;
  const k = Math.exp(-e.deltaY * 0.0015), W = canvas.clientWidth, H = canvas.clientHeight;
  const nz = Math.max(0.2, Math.min(8, c.zoom * k)), r = nz / c.zoom;
  // Zoom about the pointer.
  c.panX = e.offsetX - W / 2 - (e.offsetX - W / 2 - c.panX) * r;
  c.panY = e.offsetY - H / 2 - (e.offsetY - H / 2 - c.panY) * r;
  c.zoom = nz;
  st.dirty = true;
}, { passive: false });

function tip(b: Block | null, x: number, y: number) {
  const el = $("tip");
  el.hidden = !b;
  if (!b) return;
  el.innerHTML = `<b>${esc(b.label)}</b>${esc(kindOf(b.r.type))} · ${b.r.status}<br><small>${esc(b.stack)} · ${esc(b.stage)} · ${ago(b.r.updatedAt)}</small>`;
  const W = canvas.clientWidth;
  el.style.left = `${Math.min(x + 14, W - 270)}px`;
  el.style.top = `${y + 14}px`;
}

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= MODES.length) set({ mode: MODES[n - 1]! });
  else if (e.key === "d") set({ dim: DIMS[(DIMS.indexOf(st.dim) + 1) % DIMS.length]! });
  else if (e.key === "Escape") { st.selected = null; panel(); st.dirty = true; }
});
window.addEventListener("resize", () => { st.cams = {}; st.dirty = true; });

let last = 0;
function frame(t: number) {
  const anim = (st.dim === "3d" && st.orbit && !pointers.size) || st.scene?.blocks.some((b) => b.pulse);
  if (st.dim === "3d" && st.orbit && !pointers.size && st.cams["3d"]) st.cams["3d"].yaw += (t - last) * 0.00006;
  last = t;
  if (st.dirty || anim) { draw(t); st.dirty = false; }
  requestAnimationFrame(frame);
}

// ---- data ----

async function poll() {
  if (st.demo) return;
  const r = await fetch(`/api/fleet?since=${encodeURIComponent(st.fleet.version)}`).catch(() => null);
  if (r?.status === 204) return;
  const f = r?.ok ? await readJson(r, Fleet).catch(() => null) : null;
  if (!f) { if (!st.fleet.version) { st.demo = true; st.fleet = demoFleet(); rebuild(); } return; }
  const first = !st.fleet.version;
  st.fleet = f;
  if (first) st.cams = {};
  rebuild();
}

declare global { interface Window { hemyviz: unknown } }
window.hemyviz = {
  /** What is on screen. */
  state: () => ({
    dim: st.dim, mode: st.mode, stack: st.stack || null, demo: st.demo, version: st.fleet.version,
    stacks: st.fleet.stacks.length, resources: st.fleet.stacks.reduce((n, s) => n + s.resources.length, 0),
    blocks: st.scene?.blocks.length ?? 0, zones: st.scene?.zones.map((z) => z.label) ?? [], links: st.scene?.links.length ?? 0,
    drawn: st.hits.length, inFlight: st.scene?.blocks.filter((b) => b.pulse).map((b) => b.id) ?? [], selected: st.selected,
  }),
  set: (o: { dim?: Dim; mode?: Mode; stack?: string }) => { set(o); draw(performance.now()); return (window.hemyviz as { state(): unknown }).state(); },
  /** Select the first resource whose FQN (or `stack/stage::fqn` id) is `name`; its details open in the panel. */
  pick: (name: string) => { const b = st.scene?.blocks.find((x) => x.id === name || x.r.fqn === name); st.selected = b?.id ?? null; panel(); st.dirty = true; return b ? { id: b.id, reach: b.reach, status: b.r.status } : null; },
  /** All fifteen views, as the links that open them. */
  views: () => DIMS.flatMap((d) => MODES.map((m) => `?dim=${d}&mode=${m}${st.demo ? "&demo" : ""}`)),
} satisfies Record<string, unknown>;

readColors();
if (st.demo) st.fleet = demoFleet();
rebuild();
requestAnimationFrame(frame);
await poll();
setInterval(poll, 2000);
