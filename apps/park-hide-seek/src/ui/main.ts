// The page: menu, lobby (with the camper customizer), the drop map, the 3D
// hunt, the radio map, and results. Solo games run the Room right here; LAN
// and online games talk to a world (see session.ts).

import { allAsks, askBlocked, askText, radioGrid, RADIO, type Ask, type Clue } from "../clues.ts";
import { HATS, HUNT, PANTS, SHIRTS, SKINS, circleAt, dropOk, outside, randomLook, type BotLevel, type Look, type Msg, type View } from "../hunt/game.ts";
import { step, type Body } from "../hunt/sim.ts";
import { ZONES, zoneById, type Zone } from "../zones/zone.ts";
import { describe } from "../weather.ts";
import { CALLS, place, sounds } from "./audio.ts";
import { Controls } from "./controls.ts";
import { Preview } from "./preview.ts";
import { LocalSession, NetSession, playerId, tabPlayerId, type Session } from "./session.ts";
import { World3D } from "./world3d.ts";
import { ZoneMap } from "./zonemap.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get(k: string) { try { return localStorage.getItem(`phs.${k}`) ?? ""; } catch { return ""; } },
  set(k: string, v: string) { try { localStorage.setItem(`phs.${k}`, v); } catch {} },
};

// ---- state --------------------------------------------------------------------

let session: Session | null = null;
let view: View | null = null;
let hosting: { pass: string; addresses: string[]; port: number } | null = null;
/** The online room this page is in, if any. */
let room: string | null = null;
let info: { app?: string; version?: string } | null = null;
let look: Look = (() => { try { const l = JSON.parse(store.get("look")); if (l && HATS.includes(l.hat)) return l as Look; } catch {} return randomLook(); })();

/** Your own body, moved locally every frame so it never lags. */
let body: (Body & { key: string; pitch: number; speed: number }) | null = null;
let light = true;
let camMode: "first" | "third" = store.get("cam") === "first" ? "first" : "third";
let mapOpen = false;
let radioFor: string | null = null;
let spectate = 0;
let lastSend = 0;
let lastFrame = performance.now();
let hover: [number, number] | null = null;
const heard = new Set<number>();
/** Positions we've sent lately, to tell the host lagging behind us from the host correcting us. */
let sent: [number, number][] = [];
let checkedView: View | null = null;
let flash: { text: string; until: number } | null = null;

const world = new World3D($<HTMLCanvasElement>("view"));
const zmap = new ZoneMap($<HTMLCanvasElement>("zonemap"));
const preview = new Preview($<HTMLCanvasElement>("preview"));
const controls = new Controls($<HTMLCanvasElement>("view"));
const serverNow = () => Date.now() + (session?.offset ?? 0);
const send = (m: Msg) => session?.send(m);
const nameOf = (v: View, id: string) => v.players.find((p) => p.id === id)?.name ?? "someone";
const note = (text: string, ms = 2500) => { flash = { text, until: Date.now() + ms }; };

// ---- menu -----------------------------------------------------------------------

const nameInput = $<HTMLInputElement>("name");
nameInput.value = store.get("name");
$<HTMLInputElement>("addr").value = store.get("addr");
const myName = () => (nameInput.value.trim() || "Camper").slice(0, 24);
const menuError = (s: string) => { $("menu-error").textContent = s; };

const ROOM = /^[A-Z0-9]{4,8}$/;
// No 0/O or 1/I, so a code read out loud comes out right.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCode = () => Array.from(crypto.getRandomValues(new Uint32Array(5)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
const roomLink = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

(async () => {
  info = await fetch("/__rb/info").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const desktop = info?.app === "park-hide-seek";
  for (const el of document.querySelectorAll<HTMLElement>("[data-desktop]")) el.hidden = !desktop;
  for (const el of document.querySelectorAll<HTMLElement>("[data-online]")) el.hidden = desktop;
  $("menu-note").textContent = desktop
    ? "LAN games: one person hosts, everyone else runs their own copy of the app and joins with the address and passphrase."
    : "Online: create a room and send friends its link or code. Up to 8 players; fill the rest with AI.";
  // A shared link (?room=CODE) opens with the code filled in.
  const shared = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
  if (!desktop && ROOM.test(shared)) { $<HTMLInputElement>("room").value = shared; $("room-join").hidden = false; }
})();

