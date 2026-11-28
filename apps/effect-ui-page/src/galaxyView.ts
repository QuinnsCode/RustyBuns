// Agent Galaxy in the page: the map of everyone's worlds, drawn by us on a plain 2D canvas (no libraries, so the
// bundle stays small) and seen from above at an angle. You are a small character; WASD, the arrow keys or the touch
// stick walk you, and walking off an edge takes you onto the plot next door from the opposite edge.
// - ONE live sealed frame at a time, laid on the plot you stand on: your own world, the common city, or a neighbour's
//   world as its room last saved it (GET /api/galaxy/world/<id>, checked with the Page Schema; read-only to you, no
//   tool or undo reaches it). Every other plot shows its picture (GET /api/galaxy/picture/<id>), or the desert when
//   it has none; an empty plot is desert with a sign. A world's code never draws the player: we do, over the frame,
//   and tell the frame where you are (`{ agent_page: true, player: { x, z } }`, null when you leave it).
// - The page saves its world to the server after each change that lands (PUT /api/r/<room>/world), so whoever walks
//   onto your plot runs it.
// ProfilePage's Model says whether the galaxy is up (its button, Cmd+K and window.agentGalaxy all send the same
// message); this layer comes up when the page shows `[data-galaxy="on"]` and goes when it doesn't.
import { check } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { Effect, Option, Queue, Schema } from "effect";
import { currentPage, watchPage } from "./agent.ts";
import { COMMON_CITY } from "./commonCity.ts";
import { Claimed, FromGalaxy, type Plot, Plots, type ToGalaxy, VIEW_MAX, type Walker } from "./galaxy.ts";
import { listing, Page } from "./page.ts";
import { worldDoc } from "./world.ts";

/** Asks for the galaxy (true) or the way back (false), from Cmd+K and window.agentGalaxy: ProfilePage listens. */
export const galaxyAsks = Effect.runSync(Queue.unbounded<boolean>());

/** A cell is a plot and the ground beside it; K squashes north-south for the view from above at an angle. */
const PITCH = 1.16, K = 0.6;
/** Plots a second, walking; how often a position goes out; the size a world's frame is drawn at, then scaled. */
const SPEED = 0.45, SEND_MS = 100, FRAME_PX = 640;

type Live = { kind: "mine" | "city" | "neighbour" | "picture" | "empty"; id: string | null; files: { path: string; bytes: number }[] };
interface G {
  layer: HTMLDivElement; ground: HTMLCanvasElement; chars: HTMLCanvasElement; frame: HTMLIFrameElement; where: HTMLParagraphElement;
  me: Claimed | null; error: string | null; ready: Promise<void>;
  plot: { x: number; y: number }; pos: { x: number; z: number }; cam: { x: number; z: number } | null;
  plots: Map<string, Plot>; players: Map<string, Walker>; live: Live;
  link: Link<ToGalaxy> | null; keys: Set<string>; stick: { x: number; z: number };
  raf: number; sentAt: number; sent: string; toldAt: number; told: string; token: number; moving: Promise<void>; frameAt: string;
  off: (() => void)[];
}

const key = (x: number, y: number) => `${x},${y}`;
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
const decodePage = Schema.decodeUnknownOption(Page);

// ---------- saving the world for the neighbours ----------

const saveWorld = (room: string, page: Page | null) => page
  ? fetch(`/api/r/${room}/world`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(page) }).then((r) => r.ok, () => false)
  : Promise.resolve(false);

/** Send the world after each change that lands, a second after the last one (an agent writes files in a row). */
function keepSaved(room: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watchPage((p) => {
    clearTimeout(timer);
    timer = setTimeout(() => void saveWorld(room, p).then((ok) => { if (!ok) timer = setTimeout(() => void saveWorld(room, currentPage()), 4000); }), 1000);
  });
}

// ---------- pictures ----------

/** Each plot's latest picture, by its id: an image once loaded, null while loading or when it has none (404). */
const pictures = new Map<string, HTMLImageElement | null>();
const picture = (id: string) => {
  if (!pictures.has(id)) {
    pictures.set(id, null);
    const img = new Image();
    img.onload = () => pictures.set(id, img);
    img.src = `/api/galaxy/picture/${id}`;
  }
  return pictures.get(id) ?? null;
};

