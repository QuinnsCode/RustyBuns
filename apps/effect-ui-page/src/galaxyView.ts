// Agent Galaxy in the page: everyone's land in one 3D scene (land3d.ts), butted edge to edge. You are a robot you
// build (robotShop.ts: it opens the first time, and from its button and Cmd+K); WASD, the arrow keys or the touch stick walk you, straight from your land onto your neighbour's. You arrive with a
// cloud over everything but your own land, and it lifts.
// - Before your first visit you sign for your land, and each nearby plot's sign stands on it (signs.ts).
// - A plot's land is asked of its world (@world/kit) in a hidden sealed frame and comes back as shapes: yours, and
//   those around you from what their rooms last saved (GET /api/galaxy/world/<id>, checked with the Page Schema).
//   A neighbour's code never runs in the shared scene. A world without land shows its picture on the ground
//   (GET /api/galaxy/picture/<id>); an empty plot is open land, with a sign next to you.
// - The page saves its world to the server after each change that lands (PUT /api/r/<room>/world).
// ProfilePage's Model says whether the galaxy is up (its button, Cmd+K and window.agentGalaxy all send the same
// message); this layer comes up when the page shows `[data-galaxy="on"]` and goes when it doesn't.
import { check } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { Effect, Option, Queue, Schema } from "effect";
import { currentPage, unsavedKey, watchPage } from "./agent.ts";
import { COMMON_CITY } from "./commonCity.ts";
import type { Land } from "./land.ts";
import type { Content, Person, Scene3d } from "./land3d.ts";
import { Claimed, FromGalaxy, type Look, lookOf, type Plot, Plots, Robot, type ToGalaxy, VIEW_MAX, type Walker } from "./galaxy.ts";
import { ROBOT_ICON, robotShop, type RobotShop } from "./robotShop.ts";
import { listing, Page } from "./page.ts";
import { bearer } from "./account.ts";
import { galaxyLock } from "./lock.ts";
import { type GallerySigns, gallerySigns } from "./signs.ts";

/** Asks for the galaxy (true) or the way back (false), from Cmd+K and window.agentGalaxy: ProfilePage listens. */
export const galaxyAsks = Effect.runSync(Queue.unbounded<boolean>());

/** Plots a second, walking; how often a position goes out; seconds for the cloud to lift. */
const SPEED = 0.16, SEND_MS = 100, LIFT_S = 2.2;

type Live = { kind: "mine" | "city" | "neighbour" | "picture" | "empty"; id: string | null; files: { path: string; bytes: number }[] };
interface G {
  layer: HTMLDivElement; canvas: HTMLCanvasElement; where: HTMLParagraphElement;
  three: typeof import("./land3d.ts") | null; scene: Scene3d | null; lift: number; since: number;
  me: Claimed | null; error: string | null; ready: Promise<void>;
  plot: { x: number; y: number }; pos: { x: number; z: number }; cam: { x: number; z: number } | null;
  plots: Map<string, Plot>; players: Map<string, Walker>; live: Live;
  link: Link<ToGalaxy> | null; keys: Set<string>; stick: { x: number; z: number };
  raf: number; sentAt: number; sent: string; token: number; moving: Promise<void>;
  signs: GallerySigns; done: boolean;
  /** Your robot, the builder when it is up, and whether it should open by itself (you've never built one). */
  look: Look | null; shop: RobotShop | null; fresh: boolean;
  off: (() => void)[];
}

const key = (x: number, y: number) => `${x},${y}`;
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
const decodePage = Schema.decodeUnknownOption(Page);

// ---------- saving the world for the neighbours ----------

const saveWorld = (room: string, page: Page | null) => page
  ? fetch(`/api/r/${room}/world`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(page) }).then((r) => {
    if (r.ok && currentPage() === page) try { localStorage.removeItem(unsavedKey(room)); } catch { /* private window */ }
    return r.ok;
  }, () => false)
  : Promise.resolve(false);