$("solo").onclick = () => { store.set("name", myName()); sounds.unlock(); start(new LocalSession(myName(), look)); };

const WORDS = ["marmot", "canyon", "sequoia", "geyser", "ranger", "bison", "summit", "meadow", "falls", "juniper", "osprey", "granite", "mesa", "elk", "pika", "aspen"];
const passphrase = () => { const r = crypto.getRandomValues(new Uint32Array(2)); return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}`; };

$("host").onclick = async () => {
  store.set("name", myName()); sounds.unlock(); menuError("");
  try {
    const pass = passphrase();
    const res = await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ listen: { hostname: "0.0.0.0" }, join: pass }) });
    if (!res.ok) throw new Error(`host said ${res.status}`);
    const lan = await fetch("/api/lan").then((r) => r.json()) as { addresses: string[]; port: number };
    hosting = { pass, addresses: lan.addresses, port: lan.port };
    const s = new NetSession("host", "/ws");
    start(s);
    s.send({ t: "name", name: myName() });
    s.send({ t: "look", look });
  } catch (err) { menuError(`Couldn't open a LAN game: ${(err as Error).message}`); }
};

$("show-join").onclick = () => { $("join").hidden = !$("join").hidden; $<HTMLInputElement>("addr").focus(); };
$<HTMLFormElement>("join").onsubmit = (e) => {
  e.preventDefault();
  store.set("name", myName()); sounds.unlock(); menuError("");
  const addr = $<HTMLInputElement>("addr").value.trim().replace(/^\w+:\/\//, "").replace(/\/.*$/, "");
  if (!/^[\w.-]+:\d+$/.test(addr)) { menuError("Use the host's address and port, like 192.168.1.20:41234."); return; }
  store.set("addr", addr);
  const s = new NetSession("guest", `http://${addr}/ws`, { join: $<HTMLInputElement>("pass").value.trim(), uid: playerId(), name: myName(), v: info?.version });
  start(s);
  s.send({ t: "look", look });
};

// ---- online rooms ---------------------------------------------------------------

function goOnline(code: string) {
  store.set("name", myName()); sounds.unlock(); menuError("");
  room = code;
  history.replaceState(null, "", roomLink(code));
  const s = new NetSession("online", "/ws", { room: code, uid: tabPlayerId(), name: myName() });
  start(s);
  s.send({ t: "look", look });
}

$("online").onclick = () => goOnline(roomCode());
$("show-room").onclick = () => { $("room-join").hidden = !$("room-join").hidden; $<HTMLInputElement>("room").focus(); };
$<HTMLFormElement>("room-join").onsubmit = (e) => {
  e.preventDefault();
  const code = $<HTMLInputElement>("room").value.trim().toUpperCase();
  if (!ROOM.test(code)) { menuError("Room codes are 4 to 8 letters and numbers, like PIKA7."); return; }
  goOnline(code);
};

function start(s: Session) {
  session = s;
  view = null;
  body = null;
  s.onView = (v) => {
    const prev = view;
    view = v;
    if (prev?.round?.id !== v.round?.id) { radioFor = null; spectate = 0; mapOpen = false; }
    // Flashlight on after dark, again when the live weather turns out to be night.
    if (v.round && (prev?.round?.id !== v.round.id || prev.round.sky.tod !== v.round.sky.tod)) light = v.round.sky.tod !== "day";
    if (prev?.phase !== v.phase) onPhase(v);
    $("menu").hidden = true;
    renderPanels();
  };
  s.onStatus = (st) => { if (st.state === "closed" && st.error) { void leave(); menuError(st.error); } };
}

async function leave() {
  session?.close();
  session = null; view = null; body = null;
  controls.release();
  if (room) { room = null; history.replaceState(null, "", location.pathname); }
  if (hosting) {
    hosting = null;
    await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ join: null, listen: { hostname: "127.0.0.1" } }) }).catch(() => {});
  }
  for (const id of ["lobby", "hud", "mapview", "results"]) $(id).hidden = true;
  $("menu").hidden = false;
}