// ---------- drawing ----------

const hash = (x: number, y: number, i = 0) => { let h = (x * 374761393 + y * 668265263 + i * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function desert(g: CanvasRenderingContext2D, p: Plot, x0: number, y0: number, w: number, h: number) {
  const sand = g.createLinearGradient(x0, y0, x0, y0 + h);
  sand.addColorStop(0, "#e2b97c"); sand.addColorStop(1, "#c8955a");
  g.fillStyle = sand; g.fillRect(x0, y0, w, h);
  g.strokeStyle = "rgba(120, 72, 30, .28)"; g.lineWidth = Math.max(1, w * 0.006);
  for (let i = 0; i < 4; i++) {
    const yy = y0 + h * (0.2 + 0.2 * i + 0.05 * hash(p.x, p.y, i));
    g.beginPath(); g.moveTo(x0 + w * 0.06, yy);
    g.quadraticCurveTo(x0 + w * 0.5, yy - h * 0.08, x0 + w * 0.94, yy + h * 0.02); g.stroke();
  }
  // A cactus or two, standing up: the 2.5D view keeps upright things upright.
  for (let i = 0; i < 2; i++) {
    const cx = x0 + w * (0.15 + 0.7 * hash(p.x, p.y, 10 + i)), cy = y0 + h * (0.3 + 0.6 * hash(p.x, p.y, 20 + i)), s = w * 0.03;
    g.fillStyle = "#3f7a3a";
    g.fillRect(cx - s / 2, cy - s * 3, s, s * 3);
    g.fillRect(cx - s * 1.4, cy - s * 2.2, s * 0.8, s * 1.2); g.fillRect(cx + s * 0.6, cy - s * 2.6, s * 0.8, s * 1.4);
  }
}

function sign(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
  const cx = x0 + w / 2, base = y0 + h * 0.7, pw = w * 0.46, ph = w * 0.13;
  g.fillStyle = "#6b4426"; g.fillRect(cx - w * 0.012, base - ph * 1.4, w * 0.024, ph * 1.4);
  g.fillStyle = "#8a5a33"; g.fillRect(cx - pw / 2, base - ph * 1.9, pw, ph);
  g.strokeStyle = "#4b2e18"; g.lineWidth = Math.max(1, w * 0.008); g.strokeRect(cx - pw / 2, base - ph * 1.9, pw, ph);
  const fs = Math.max(7, w * 0.038);
  g.fillStyle = "#fff4e0"; g.font = `600 ${fs}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("Invite someone", cx, base - ph * 1.9 + ph * 0.32, pw * 0.92);
  g.fillText("to build here", cx, base - ph * 1.9 + ph * 0.72, pw * 0.92);
}

function cityTile(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
  g.fillStyle = "#0d1030"; g.fillRect(x0, y0, w, h);
  const n = 7;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const lit = hash(i, j, 3) > 0.45;
    g.fillStyle = lit ? ["#21e6ff", "#ff3d8b", "#ffb547"][Math.floor(hash(i, j, 4) * 3)]! : "#1b1f4a";
    g.fillRect(x0 + w * (0.08 + i * 0.12), y0 + h * (0.08 + j * 0.12), w * 0.07, h * 0.07);
  }
}

function character(g: CanvasRenderingContext2D, sx: number, sy: number, r: number, color: string, me: boolean) {
  g.fillStyle = "rgba(0, 0, 0, .35)";
  g.beginPath(); g.ellipse(sx, sy, r * 1.3, r * 0.55, 0, 0, 7); g.fill();
  g.fillStyle = color; g.strokeStyle = me ? "#fff" : "rgba(0, 0, 0, .55)"; g.lineWidth = Math.max(1.5, r * 0.3);
  g.beginPath(); g.roundRect(sx - r * 0.85, sy - r * 3, r * 1.7, r * 2.8, r * 0.8); g.fill(); g.stroke();
  g.beginPath(); g.arc(sx, sy - r * 3.6, r * 0.95, 0, 7); g.fill(); g.stroke();
  if (me) { g.fillStyle = "#fff"; g.beginPath(); g.moveTo(sx, sy - r * 5.1); g.lineTo(sx - r * 0.6, sy - r * 5.9); g.lineTo(sx + r * 0.6, sy - r * 5.9); g.fill(); }
}

function layout(g: G) {
  const W = innerWidth, H = innerHeight, span = 3 * PITCH + 0.3;
  const S = Math.min(W / span, (H - 56) / (span * K));
  const cam = g.cam ?? { x: 0, z: 0 };
  return { W, H, S, at: (wx: number, wz: number): [number, number] => [W / 2 + (wx - cam.x) * S, H / 2 + 14 + (wz - cam.z) * S * K] };
}

function fit(c: HTMLCanvasElement, W: number, H: number) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function draw(g: G) {
  const { W, H, S, at } = layout(g);
  const ctx = fit(g.ground, W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1a1830"); sky.addColorStop(1, "#24203d");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // The ground between plots: a dotted path down the middle of each gap.
  ctx.fillStyle = "rgba(255, 255, 255, .10)";
  const r0 = Math.max(1.5, S * 0.008), step = S * 0.06;
  for (const p of g.plots.values()) {
    const [x0, y0] = at(p.x * PITCH, p.y * PITCH), gx = x0 + S + ((PITCH - 1) * S) / 2, gy = y0 + S * K + ((PITCH - 1) * S * K) / 2;
    for (let d = 0; d < S * PITCH; d += step) { ctx.fillRect(gx - r0 / 2, y0 + d * K, r0, r0); ctx.fillRect(x0 + d, gy - r0 / 2, r0, r0); }
  }
  const live = g.frame.hidden ? null : key(g.plot.x, g.plot.y);
  const labels: [number, number, string, string][] = [];
  for (const p of [...g.plots.values()].sort((a, b) => a.y - b.y)) {
    const [x0, y0] = at(p.x * PITCH, p.y * PITCH), w = S, h = S * K;
    if (x0 > W || y0 > H || x0 + w < 0 || y0 + h + S * 0.08 < 0) continue;
    ctx.fillStyle = "#2a2140"; ctx.fillRect(x0, y0 + h, w, S * 0.06); // the plot's edge, seen from the front
    const img = p.id && !p.city ? picture(p.id) : null;
    if (key(p.x, p.y) === live) { ctx.fillStyle = "#05060f"; ctx.fillRect(x0, y0, w, h); }
    else if (img) ctx.drawImage(img, x0, y0, w, h);
    else if (p.city) cityTile(ctx, x0, y0, w, h);
    else { desert(ctx, p, x0, y0, w, h); if (p.empty) sign(ctx, x0, y0, w, h); }
    const mine = g.me !== null && p.id === g.me.id;
    ctx.strokeStyle = mine ? "#21e6ff" : "rgba(255, 255, 255, .16)"; ctx.lineWidth = mine ? 2 : 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    if (mine) labels.push([x0, y0, "Your world", "#21e6ff"]);
    else if (p.city) labels.push([x0, y0, "The city", "#ffb547"]);
  }
  // The live frame sits on the plot you stand on, drawn at FRAME_PX and scaled down onto it.
  const [fx, fy] = at(g.plot.x * PITCH, g.plot.y * PITCH);
  const t = `translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) scale(${(S / FRAME_PX).toFixed(4)}, ${((S * K) / FRAME_PX).toFixed(4)})`;
  if (t !== g.frameAt) { g.frame.style.transform = t; g.frameAt = t; }
  const c = fit(g.chars, W, H);
  c.clearRect(0, 0, W, H);
  const r = Math.max(4, S * 0.03);
  const walkers = [...visible(g).map((p) => ({ ...p, me: false })), ...(g.me ? [{ id: g.me.id, color: "#ffffff", x: g.plot.x, y: g.plot.y, px: g.pos.x, pz: g.pos.z, me: true }] : [])]
    .sort((a, b) => a.y * PITCH + a.pz - (b.y * PITCH + b.pz));
  for (const w of walkers) { const [sx, sy] = at(w.x * PITCH + w.px, w.y * PITCH + w.pz); character(c, sx, sy, r, w.me ? "#ff3d8b" : w.color, w.me); }
  // Plot names over everything, the live frame included: a small tag in the plot's corner.
  const fs = Math.max(10, Math.min(14, S * 0.04));
  c.font = `600 ${fs}px system-ui, sans-serif`; c.textAlign = "left"; c.textBaseline = "middle";
  for (const [x0, y0, text, color] of labels) {
    const tw = c.measureText(text).width;
    c.fillStyle = "rgba(8, 8, 24, .8)"; c.beginPath(); c.roundRect(x0 + 6, y0 + 6, tw + fs, fs * 1.7, fs * 0.85); c.fill();
    c.fillStyle = color; c.fillText(text, x0 + 6 + fs / 2, y0 + 6 + fs * 0.85);
  }
}

const visible = (g: G) => [...g.players.values()].filter((p) => p.id !== g.me?.id && near(p, g.plot));

// ---------- walking ----------

function setFrame(g: G, doc: string | null, own: boolean) {
  tell(g, null);
  g.frame.className = own ? "galaxy-frame world" : "galaxy-frame";
  g.frame.hidden = doc === null;
  g.frame.srcdoc = doc ?? "";
  g.told = "";
}

/** Tell the live frame where the player is on its plot, or that nobody walks there (null). */
function tell(g: G, at: { x: number; z: number } | null) {
  if (g.frame.hidden) return;
  try { g.frame.contentWindow?.postMessage({ agent_page: true, player: at }, "*"); } catch { /* the frame is loading */ }
}

const WHERE: Record<Live["kind"], string> = {
  mine: "Your world, running live", city: "The city: everyone's, nobody's",
  neighbour: "A neighbour's world, running live (look, don't touch)", picture: "A neighbour's world: its last picture", empty: "An empty plot",
};

/** You stepped onto (or came into) a plot: what's around, and what runs in the one live frame. */
async function onPlot(g: G) {
  const t = ++g.token;
  const { x, y } = g.plot;
  const around = await getJson(`/api/galaxy/plots?x=${x}&y=${y}&r=${VIEW_MAX}`, Plots);
  if (t !== g.token) return;
  if (around) g.plots = new Map(around.plots.map((p) => [key(p.x, p.y), p]));
  const here = g.plots.get(key(x, y));
  const own = currentPage();
  if (g.me && x === g.me.x && y === g.me.y && own) {
    setFrame(g, worldDoc(own), true);
    g.live = { kind: "mine", id: g.me.id, files: listing(own) };
  } else if (here?.city) {
    setFrame(g, worldDoc(COMMON_CITY), false);
    g.live = { kind: "city", id: "city", files: listing(COMMON_CITY) };
  } else if (here?.id) {
    const id = here.id;
    const r = await fetch(`/api/galaxy/world/${id}`).then((r) => (r.ok ? r.json() : null), () => null);
    if (t !== g.token) return;
    const page = Option.getOrNull(decodePage(r));
    setFrame(g, page ? worldDoc(page) : null, false);
    g.live = page ? { kind: "neighbour", id, files: listing(page) } : { kind: "picture", id, files: [] };
  } else {
    setFrame(g, null, false);
    g.live = { kind: "empty", id: null, files: [] };
  }
  g.where.textContent = WHERE[g.live.kind];
}

/** Walk by (dx, dz) plots: off an edge, onto the plot next door from its opposite edge. */
function move(g: G, dx: number, dz: number): Promise<void> {
  g.pos.x += dx; g.pos.z += dz;
  let crossed = false;
  while (g.pos.x >= 1) { g.pos.x -= 1; g.plot.x++; crossed = true; }
  while (g.pos.x < 0) { g.pos.x += 1; g.plot.x--; crossed = true; }
  while (g.pos.z >= 1) { g.pos.z -= 1; g.plot.y++; crossed = true; }
  while (g.pos.z < 0) { g.pos.z += 1; g.plot.y--; crossed = true; }
  if (crossed) g.moving = onPlot(g);
  return g.moving;
}

const DIRS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

function tick(g: G, dt: number, now: number) {
  let vx = g.stick.x, vz = g.stick.z;
  for (const k of g.keys) { const d = DIRS[k]; if (d) { vx += d[0]; vz += d[1]; } }
  const len = Math.hypot(vx, vz);
  if (g.me && len > 0.05) void move(g, (vx / Math.max(1, len)) * SPEED * dt, (vz / Math.max(1, len)) * SPEED * dt);
  if (g.me) {
    const target = { x: g.plot.x * PITCH + 0.5, z: g.plot.y * PITCH + 0.5 };
    g.cam = g.cam ? { x: g.cam.x + (target.x - g.cam.x) * Math.min(1, dt * 7), z: g.cam.z + (target.z - g.cam.z) * Math.min(1, dt * 7) } : target;
    say(g, now, false);
  }
  draw(g);
}

/** Where you are, out to the galaxy and to the live frame: at most every SEND_MS, unless `now` must. */
function say(g: G, now: number, force: boolean) {
  const at = `${g.plot.x},${g.plot.y},${g.pos.x.toFixed(3)},${g.pos.z.toFixed(3)}`;
  if (at !== g.sent && (force || now - g.sentAt >= SEND_MS) && g.link?.open) {
    g.link.send({ t: "at", x: g.plot.x, y: g.plot.y, px: g.pos.x, pz: g.pos.z });
    g.sent = at; g.sentAt = now;
  }
  if (at !== g.told && (force || now - g.toldAt >= SEND_MS) && !g.frame.hidden) { tell(g, { x: g.pos.x, z: g.pos.z }); g.told = at; g.toldAt = now; }
}

// ---------- the layer ----------

let g: G | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.append(e);
  return e;
}

function mount(room: string) {
  const layer = document.createElement("div");
  layer.className = "galaxy-layer";
  layer.setAttribute("role", "application");
  layer.setAttribute("aria-label", "Agent Galaxy: walk with WASD or the arrow keys");
  const ground = el("canvas", "galaxy-ground", layer);
  const frame = el("iframe", "galaxy-frame", layer);
  // The same seal as the page's own world frame: scripts only, an opaque origin.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", "The world you stand in");
  frame.setAttribute("tabindex", "-1");
  frame.hidden = true;
  Object.assign(frame.style, { width: `${FRAME_PX}px`, height: `${FRAME_PX}px` });
  const chars = el("canvas", "galaxy-chars", layer);
  const where = el("p", "galaxy-where", layer);
  where.setAttribute("role", "status");
  where.textContent = "Finding your plot…";
  el("p", "galaxy-hint", layer).textContent = "Walk: WASD or the arrow keys. Off an edge is the plot next door.";
  const stick = el("div", "galaxy-stick", layer);
  const knob = el("i", "", stick);
  document.body.append(layer);
  const s: G = {
    layer, ground, chars, frame, where, me: null, error: null, ready: Promise.resolve(),
    plot: { x: 0, y: 0 }, pos: { x: 0.5, z: 0.5 }, cam: null, plots: new Map(), players: new Map(),
    live: { kind: "empty", id: null, files: [] }, link: null, keys: new Set(), stick: { x: 0, z: 0 },
    raf: 0, sentAt: 0, sent: "", toldAt: 0, told: "", token: 0, moving: Promise.resolve(), frameAt: "", off: [],
  };
  const on = (t: EventTarget, type: string, f: (e: Event) => void) => { t.addEventListener(type, f); s.off.push(() => t.removeEventListener(type, f)); };
  on(window, "keydown", (e) => {
    if (!(e instanceof KeyboardEvent) || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
    const k = e.code in DIRS ? e.code : e.key;
    if (k in DIRS) { s.keys.add(k); e.preventDefault(); }
  });
  on(window, "keyup", (e) => { if (e instanceof KeyboardEvent) { s.keys.delete(e.code); s.keys.delete(e.key); } });
  on(window, "blur", () => s.keys.clear());
  // The touch stick: drag from its middle, up to its rim.
  const R = 44;
  const steer = (e: Event) => {
    if (!(e instanceof PointerEvent)) return;
    const b = stick.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dz = e.clientY - (b.top + b.height / 2), l = Math.max(R, Math.hypot(dx, dz));
    s.stick = { x: dx / l, z: dz / l };
    knob.style.transform = `translate(${(s.stick.x * R).toFixed(0)}px, ${(s.stick.z * R).toFixed(0)}px)`;
  };
  on(stick, "pointerdown", (e) => { if (e instanceof PointerEvent) { stick.setPointerCapture(e.pointerId); steer(e); } });
  on(stick, "pointermove", (e) => { if (e instanceof PointerEvent && stick.hasPointerCapture(e.pointerId)) steer(e); });
  const stop = () => { s.stick = { x: 0, z: 0 }; knob.style.transform = ""; };
  on(stick, "pointerup", stop); on(stick, "pointercancel", stop);
  s.off.push(watchPage((p) => {
    if (s.live.kind !== "mine") return;
    setFrame(s, worldDoc(p), true);
    s.live = { ...s.live, files: listing(p) };
  }));
  let last = performance.now();
  const loop = (now: number) => { tick(s, Math.min(0.1, (now - last) / 1000), now); last = now; s.raf = requestAnimationFrame(loop); };
  s.raf = requestAnimationFrame(loop);
  s.ready = (async () => {
    // Saved first, so a neighbour who walks in right away runs it.
    await saveWorld(room, currentPage());
    const me = await getJson("/api/galaxy/claim", Claimed, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room }) });
    if (g !== s) return;
    if (!me) { s.error = "The galaxy didn't answer: try again in a moment."; where.textContent = s.error; return; }
    s.me = me; s.plot = { x: me.x, y: me.y };
    await onPlot(s);
    if (g !== s) return;
    s.link = connectSocket<FromGalaxy, ToGalaxy>(() => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/galaxy/socket?room=${room}`, {
      decode: (v) => check(FromGalaxy, v),
      onMessage: (m) => {
        if (m.t === "players") { s.players = new Map((m.players ?? []).map((p) => [p.id, p])); }
        else if (m.t === "player" && m.player) s.players.set(m.player.id, m.player);
        else if (m.t === "gone" && m.id) s.players.delete(m.id);
      },
      onOpen: () => { s.sent = ""; },
      onClose: ({ code, tries }) => (code === 4001 ? null : Math.min(10_000, 500 * 2 ** tries)),
    });
  })();
  g = s;
}