/** Send the world after each change that lands, a second after the last one (an agent writes files in a row). */
function keepSaved(room: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void saveWorld(room, currentPage()).then((ok) => { if (!ok) timer = setTimeout(() => void saveWorld(room, currentPage()), 4000); }), 1000);
  };
  watchPage(send);
  // A change the last visit never got to the server.
  try { if (localStorage.getItem(unsavedKey(room)) !== null) send(); } catch { /* private window */ }
}

// ---------- the land ----------

/** Each world's land, once asked (by plot id): null for one with none. Kept while the page is open, so going back to
 *  the galaxy is at once; your own is forgotten when your world changes. */
const lands = new Map<string, Land | null>();
const asked = new Map<string, Promise<Land | null>>();
/** Worlds are read three at a time, each in its own hidden frame. */
const lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve(), Promise.resolve()];
let turn = 0, myPlot: string | null = null;
const forget = (id: string) => { lands.delete(id); asked.delete(id); };

const savedWorld = async (id: string) => Option.getOrNull(decodePage(await fetch(`/api/galaxy/world/${id}`).then((r) => (r.ok ? r.json() : null), () => null)));

function read(id: string, three: NonNullable<G["three"]>): Promise<Land | null> {
  const had = asked.get(id);
  if (had) return had;
  const lane = turn++ % lanes.length;
  const next: Promise<Land | null> = lanes[lane]!.then(async () => {
    // Nobody in the galaxy by the time its turn came: ask again next time.
    if (!g) { asked.delete(id); return null; }
    const page = id === myPlot ? currentPage() : await savedWorld(id);
    const land = page ? await three.landOf(page) : null;
    if (asked.get(id) === next) lands.set(id, land);
    return land;
  }).catch(() => null);
  lanes[lane] = next;
  asked.set(id, next);
  return next;
}

/** Put a plot in the scene: its land if its world has some, else its picture, the town, or open ground. */
function show(s: G, p: Plot) {
  const next = Math.abs(p.x - s.plot.x) <= 1 && Math.abs(p.y - s.plot.y) <= 1;
  s.signs.plot(p, next);
  const set = (shows: string, content: Content) => s.scene?.setPlot(p.x, p.y, shows, content);
  if (p.city) return set("town", { kind: "town" });
  if (!p.id) return set(next ? "open:sign" : "open", { kind: "open", sign: next });
  const id = p.id, known = lands.get(id);
  if (known) return set(`land:${id}`, { kind: "land", land: known });
  // Something at once, and the land when its world has said it. Only the plots around you are read.
  if (!s.scene?.shows()[`${p.x},${p.y}`] || known === null) set(`picture:${id}`, { kind: "picture", url: `/api/galaxy/picture/${id}` });
  if (known === null || !next || !s.three) return;
  // Into whichever visit is up when it answers.
  void read(id, s.three).then((land) => { if (land) g?.scene?.setPlot(p.x, p.y, `land:${id}`, { kind: "land", land }); });
}

const visible = (g: G) => [...g.players.values()].filter((p) => p.id !== g.me?.id && near(p, g.plot));

// ---------- walking ----------

const WHERE: Record<Live["kind"], string> = {
  mine: "Your land", city: "The common town",
  neighbour: "A neighbour's land", picture: "A neighbour's land", empty: "Open land: room for someone",
};

/** You stepped onto (or came into) a plot: what's around, what it is, and the land to show. */
async function onPlot(g: G) {
  const t = ++g.token;
  const { x, y } = g.plot;
  const around = await getJson(`/api/galaxy/plots?x=${x}&y=${y}&r=${VIEW_MAX}`, Plots);
  if (t !== g.token) return;
  if (around) g.plots = new Map(around.plots.map((p) => [key(p.x, p.y), p]));
  // Yours first, then outward.
  for (const p of [...g.plots.values()].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))) show(g, p);
  const here = g.plots.get(key(x, y));
  const own = currentPage();
  if (g.me && x === g.me.x && y === g.me.y && own) g.live = { kind: "mine", id: g.me.id, files: listing(own) };
  else if (here?.city) g.live = { kind: "city", id: "city", files: listing(COMMON_CITY) };
  else if (here?.id) {
    const page = await savedWorld(here.id);
    if (t !== g.token) return;
    g.live = page ? { kind: "neighbour", id: here.id, files: listing(page) } : { kind: "picture", id: here.id, files: [] };
  } else g.live = { kind: "empty", id: null, files: [] };
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