function onPhase(v: View) {
  const you = v.round?.you;
  if (v.phase === "drop") note(you?.role === "ranger" ? "You're a ranger this round. Campers are picking where to drop." : "Pick where to drop in: click the map.", 4000);
  if (v.phase === "hide") { controls.clearPresses(); note(you?.role === "camper" ? "Find somewhere to hide! C to crouch in a bush." : "Counting at the ranger station…", 3500); }
  if (v.phase === "hunt") note(you?.role === "ranger" ? "Go find them! Q to call out, M for the radio." : "Here come the rangers. Stay still, stay quiet.", 3500);
  if (v.phase !== "hide" && v.phase !== "hunt") controls.release();
}

// ---- lobby ------------------------------------------------------------------------

let lastLobby = "";
function renderLobby(v: View) {
  const host = v.hostId === v.me;
  const dis = host ? "" : "disabled";
  const zones = [`<button data-zone="random" aria-pressed="${v.zonePick === "random"}" ${dis}>Random drop zone<small>A new attraction every round</small></button>`,
    ...ZONES.map((z) => `<button data-zone="${z.id}" aria-pressed="${v.zonePick === z.id}" ${dis}>${esc(z.name)}<small>${esc(z.blurb)}</small></button>`)].join("");
  const html = `
    <section><h2>Yosemite National Park</h2><div class="zones">${zones}</div></section>
    <section><h2>Time of day and weather</h2><div class="row-btns"><button data-live="1" aria-pressed="${v.live}" ${dis}>Live: the park right now<small>Real weather and time of day</small></button>${(["day", "dusk", "night"] as const).map((t) => `<button data-tod="${t}" aria-pressed="${!v.live && v.tod === t}" ${dis}>${t === "day" ? "Day" : t === "dusk" ? "Dusk" : "Night (flashlights)"}</button>`).join("")}</div>${v.live ? `<p class="note">Rain hides footsteps, fog cuts how far anyone sees, wind makes rustles hard to place. If the weather can't be reached, it's ${v.tod}.</p>` : ""}</section>
    ${host ? `<section><h2>Rounds</h2><div class="row-btns"><button data-laps="1" aria-pressed="${v.laps === 1}">Everyone's a ranger once</button><button data-laps="2" aria-pressed="${v.laps === 2}">Twice</button></div></section>
    <section><h2>Add an AI player</h2><div class="row-btns"><button data-bot="easy">Easy</button><button data-bot="normal">Normal</button><button data-bot="hard">Hard</button></div></section>` : ""}
    ${room ? `<section><h2>Friends join with</h2><div class="lan">Room code: <code>${room}</code><br>Or send them this link: <code>${esc(roomLink(room))}</code> <button data-action="copy">Copy link</button></div></section>` : ""}
    ${hosting ? `<section><h2>Friends join with</h2><div class="lan">Address: ${hosting.addresses.length ? hosting.addresses.map((a) => `<code>${a}:${hosting!.port}</code>`).join(" or ") : "<em>no network found</em>"}<br>Passphrase: <code>${esc(hosting.pass)}</code></div></section>` : ""}
    <section><h2>Players</h2><ul class="players">${v.players.map((p) => `<li><span class="who">${esc(p.name)}${p.id === v.me ? " (you)" : ""}</span>${p.bot ? `<span class="badge">${p.bot} AI</span>` : ""}${p.id === v.hostId ? `<span class="badge">host</span>` : ""}${host && p.id !== v.me ? `<button data-kick="${esc(p.id)}" title="Remove">✕</button>` : ""}<span class="pts">${p.score}</span></li>`).join("")}</ul></section>
    <section class="row-btns">${host ? `<button class="primary" data-action="start" ${v.players.filter((p) => p.online).length < 2 ? "disabled" : ""}>Start the hunt</button>` : `<em>Waiting for ${esc(nameOf(v, v.hostId ?? ""))} to start…</em>`}<button data-action="leave">${session?.kind === "host" ? "Stop hosting" : "Leave"}</button></section>
    <p class="note">One ranger a round (two once there are five players); everyone else camps. Campers score a point per second hidden, plus ${HUNT.survivalBonus} for lasting the whole hunt. Rangers score ${HUNT.catchPoints} per catch.</p>`;
  if (html !== lastLobby) { lastLobby = html; $("lobby-main").innerHTML = html; }
}