function unmount() {
  const s = g;
  if (!s) return;
  g = null;
  cancelAnimationFrame(s.raf);
  tell(s, null);
  for (const f of s.off) f();
  s.link?.close();
  s.layer.remove();
}

const until = async (ok: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 30))) if (Date.now() > end) throw new Error("the galaxy didn't come up");
};

/** What a test or the probe asks: in the galaxy or not, your plot and spot, the plots and players in view, and what
 *  runs live. Plots and players are those on your plot and the eight around it. */
export function galaxyState() {
  if (!g) return { in: false, ready: false, error: null, me: null, plot: null, pos: null, plots: [], players: [], live: null };
  const s = g;
  return {
    in: true, ready: s.me !== null, error: s.error, me: s.me, plot: { ...s.plot }, pos: { ...s.pos },
    plots: [...s.plots.values()].filter((p) => near(p, s.plot)).map((p) => ({ ...p, mine: s.me !== null && p.id === s.me.id })),
    players: visible(s).map((p) => ({ ...p })),
    live: { ...s.live, files: s.live.files.map((f) => ({ ...f })) },
  };
}

/** Agent Galaxy's layer for this room: it follows ProfilePage's galaxy mode, keeps the room's world saved on the server,
 *  and puts `window.agentGalaxy` up for tests and the probe. */
export function startGalaxy(room: string) {
  keepSaved(room);
  const app = document.getElementById("app") ?? document.body;
  const follow = () => { const on = document.querySelector('[data-galaxy="on"]') !== null; if (on && !g) mount(room); else if (!on && g) unmount(); };
  new MutationObserver(follow).observe(app, { childList: true, subtree: true });
  follow();
  const agentGalaxy = {
    state: galaxyState,
    /** Up to the galaxy, once your plot is claimed and its world is running. */
    enter: async () => {
      Queue.offerUnsafe(galaxyAsks, true);
      await until(() => g !== null);
      await g?.ready;
      await until(() => g?.link?.open === true || g?.error !== null);
      return galaxyState();
    },
    /** Back to your world. */
    leave: async () => { Queue.offerUnsafe(galaxyAsks, false); await until(() => g === null); return galaxyState(); },
    /** Walk by (dx, dz) plots at once (off an edge is the plot next door), once the plot you land on has loaded. */
    walk: async (dx: number, dz: number) => {
      const s = g;
      if (!s?.me) throw new Error("enter() first");
      await move(s, dx, dz);
      say(s, performance.now(), true);
      return galaxyState();
    },
  };
  Object.assign(window, { agentGalaxy });
  return agentGalaxy;
}