// ---------- your robot ----------

function openShop(s: G) {
  if (s.shop || !s.me || !s.look) return;
  s.fresh = false;
  s.keys.clear();
  s.layer.classList.add("building");
  s.shop = robotShop(s.layer, s.look, (look) => { s.look = look; s.link?.send({ t: "look", look }); }, () => closeShop(s));
}

/** Put the builder away and keep the robot for your account. */
function closeShop(s: G) {
  if (!s.shop) return;
  const look = s.shop.look();
  s.shop.close();
  s.shop = null;
  s.layer.classList.remove("building");
  void saveRobot(look).then((ok) => { if (!ok) s.where.textContent = "Your robot wasn't saved: try again in a moment."; });
}

const saveRobot = async (look: Look) =>
  await getJson("/api/galaxy/robot", Robot, { method: "PUT", headers: { ...await bearer(), "content-type": "application/json" }, body: JSON.stringify({ look }) }) !== null;

function tick(g: G, dt: number, now: number) {
  let vx = g.shop ? 0 : g.stick.x, vz = g.shop ? 0 : g.stick.z;
  for (const k of g.keys) { const d = DIRS[k]; if (d && !g.shop) { vx += d[0]; vz += d[1]; } }
  const len = Math.hypot(vx, vz);
  if (g.me && len > 0.05) void move(g, (vx / Math.max(1, len)) * SPEED * dt, (vz / Math.max(1, len)) * SPEED * dt);
  if (g.me) {
    // The camera walks with you, across the seams.
    const target = { x: g.plot.x + g.pos.x, z: g.plot.y + g.pos.z };
    g.cam = g.cam ? { x: g.cam.x + (target.x - g.cam.x) * Math.min(1, dt * 7), z: g.cam.z + (target.z - g.cam.z) * Math.min(1, dt * 7) } : target;
    say(g, now, false);
  }
  if (!g.scene || !g.me || !g.cam) return;
  // The cloud lifts once you're there; a person who asks for less motion gets it gone at once.
  // It waits for your own land, so you never watch your picture turn into it (and gives up waiting after a while).
  if (lands.has(g.me.id) || now - g.since > 8000) g.lift = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : Math.min(1, g.lift + dt / LIFT_S);
  // The first time, the builder waits for the cloud to be gone.
  if (g.fresh && g.lift === 1 && !g.signs.signing()) openShop(g);
  const folk: Person[] = [...visible(g).map((p) => ({ id: p.id, look: p.look, x: p.x + p.px, z: p.y + p.pz, me: false })),
    { id: g.me.id, look: g.look ?? lookOf(g.me.id), x: g.plot.x + g.pos.x, z: g.plot.y + g.pos.z, me: true }];
  g.scene.draw(innerWidth, innerHeight, folk, g.cam, g.me, g.lift, g.shop ? innerHeight - g.shop.el.offsetTop : null);
  g.signs.place();
}