let lastLook = "";
function renderLook() {
  const sw = (key: "shirt" | "pants" | "skin", colors: string[]) => `<div class="look-row">${key === "shirt" ? "Jacket" : key === "pants" ? "Pants" : "Skin"}</div><div class="swatches">${colors.map((c, i) => `<button data-look="${key}" data-i="${i}" aria-pressed="${look[key] === i}" style="background:${c}" title="${c}"></button>`).join("")}</div>`;
  const html = `${sw("shirt", SHIRTS)}${sw("pants", PANTS)}${sw("skin", SKINS)}
    <div class="look-row">Hat</div><div class="row-btns" style="margin:4px 0 10px">${HATS.map((h) => `<button data-look="hat" data-v="${h}" aria-pressed="${look.hat === h}">${h === "none" ? "None" : h[0].toUpperCase() + h.slice(1)}</button>`).join("")}</div>
    <div class="row-btns"><button data-look="pack" aria-pressed="${look.pack}">Backpack</button><button data-look="random">Surprise me</button></div>`;
  if (html !== lastLook) { lastLook = html; $("look").innerHTML = html; }
}

$("look").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  const k = b.dataset.look;
  if (k === "shirt" || k === "pants" || k === "skin") look = { ...look, [k]: Number(b.dataset.i) };
  else if (k === "hat") look = { ...look, hat: b.dataset.v as Look["hat"] };
  else if (k === "pack") look = { ...look, pack: !look.pack };
  else if (k === "random") look = randomLook();
  store.set("look", JSON.stringify(look));
  send({ t: "look", look });
  renderLook();
});

document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("#lobby-main button, #results button, #radio button");
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.zone) send({ t: "settings", zone: d.zone });
  else if (d.live) send({ t: "settings", live: true });
  else if (d.tod) send({ t: "settings", tod: d.tod as View["tod"], live: false });
  else if (d.laps) send({ t: "settings", laps: Number(d.laps) });
  else if (d.bot) send({ t: "bot", level: d.bot as BotLevel });
  else if (d.kick) send({ t: "kick", id: d.kick });
  else if (d.ask) send({ t: "ask", ask: JSON.parse(d.ask) as Ask });
  else if (d.radio) radioFor = d.radio;
  else if (d.action === "start") send({ t: "start" });
  else if (d.action === "lobby") send({ t: "lobby" });
  else if (d.action === "leave") void leave();
  else if (d.action === "copy" && room) void navigator.clipboard?.writeText(roomLink(room)).then(() => note("Link copied"), () => {});
  else if (d.action === "close-map") mapOpen = false;
});

// ---- panels that follow the phase --------------------------------------------------

function renderPanels() {
  const v = view;
  if (!v) return;
  $("lobby").hidden = v.phase !== "lobby";
  $("hud").hidden = v.phase === "lobby" || v.phase === "over" || v.phase === "drop";
  $("mapview").hidden = !(v.phase === "drop" || (mapOpen && (v.phase === "hide" || v.phase === "hunt")));
  $("results").hidden = !(v.phase === "results" || v.phase === "over");
  if (v.phase === "lobby") { renderLobby(v); renderLook(); }
  if (v.phase === "results" || v.phase === "over") renderResults(v);
}

let lastResults = "";
function renderResults(v: View) {
  const r = v.round;
  let html = "";
  if (v.phase === "results" && r?.results) {
    const z = zoneById(v.zone);
    const rows = [...r.results].sort((a, b) => b.points - a.points).map((x) => {
      const what = x.role === "ranger" ? `ranger · ${x.points / HUNT.catchPoints} caught` : x.caughtAt === null ? "camped out!" : `caught after ${Math.round((x.caughtAt - r.huntStartedAt) / 1000)} s`;
      return `<tr><td>${esc(nameOf(v, x.id))}${x.id === v.me ? " (you)" : ""}</td><td>${what}</td><td>+${x.points}</td></tr>`;
    }).join("");
    html = `<h3>Round ${r.n + 1}: ${esc(z.data.name)}</h3><table>${rows}</table><p class="note">Next round in a few seconds…</p>`;
  } else if (v.phase === "over") {
    const rank = [...v.players].sort((a, b) => b.score - a.score);
    html = `<h3>${esc(rank[0]?.name ?? "")} wins!</h3><table>${rank.map((p, i) => `<tr><td>${i + 1}. ${esc(p.name)}${p.id === v.me ? " (you)" : ""}</td><td></td><td>${p.score}</td></tr>`).join("")}</table>
      <div class="row-btns" style="margin-top:12px">${v.hostId === v.me ? `<button class="primary" data-action="start">Play again</button><button data-action="lobby">Back to the lobby</button>` : "<em>Waiting for the host…</em>"}<button data-action="leave">Leave</button></div>`;
  }
  if (html !== lastResults) { lastResults = html; $("results-body").innerHTML = html; }
}

// ---- the map and the radio ---------------------------------------------------------

zmap.onClick = (x, y) => {
  const v = view, you = v?.round?.you;
  if (!v || v.phase !== "drop" || you?.role !== "camper") return;
  if (!dropOk(zoneById(v.zone), x, y)) { note("Not there: inside the zone, on walkable ground, away from the ranger station."); return; }
  send({ t: "drop", x, y });
};
$("zonemap").addEventListener("mousemove", (e) => {
  const c = e.currentTarget as HTMLCanvasElement, r = c.getBoundingClientRect();
  const s = (Math.min(c.clientWidth, c.clientHeight) * 0.46) / zoneById(view?.zone ?? ZONES[0].id).R;
  hover = [(e.clientX - r.left - c.clientWidth / 2) / s, -(e.clientY - r.top - c.clientHeight / 2) / s];
});
$("zonemap").addEventListener("mouseleave", () => { hover = null; });

function askLabel(a: Ask): string {
  switch (a.kind) {
    case "radar": return `Within ${Math.round(a.r * 1000)} m?`;
    case "compass": return a.axis === "ns" ? "North / south?" : "East / west?";
    case "thermo": return "Hotter or colder?";
    case "match": return a.cat === "peak" ? "Same nearest peak?" : "Same nearest signpost?";
    default: return askText(a);
  }
}

let lastRadio = "";
function renderRadio(v: View, z: Zone, now: number) {
  const r = v.round!, you = r.you;
  let html = "";
  if (v.phase === "drop") {
    html = you?.role === "camper"
      ? `<h2>${esc(z.data.name)}</h2><p>${esc(z.data.blurb)}.</p><p><b>${you.drop ? "Dropping at the flag. Click again to move it." : "Click the map to choose where you drop in."}</b> If you don't, you're dropped somewhere at random.</p><p class="note">Bushes are the green dots: crouch in one and you're very hard to see. The rangers start at the cabin.</p>`
      : `<h2>${esc(z.data.name)}</h2><p>You're a <b>park ranger</b> this round. Campers are choosing where to drop; you start at the ranger station once they've had time to hide.</p>`;
  } else if (you?.role === "ranger" && r.radio && v.phase === "hunt") {
    const g = radioGrid(z), s = r.radio;
    const groups: [string, Ask["kind"]][] = [["Radar", "radar"], ["Compass", "compass"], ["Thermometer", "thermo"], ["Matching", "match"]];
    const asks = allAsks(g);
    const qs = groups.map(([label, kind]) => {
      const btns = asks.filter((a) => a.kind === kind).map((a) => {
        const why = askBlocked(g, s, a, now);
        if (why?.startsWith("too few")) return "";
        return `<button data-ask='${esc(JSON.stringify(a))}' ${why ? `disabled title="${esc(why)}"` : `title="${esc(askText(a))}"`}>${askLabel(a)}</button>`;
      }).join("");
      return btns ? `<div class="qgroup"><div class="label">${label}<em>${RADIO.limits[kind] - s.used[kind]} left</em></div><div class="btns">${btns}</div></div>` : "";
    }).join("");
    const campers = [...new Set(r.asks.flatMap((l) => l.answers.map((a) => a.id)))];
    if (!radioFor || !campers.includes(radioFor)) radioFor = campers[0] ?? null;
    const tabs = campers.length > 1 ? `<h2 style="margin-top:12px">Shading for</h2><div class="row-btns">${campers.map((id) => `<button data-radio="${esc(id)}" aria-pressed="${id === radioFor}">${esc(nameOf(v, id))}</button>`).join("")}</div>` : "";
    const cool = now < s.cooldownUntil ? `Radio busy: ${Math.ceil((s.cooldownUntil - now) / 1000)} s` : "Every camper's radio answers truthfully, for where they are right now.";
    html = `<h2>Radio</h2><div>${qs}</div><div class="why">${cool}</div>${tabs}${askLog(v)}<p class="note">Shaded: where the radio says they can't be (when you asked; they may have moved since). Orange: the search area. Dashed: where it ends up.</p><button data-action="close-map">Back to the park (M)</button>`;
  } else {
    html = `<h2>${esc(z.data.name)}</h2><p class="note">Orange: the search area, closing in. Dashed: where it ends up. Get inside before it reaches you, or the rangers will see you from anywhere.</p>${askLog(v)}<button data-action="close-map">Back to the park (M)</button>`;
  }
  if (html !== lastRadio) { lastRadio = html; $("radio").innerHTML = html; }
}