/** Where you are, out to the galaxy: at most every SEND_MS, unless `now` must. */
function say(g: G, now: number, force: boolean) {
  const at = `${g.plot.x},${g.plot.y},${g.pos.x.toFixed(3)},${g.pos.z.toFixed(3)}`;
  if (at !== g.sent && (force || now - g.sentAt >= SEND_MS) && g.link?.open) {
    g.link.send({ t: "at", x: g.plot.x, y: g.plot.y, px: g.pos.x, pz: g.pos.z });
    g.sent = at; g.sentAt = now;
  }
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
  const canvas = el("canvas", "galaxy-land", layer);
  const where = el("p", "galaxy-where", layer);
  where.setAttribute("role", "status");
  where.textContent = "Finding your plot…";
  el("p", "galaxy-hint", layer).textContent = "Walk: WASD or the arrow keys";
  const stick = el("div", "galaxy-stick", layer);
  const knob = el("i", "", stick);
  const dress = el("button", "galaxy-robot", layer);
  dress.type = "button";
  dress.title = "My robot";
  dress.setAttribute("aria-label", "My robot");
  dress.innerHTML = ROBOT_ICON;
  document.body.append(layer);
  // Neighbours may have built since your last visit: read their land afresh. Yours is forgotten when it changes.
  for (const id of [...asked.keys()]) if (id !== myPlot) forget(id);
  const s: G = {
    layer, canvas, where, three: null, scene: null, lift: 0, since: performance.now(), me: null, error: null, ready: Promise.resolve(),
    plot: { x: 0, y: 0 }, pos: { x: 0.5, z: 0.5 }, cam: null, plots: new Map(), players: new Map(),
    live: { kind: "empty", id: null, files: [] }, link: null, keys: new Set(), stick: { x: 0, z: 0 },
    raf: 0, sentAt: 0, sent: "", token: 0, moving: Promise.resolve(), look: null, shop: null, fresh: false, off: [], signs: gallerySigns(layer), done: false,
  };
  dress.addEventListener("click", () => openShop(s));
  const on = (t: EventTarget, type: string, f: (e: Event) => void) => { t.addEventListener(type, f); s.off.push(() => t.removeEventListener(type, f)); };
  on(window, "keydown", (e) => {
    if (!(e instanceof KeyboardEvent) || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || s.signs.signing()) return;
    if (s.shop) { if (e.key === "Escape") closeShop(s); return; }
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
  // Your own world changed while you're out here: read its land again.
  s.off.push(watchPage((p) => {
    if (!s.me) return;
    const mine = s.plots.get(key(s.me.x, s.me.y));
    if (mine) show(s, mine);
    if (s.live.kind === "mine") s.live = { ...s.live, files: listing(p) };
  }));
  let last = performance.now();
  const loop = (now: number) => { tick(s, Math.min(0.1, (now - last) / 1000), now); last = now; s.raf = requestAnimationFrame(loop); };
  s.raf = requestAnimationFrame(loop);
  s.ready = (async () => {
    // Saved first, so a neighbour who walks in right away sees it.
    await saveWorld(room, currentPage());
    try {
      const three = await import("./land3d.ts");
      if (g !== s) return;
      s.three = three;
      s.scene = three.scene3d(canvas);
    } catch {
      s.error = "This browser couldn't start the 3D galaxy.";
      where.textContent = s.error;
      return;
    }
    // Your sign first: the server hands out no plot without one.
    const signed = await s.signs.signed();
    if (g !== s) return;
    if (signed === null) { s.error = "The galaxy didn't answer: try again in a moment."; where.textContent = s.error; return; }
    if (!signed) {
      where.textContent = "Sign for your land";
      if (!(await s.signs.sign(false)) || g !== s) return;
      s.since = performance.now();
      where.textContent = "Finding your plot…";
    }
    const me = await getJson("/api/galaxy/claim", Claimed, { method: "POST", headers: { ...await bearer(), "content-type": "application/json" }, body: JSON.stringify({ room }) });
    if (g !== s) return;
    if (!me) { s.error = "The galaxy didn't answer: try again in a moment."; where.textContent = s.error; return; }
    const kept = await getJson("/api/galaxy/robot", Robot, { headers: await bearer() });
    if (g !== s) return;
    s.look = kept?.look ?? lookOf(me.id);
    s.fresh = kept?.look === null;
    s.me = me; s.plot = { x: me.x, y: me.y }; myPlot = me.id;
    s.signs.start(s.scene!, me.id);
    await onPlot(s);
    if (g !== s) return;
    s.link = connectSocket<FromGalaxy, ToGalaxy>(() => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/galaxy/socket?room=${room}`, {
      decode: (v) => check(FromGalaxy, v),
      onMessage: (m) => {
        if (m.t === "players") { s.players = new Map((m.players ?? []).map((p) => [p.id, p])); }
        else if (m.t === "player" && m.player) s.players.set(m.player.id, m.player);
        else if (m.t === "gone" && m.id) s.players.delete(m.id);
      },
      // Your robot too: it may have changed while the socket was down.
      onOpen: () => { s.sent = ""; if (s.look) s.link?.send({ t: "look", look: s.look }); },
      onClose: ({ code, tries }) => (code === 4001 ? null : Math.min(10_000, 500 * 2 ** tries)),
    });
  })();
  void s.ready.finally(() => { s.done = true; });
  g = s;
}

function unmount() {
  const s = g;
  if (!s) return;
  closeShop(s);
  g = null;
  cancelAnimationFrame(s.raf);
  for (const f of s.off) f();
  s.link?.close();
  s.signs.close();
  s.scene?.dispose();
  s.layer.remove();
}

const until = async (ok: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 30))) if (Date.now() > end) throw new Error("the galaxy didn't come up");
};

/** What a test or the probe asks: in the galaxy or not, your plot and spot, the plots and players on your plot and the
 *  eight around it, what the plot you stand on is, and what each plot in the scene shows (land, picture, town, open). */
export function galaxyState() {
  if (!g) return { in: false, ready: false, look: null, building: false, error: null, me: null, plot: null, pos: null, plots: [], players: [], live: null, shows: {}, signing: false, signs: {}, air: null };
  const s = g;
  return {
    in: true, ready: s.me !== null, look: s.look, building: s.shop !== null, error: s.error, me: s.me, plot: { ...s.plot }, pos: { ...s.pos },
    plots: [...s.plots.values()].filter((p) => near(p, s.plot)).map((p) => ({ ...p, mine: s.me !== null && p.id === s.me.id })),
    players: visible(s).map((p) => ({ ...p })),
    live: { ...s.live, files: s.live.files.map((f) => ({ ...f })) },
    shows: s.scene?.shows() ?? {},
    signing: s.signs.signing(), signs: s.signs.state(),
    air: s.scene?.air() ?? null,
  };
}

/** Agent Galaxy's layer for this room: it follows ProfilePage's galaxy mode, keeps the room's world saved on the server,
 *  and puts `window.agentGalaxy` up for tests and the probe. */
export function startGalaxy(room: string) {
  keepSaved(room);
  watchPage(() => { if (myPlot) forget(myPlot); });
  const app = document.getElementById("app") ?? document.body;
  const follow = () => { const on = document.querySelector('[data-galaxy="on"]') !== null; if (on && !g) mount(room); else if (!on && g) unmount(); };
  new MutationObserver(follow).observe(app, { childList: true, subtree: true });
  follow();
  const agentGalaxy = {
    state: galaxyState,
    /** Up to the galaxy, once your plot is claimed and its world is running; or, before your first visit, once the
     *  pad is up for you to sign (`signing`). */
    enter: async () => {
      if (galaxyLock.why) return { ...galaxyState(), locked: galaxyLock.why };
      Queue.offerUnsafe(galaxyAsks, true);
      await until(() => g !== null);
      await until(() => g === null || g.done || g.signs.signing(), 60_000);
      if (!g?.signs.signing()) await until(() => g?.link?.open === true || g?.error !== null);
      return galaxyState();
    },
    /** "Sign again" from anywhere: up to the galaxy, with the pad. */
    sign: async () => {
      await agentGalaxy.enter();
      if (g) closeShop(g);
      void g?.signs.sign(g.me !== null);
    },
    /** Back to your world. */
    leave: async () => { Queue.offerUnsafe(galaxyAsks, false); await until(() => g === null); return galaxyState(); },
    /** The robot builder, entering first when you're not in. */
    robot: async () => {
      const state = g?.me ? galaxyState() : await agentGalaxy.enter();
      if (g) openShop(g);
      return g ? galaxyState() : state;
    },
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