function askLog(v: View): string {
  const r = v.round!;
  if (!r.asks.length) return "";
  return `<h2 style="margin-top:12px">Radio log</h2><ul class="asks">${[...r.asks].reverse().map((l) => `<li><div class="q">${esc(nameOf(v, l.by))}: ${esc(askText(l.ask))}</div>${l.answers.map((a) => `<div class="a"><span>${esc(nameOf(v, a.id))}:</span> ${esc(a.text)}</div>`).join("")}</li>`).join("")}</ul>`;
}

function radioClues(v: View): { clues: Clue[] | null; key: string } {
  const r = v.round;
  if (!r || r.you?.role !== "ranger" || !radioFor) return { clues: null, key: "" };
  const clues = r.asks.flatMap((l) => l.answers.filter((a) => a.id === radioFor).map((a) => a.clue));
  return { clues, key: `${r.id}:${radioFor}:${clues.length}` };
}

// ---- the frame loop ------------------------------------------------------------------

function loop() {
  requestAnimationFrame(loop);
  frame();
}

function frame() {
  const t = performance.now();
  const dt = Math.min(0.1, (t - lastFrame) / 1000);
  lastFrame = t;
  world.resize();
  const v = view;
  if (!v) {
    // Behind the menu: the valley under Yosemite Falls, at dusk.
    world.setZone(ZONES[2].id); world.setTime("dusk"); world.orbit(t);
    return;
  }
  const now = serverNow();
  renderPanels();
  if (v.phase === "lobby" || v.phase === "over") {
    world.setZone(v.zonePick === "random" ? ZONES[Math.floor(t / 15000) % ZONES.length].id : v.zonePick);
    world.setTime(v.tod);
    world.orbit(t);
    if (v.phase === "lobby") preview.render(look, t);
    return;
  }
  world.setZone(v.zone);
  world.setSky(v.round!.sky);
  const z = zoneById(v.zone);
  const r = v.round!;
  const you = r.you;

  if (controls.take("KeyM") && (v.phase === "hide" || v.phase === "hunt")) { mapOpen = !mapOpen; if (mapOpen) controls.release(); }
  if (controls.take("KeyV")) { camMode = camMode === "first" ? "third" : "first"; store.set("cam", camMode); }
  if (controls.take("Tab")) spectate++;

  // Your body: move it here, tell the host where it went.
  const ranger = you?.role === "ranger";
  const playing = !!you && you.caughtAt === null && (v.phase === "hunt" || (v.phase === "hide" && !ranger));
  if (playing) {
    const key = `${r.id}:${ranger && v.phase === "hunt" ? "out" : "in"}`;
    // The host echoes where it last accepted us. If that's nowhere we've been
    // lately, it moved us (a new round, out of a tree, a speed check): follow it.
    let corrected = false;
    if (checkedView !== v) {
      checkedView = v;
      corrected = !!body && sent.length > 0 && Math.min(...sent.map(([x, y]) => Math.hypot(x - you!.x, y - you!.y))) > 2;
    }
    if (!body || body.key !== key || corrected) {
      body = { x: you!.x, y: you!.y, yaw: you!.yaw, stamina: you!.stamina, crouch: false, run: false, key, pitch: 0, speed: 0 };
      if (!corrected) { controls.yaw = you!.yaw; controls.pitch = 0; controls.crouchToggle = false; }
      sent = [];
    }
    const inp = mapOpen ? { fwd: 0, right: 0, run: false, crouch: body.crouch } : controls.move();
    body.yaw = controls.yaw; body.pitch = controls.pitch;
    const ox = body.x, oy = body.y;
    step(z, body, you!.role, inp, dt);
    body.speed = Math.hypot(body.x - ox, body.y - oy) / Math.max(dt, 1e-3);
    if (ranger && controls.take("KeyF")) light = !light;
    if (ranger && controls.take("KeyQ") && v.phase === "hunt") { send({ t: "call" }); sounds.call(0.8, CALLS[Math.floor(Math.random() * CALLS.length)]); }
    if (t - lastSend > 50) {
      lastSend = t;
      send({ t: "pos", x: body.x, y: body.y, yaw: body.yaw, pitch: body.pitch, crouch: body.crouch, run: body.run, light: ranger && light });
      sent.push([body.x, body.y]);
      if (sent.length > 60) sent.shift();
    }
  } else body = null;

  // Spectating (caught, or a ranger counting in the cabin): follow someone.
  let follow: { x: number; y: number; yaw: number } | null = null;
  if (!body) {
    if (ranger && v.phase === "hide") {
      const st = z.station;
      follow = { x: st.x + Math.cos(st.yaw) * 9, y: st.y + Math.sin(st.yaw) * 9, yaw: Math.atan2(-Math.cos(st.yaw), -Math.sin(st.yaw)) };
    } else {
      const pool = [...r.others].filter((o) => o.caughtAt === null).sort((a, b) => (a.role === b.role ? 0 : a.role === "ranger" ? -1 : 1));
      const o = pool.length ? pool[spectate % pool.length] : null;
      follow = (o && world.drawnAt(o.id)) ?? (you ? { x: you.x, y: you.y, yaw: you.yaw } : { x: 0, y: 0, yaw: 0 });
    }
  }
  world.frame(v, body && { x: body.x, y: body.y, yaw: body.yaw, pitch: body.pitch, crouch: body.crouch, speed: body.speed, light: ranger && light }, look, { mode: camMode, dist: 4.2 }, now, follow);

  // Sounds for new cues.
  for (const c of r.cues) {
    if (heard.has(c.id)) continue;
    heard.add(c.id);
    const me = body ?? (you ? { x: you.x, y: you.y, yaw: you.yaw } : null);
    if (!me) continue;
    const p = place(c.x - me.x, c.y - me.y, me.yaw, c.kind === "call" ? 120 : 60);
    if (c.kind === "rustle") sounds.rustle(p.vol, p.pan);
    else if (c.kind === "step") sounds.step(p.vol, p.pan);
    else if (c.kind === "call" && c.by !== v.me) sounds.call(p.vol, CALLS[c.id % CALLS.length]);
    else if (c.kind === "caught") sounds.caught();
  }

  // The map overlay: the drop screen, or M.
  if (!$("mapview").hidden) {
    const { clues, key } = radioClues(v);
    zmap.render(v, z, { me: body ? { x: body.x, y: body.y, yaw: body.yaw } : null, grid: clues ? radioGrid(z) : null, clues, cluesKey: key, now, drop: you?.drop ?? null, canDrop: (x, y) => dropOk(z, x, y), hover });
    $("map-title").textContent = v.phase === "drop" ? `Drop zone: ${z.data.name} · ${Math.max(0, Math.ceil((v.endsAt - now) / 1000))} s` : ranger ? "Radio map" : "Park map";
    renderRadio(v, z, now);
  }
  hud(v, z, now);
}

function hud(v: View, z: Zone, now: number) {
  if ($("hud").hidden) return;
  const r = v.round!, you = r.you;
  const ranger = you?.role === "ranger";
  const left = Math.max(0, v.endsAt - now);
  $("zone-name").textContent = z.data.name;
  const sky = r.weather ? describe(r.weather) : r.sky.tod[0].toUpperCase() + r.sky.tod.slice(1);
  if ($("sky").textContent !== sky) $("sky").textContent = sky;
  $("phase").textContent = v.phase === "hide" ? "Hiding" : v.phase === "hunt" ? "The hunt" : v.phase === "results" ? "Round over" : "";
  const clock = $("clock");
  clock.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
  clock.classList.toggle("low", v.phase === "hunt" && left < 20000);

  // The banner: flashes first, then warnings.
  let text = "", warn = false;
  if (flash && Date.now() < flash.until) text = flash.text;
  else if (you?.caughtAt != null) text = `Caught after ${Math.round((you.caughtAt - r.huntStartedAt) / 1000)} s. Spectating: Tab to switch.`;
  else if (body && r.circle && v.phase === "hunt" && !ranger) {
    const k = circleAt(r.circle, now);
    const edge = k.r - Math.hypot(body.x - k.x, body.y - k.y);
    if (outside(r.circle, now, body.x, body.y)) { text = "Outside the search area: the rangers can see you! Get back in."; warn = true; }
    else if (edge < 15 && now < r.circle.to) { text = `The search area is closing in: ${Math.round(edge)} m to the edge`; warn = true; }
  }
  const b = $("banner");
  if (b.textContent !== text) b.textContent = text;
  b.classList.toggle("warn", warn);

  let call = "";
  if (ranger && v.phase === "hunt") {
    const last = [...r.cues].reverse().find((c) => c.kind === "call" && c.by === v.me);
    const cd = last ? HUNT.callCooldownSecs * 1000 - (now - last.at) : 0;
    call = cd > 0 ? ` · call ready in ${Math.ceil(cd / 1000)} s` : " · call ready (Q)";
  }
  $("role").textContent = !you ? "Watching" : ranger ? `Park ranger${call}` : you.caughtAt != null ? "Caught" : body?.crouch ? (z.bushAt(body.x, body.y) ? "Camper · hidden in a bush" : "Camper · crouching") : "Camper";
  $("stamina").style.width = `${Math.round((body?.stamina ?? 1) * 100)}%`;
  const hints = ranger
    ? "<kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>Q</kbd> call out · <kbd>F</kbd> flashlight · <kbd>M</kbd> radio · <kbd>V</kbd> camera"
    : "<kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>C</kbd> crouch (hide in bushes) · <kbd>M</kbd> map · <kbd>V</kbd> camera";
  if ($("hints").innerHTML !== hints) $("hints").innerHTML = hints;
  $("crosshair").hidden = !body;
  $("clickme").hidden = !body || controls.locked || mapOpen;
  const cabin = $("cabin");
  cabin.hidden = !(ranger && v.phase === "hide");
  if (!cabin.hidden) {
    const html = `Counting to ${HUNT.hideSecs}… ${Math.ceil(left / 1000)}<small>Campers are hiding round ${esc(z.data.name)}.</small>`;
    if (cabin.innerHTML !== html) cabin.innerHTML = html;
  }
  const feed = v.log.slice(-4).map((l) => `<li>${esc(l)}</li>`).join("");
  if ($("feed").innerHTML !== feed) $("feed").innerHTML = feed;
  const scores = [...v.players].sort((a, b) => b.score - a.score).map((p) => {
    const a = r.others.find((o) => o.id === p.id) ?? (p.id === v.me ? you : null);
    return `<li class="${a && a.caughtAt !== null ? "out" : ""}"><span>${r.rangers.includes(p.id) ? "★ " : ""}${esc(p.name)}</span><b>${p.score}</b></li>`;
  }).join("");
  if ($("scores").innerHTML !== scores) $("scores").innerHTML = scores;
}

requestAnimationFrame(loop);

// Dev only: drive frames by hand, for automated checks in a tab the browser
// considers hidden (where requestAnimationFrame never fires).
if (import.meta.env.DEV) {
  (window as any).__phs = {
    run(ms: number, keys: string[] = []) {
      for (const k of keys) window.dispatchEvent(new KeyboardEvent("keydown", { code: k }));
      const steps = Math.ceil(ms / 16);
      for (let i = 0; i < steps; i++) { lastFrame -= 16; frame(); }
      for (const k of keys) window.dispatchEvent(new KeyboardEvent("keyup", { code: k }));
      return body && { x: body.x, y: body.y, stamina: body.stamina };
    },
    look(dyaw: number, dpitch = 0) { controls.yaw += dyaw; controls.pitch += dpitch; },
    state: () => ({ phase: view?.phase, you: view?.round?.you, others: view?.round?.others.length, body }),
  };
}
