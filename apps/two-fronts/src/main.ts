// The page: the strategy map and its orders panel, the briefing for a hero battle, the battle
// itself, and back. A game against the AI or a hotseat game is a table kept in this browser,
// saved after every change. A game online lives in its campaign's Durable Object, and this page
// is one seat at it.
import { GALAXIES, SECTOR_NAMES, FACTION_NAMES, galaxyOf, type GalaxyId } from "./war/galaxy.ts";
import {
  COST, enemy, heroReady, income, keyShare, planOrders, supplied,
  type Campaign, type Order, type Orders, type Where,
} from "./war/rules.ts";
import { handIn, heroFaction, humans, newTable, report, waitingOn, type Seats, type Table } from "./war/table.ts";
import { fetchView, linkInHash, seatLink, sendBattle, sendOrders, startOnline, type Online, type View } from "./net.ts";
import { drawMap } from "./ui/map.ts";
import { FLAVOR, run } from "./battle/sim.ts";
import type { BattleResult, BattleSpec, Faction, Side } from "./battle/contract.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// v2 gained the cannon sectors, v3 renamed the factions, v4 had a galaxy per campaign, v5 is a
// table with seats and a hero a side.
const SAVE = "two-fronts:v5", ONLINE = "two-fronts:online";
const POLL_MS = 5000;

type Game = { kind: "local"; table: Table } | { kind: "online"; link: Online; view: View };

const read = <T>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };

let game: Game = { kind: "local", table: read<{ table: Table }>(SAVE)?.table ?? newTable({ marines: "human", wooka: "ai" }) };
let c: Campaign = game.table.campaign;
let me: Faction = c.player;
let mine: Orders = read<{ orders: Orders }>(SAVE)?.orders ?? { faction: me, orders: [] };
let selected: string | null = null;
let busy = false; // a call to the server, or a battle, is under way

const online = () => (game.kind === "online" ? game : null);
const hotseat = () => game.kind === "local" && humans(game.table).length === 2;
const waiting = () => (game.kind === "local" ? waitingOn(game.table) : game.view.waiting);
// Whose orders this screen is giving: online, always this seat; at the table, whoever's up.
const seatUp = (): Faction => (game.kind === "online" ? game.view.seat : waitingOn(game.table)[0] ?? c.player);
const save = () => {
  if (game.kind === "local") write(SAVE, { table: game.table, orders: mine });
  else write(ONLINE, { ...game.link, draft: { turn: c.turn, orders: mine } });
};
const myTurn = () => !c.winner && !c.pending && waiting().includes(me);

const systemDef = (id: string) => galaxyOf(c).system(id), neighbours = (id: string) => galaxyOf(c).neighbours(id);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const placeName = (w: Where) => {
  const d = systemDef(w.system);
  return d.sectors.length > 1 ? `${d.name} · ${SECTOR_NAMES[d.sectors[w.sector]!]}` : d.name;
};
const describe = (o: Order) =>
  o.kind === "build" ? `Build ${o.unit === "fleet" ? "a ship" : "an army"} at ${placeName(o.at)}`
  : o.kind === "fleet" ? `${o.count} ${o.count === 1 ? "ship" : "ships"}: ${systemDef(o.from).name} → ${systemDef(o.to).name}`
  : `${o.count} ${o.count === 1 ? "army" : "armies"}: ${placeName(o.from)} → ${placeName(o.to)}`;

// Queues an order if the rules take it, and says why not if they don't.
function order(o: Order) {
  const err = planOrders(c, [{ ...mine, orders: [...mine.orders, o] }]).errors.at(-1);
  if (err) return flash(err);
  mine.orders.push(o);
  save(); render();
}
function flash(msg: string) {
  const el = $("flash");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((flash as any).t);
  (flash as any).t = setTimeout(() => (el.hidden = true), 2500);
}

function render() {
  const draft = planOrders(c, [mine]).c, foe = enemy(me), g = online();
  $("map").innerHTML = drawMap(c, mine.orders, selected, mine.hero);
  const share = keyShare(c, me);
  $("status").innerHTML = `
    <div class="row"><b>Turn ${c.turn}</b><span title="Credits now, and next turn's income">◈ ${draft.credits[me]} <small>+${income(c, me)}/turn</small></span></div>
    <div class="war" title="Key sectors held (capitals and spaceports). Hold 75% to win; fall under 30% and your income halves.">
      <i class="marines" style="width:${keyShare(c, "marines") * 100}%"></i><i class="wooka" style="width:${keyShare(c, "wooka") * 100}%"></i>
    </div>
    <div class="row small"><span>War score ${Math.round(share * 100)}%</span><span>${heroReady(c, me) ? `Hero, level ${c.heroes[me].level}` : `Hero wounded until turn ${c.heroes[me].woundedUntil}`}</span></div>
    ${g || hotseat() ? `<div class="row small seat"><span><i class="dot ${me}"></i>${g ? "Online" : "Hotseat"}: ${FACTION_NAMES[me]}</span>
      ${g ? `<span>${waitingLine()}</span>${g.link.invite ? `<button type="button" id="invite" class="link" title="The other side's link">🔗</button>` : ""}` : ""}</div>` : ""}`;

  // The selected system: what's there, and what you can order.
  let html = `<p class="hint">Pick a system on the map.</p>`;
  if (selected) {
    const d = systemDef(selected), s = c.systems[selected]!, ds = draft.systems[selected]!;
    const opts = (n: number) => Array.from({ length: n }, (_, i) => `<option${i === n - 1 ? " selected" : ""}>${i + 1}</option>`).join("");
    const can = (o: Order) => planOrders(c, [{ ...mine, orders: [...mine.orders, o] }]).errors.at(-1);
    const btn = (label: string, o: Order, extra = "") => {
      const err = can(o);
      return `<button type="button" data-order="${esc(JSON.stringify(o))}" ${err ? `disabled title="${esc(err)}"` : ""} ${extra}>${label}</button>`;
    };
    const targets: Where[] = [
      ...s.sectors.map((_, i) => ({ system: selected!, sector: i })),
      ...neighbours(selected).flatMap((n) => c.systems[n]!.sectors.map((_, i) => ({ system: n, sector: i }))),
    ];
    html = `<h2>${d.name}</h2>
      <p class="orbit">Orbit: ${s.orbit ? `<b class="${s.orbit}">${FACTION_NAMES[s.orbit]}</b>` : "nobody"} · ▲ ${s.fleets[me]} yours, ${s.fleets[foe]} theirs</p>
      ${s.sectors.some((x) => x.armies[me]) && !supplied(c, me).has(selected) ? `<p class="warn">Cut off from supply: your armies here lose one a turn. Clear the enemy orbit on the way back to a capital.</p>` : ""}
      ${s.sectors.some((x) => x.kind === "cannon") ? `<p class="small">The anti-ship cannon knocks a ship a turn out of an enemy fleet in orbit.</p>` : ""}
      ${ds.fleets[me] ? `<div class="act">Send <select id="ship-n">${opts(ds.fleets[me])}</select> ships to
        <select id="ship-to">${neighbours(selected).map((n) => `<option value="${n}">${systemDef(n).name}</option>`).join("")}</select>
        <button type="button" id="send-ships">Go</button></div>` : ""}
      <ul class="sectors">${s.sectors.map((x, i) => {
        const at = { system: selected!, sector: i }, here = ds.sectors[i]!;
        const builds = x.owner === me ? [
          (x.kind === "spaceport" || (x.kind === "capital" && !s.sectors.some((y) => y.kind === "spaceport"))) && btn(`+ Ship ◈${COST.fleet}`, { kind: "build", unit: "fleet", at }),
          x.kind === "capital" && btn(`+ Army ◈${COST.army}`, { kind: "build", unit: "army", at }),
        ].filter(Boolean).join("") : "";
        const isHero = mine.hero?.system === selected && mine.hero.sector === i;
        return `<li>
          <div class="sector"><i class="dot ${x.owner}"></i><b>${SECTOR_NAMES[x.kind]}</b>
            <span class="armies"><span class="marines">■${x.armies.marines}</span> <span class="wooka">■${x.armies.wooka}</span></span>
            <button type="button" class="hero${isHero ? " on" : ""}" data-hero="${i}" ${heroReady(c, me) ? "" : "disabled"} title="${heroReady(c, me) ? "Play the battle here yourself, if one happens this turn" : "Your hero is wounded"}">⚔</button></div>
          ${builds ? `<div class="act">${builds}</div>` : ""}
          ${here.armies[me] && x.owner === me ? `<div class="act">Send <select data-army-n="${i}">${opts(here.armies[me])}</select> armies to
            <select data-army-to="${i}">${targets.filter((t) => !(t.system === selected && t.sector === i)).map((t) => `<option value="${t.system}:${t.sector}">${placeName(t)}</option>`).join("")}</select>
            <button type="button" data-army-go="${i}">Go</button></div>` : ""}
        </li>`;
      }).join("")}</ul>`;
  }
  $("detail").innerHTML = html;

  $("orders").innerHTML = mine.orders.length || mine.hero
    ? `${mine.orders.map((o, i) => `<li>${describe(o)} <button type="button" class="x" data-drop="${i}" title="Cancel">✕</button></li>`).join("")}
       ${mine.hero ? `<li class="hero-order">⚔ Hero leads at ${placeName(mine.hero)} <button type="button" class="x" data-drop="hero" title="Cancel">✕</button></li>` : ""}`
    : `<li class="hint">No orders yet. Build, send ships to take an orbit, land armies under it, and pick one battle to lead (⚔).</li>`;
  $("log").innerHTML = c.log.map((l) => `<li>${esc(l)}</li>`).join("");
  const end = $("end-turn");
  end.toggleAttribute("disabled", busy || !myTurn());
  end.textContent = g ? (myTurn() ? "Send orders" : waitingLine()) : hotseat() ? "Hand in orders" : "End turn";
  if (c.winner) showModal(`<h2>${hotseat() ? `${FACTION_NAMES[c.winner]} win` : c.winner === me ? "Victory" : "Defeat"}</h2><p>${FACTION_NAMES[c.winner]} wins the war on turn ${c.turn - 1}.</p><button type="button" id="new-war" class="primary">New campaign</button>`);
}

function waitingLine() {
  if (c.winner) return "The war is over";
  const h = heroFaction(c);
  if (h) return h === me ? "Your hero battle" : `${FACTION_NAMES[h]} are fighting a hero battle`;
  if (waiting().includes(me)) return "Your move";
  return `Waiting for the ${waiting().map((f) => FACTION_NAMES[f]).join(" and ")}`;
}

// Clicks, delegated.
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const sys = t.closest<SVGGElement>("[data-system]");
  if (sys) { selected = sys.dataset.system!; render(); return; }
  if (t.dataset.order) return order(JSON.parse(t.dataset.order));
  if (t.id === "send-ships") return order({ kind: "fleet", from: selected!, to: $<HTMLSelectElement>("ship-to").value, count: +$<HTMLSelectElement>("ship-n").value });
  if (t.dataset.armyGo) {
    const i = t.dataset.armyGo, [system, sector] = document.querySelector<HTMLSelectElement>(`[data-army-to="${i}"]`)!.value.split(":");
    return order({ kind: "army", from: { system: selected!, sector: +i }, to: { system: system!, sector: +sector! }, count: +document.querySelector<HTMLSelectElement>(`[data-army-n="${i}"]`)!.value });
  }
  if (t.dataset.hero) {
    const at = { system: selected!, sector: +t.dataset.hero };
    mine.hero = mine.hero?.system === at.system && mine.hero.sector === at.sector ? undefined : at;
    save(); render(); return;
  }
  if (t.dataset.drop) {
    if (t.dataset.drop === "hero") mine.hero = undefined;
    else mine.orders.splice(+t.dataset.drop, 1);
    save(); render(); return;
  }
  if (t.id === "end-turn") return endTurn();
  if (t.id === "new-war" || t.id === "restart") return chooseGame();
  if (t.dataset.start) return startGame(t.dataset.start as "ai" | "hotseat" | "online");
  if (t.id === "invite") return showInvite();
  if (t.id === "copy-link") { void navigator.clipboard?.writeText($<HTMLInputElement>("seat-link").value); flash("Link copied"); return; }
  if (t.id === "pass-on") { hideModal(); return afterTurn(); }
  if (t.id === "close") hideModal();
});
document.addEventListener("keydown", (e) => {
  const sys = (e.target as HTMLElement).closest?.<SVGGElement>("[data-system]");
  if (sys && (e.key === "Enter" || e.key === " ")) { selected = sys.dataset.system!; render(); }
});

// --- Games ---

function chooseGame() {
  showModal(`<h2>New campaign</h2>
    <p>${game.kind === "local" ? "The campaign in this browser will be lost." : "You can come back to the online one from its link."}
      The short war is an evening, the full campaign several.</p>
    <div class="choices">${Object.values(GALAXIES).map((g, i) =>
      `<label title="${esc(g.blurb)}"><input type="radio" name="galaxy" value="${g.id}"${i ? "" : " checked"} /> ${g.name} <small>${g.systems.length} systems</small></label>`).join("")}</div>
    <div class="choices">
      <button type="button" data-start="ai" class="primary" title="The Thunder Marines against the Wooka AI">🤖 Against the AI</button>
      <button type="button" data-start="hotseat" title="Two players taking turns at this screen">👥 Hotseat</button>
      <button type="button" data-start="online" title="Two players, a turn at a time, each from their own link">🔗 Online</button>
    </div>
    <button type="button" id="close" class="link">Keep playing</button>`);
}

async function startGame(kind: "ai" | "hotseat" | "online") {
  const seats: Seats = { marines: "human", wooka: kind === "ai" ? "ai" : "human" };
  const galaxy = (document.querySelector<HTMLInputElement>('input[name="galaxy"]:checked')?.value ?? "short") as GalaxyId;
  if (kind !== "online") {
    hideModal();
    try { localStorage.removeItem(ONLINE); } catch { /* private window */ }
    useGame({ kind: "local", table: newTable(seats, galaxy) });
    return hotseat() ? passTo(seatUp()) : afterTurn();
  }
  try {
    const { id, tokens } = await startOnline(seats, galaxy);
    const link = { id, token: tokens.marines!, invite: tokens.wooka };
    useGame({ kind: "online", link, view: await fetchView(link) });
    showInvite();
  } catch (e) {
    flash(`Online play needs the Worker (bun run edge:dev): ${(e as Error).message}`);
  }
}

function useGame(g: Game, draft?: { turn: number; orders: Orders }) {
  game = g;
  c = g.kind === "local" ? g.table.campaign : g.view.campaign;
  me = seatUp();
  mine = draft?.turn === c.turn && draft.orders.faction === me ? draft.orders : { faction: me, orders: [] };
  selected = galaxyOf(c).systems.find((d) => c.systems[d.id]!.sectors.some((x) => x.owner === me))?.id ?? null;
  save(); render();
}

function showInvite() {
  const g = online();
  if (!g?.link.invite) return;
  showModal(`<h2>Your war, online</h2>
    <p>You're the Thunder Marines. Send this link to whoever plays the Wooka. Keep it to yourselves: the link is their seat.</p>
    <input id="seat-link" class="seat-link" readonly value="${esc(seatLink(g.link.id, g.link.invite))}" />
    <p><button type="button" id="copy-link">Copy link</button></p>
    <p class="small">Your own link, to play from another device: <a href="${esc(seatLink(g.link.id, g.link.token))}">this one</a>.</p>
    <button type="button" id="close" class="primary">To the map</button>`);
}

async function endTurn() {
  const g = online();
  if (g) {
    busy = true; render();
    try { g.view = await sendOrders(g.link, mine); } catch (e) { flash((e as Error).message); }
    busy = false;
    useGame(g);
    return afterTurn();
  }
  if (game.kind !== "local") return;
  const before = me, step = handIn(game.table, me, mine);
  if (!step.ok) return flash(step.error);
  useGame({ kind: "local", table: step.table });
  // Hotseat: the screen goes to the next player before they see anything.
  if (hotseat() && !c.winner && seatUp() !== before) return passTo(seatUp());
  afterTurn();
}

function passTo(f: Faction) {
  const battle = heroFaction(c) === f;
  showModal(`<h2>${FACTION_NAMES[f]}, you're up</h2>
    <p>${battle ? "Your hero has a battle to fight." : `Turn ${c.turn}: give your orders.`} Hand the screen over.</p>
    <button type="button" id="pass-on" class="primary">I'm the ${FACTION_NAMES[f]}</button>`);
}

// After anything moves the turn on: fight our hero battle if it's ours, or wait for the others.
function afterTurn() {
  if (c.winner || busy) return;
  if (c.pending && heroFaction(c) === me) return brief(c.pending.spec, finish);
  if (online() && !myTurn()) schedulePoll();
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_MS);
}
async function poll() {
  const g = online();
  if (!g || busy) return;
  if (document.visibilityState !== "visible") return schedulePoll();
  try {
    const v = await fetchView(g.link);
    const moved = v.campaign.turn !== c.turn || !!v.campaign.pending !== !!c.pending || v.waiting.join() !== g.view.waiting.join();
    g.view = v;
    if (moved) useGame(g, { turn: c.turn, orders: mine });
  } catch { /* try again next time */ }
  afterTurn();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && online()) void poll(); });

// The hero battle's briefing: what the map has given each side for this fight.
function brief(spec: BattleSpec, done: (r: BattleResult) => void) {
  const me = spec.hero, foe = me === "attacker" ? "defender" : "attacker";
  const horde = spec.factions[foe] === "wooka", tanks = (s: Side) => (spec.factions[s] === "wooka" ? "none, just more Wooka" : spec.vehicles[s]);
  const row = (label: string, a: number | string, b: number | string) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
  showModal(`<h2>Hero battle: ${spec.system}, ${SECTOR_NAMES[spec.sector].toLowerCase()}</h2>
    <p>You ${me === "attacker" ? "attack" : "defend"} as ${spec.factions[me] === "wooka" ? "a Wooka chieftain" : "a Thunder Marine"}. Take the command posts and run their tickets out.</p>
    ${horde ? `<p class="flavor">“${FLAVOR[Math.floor(Math.random() * FLAVOR.length)]}”</p>` : ""}
    <table class="spec"><tr><th></th><td>You</td><td>Enemy</td></tr>
      ${row("Armies", spec.armies[me], spec.armies[foe])}
      ${row("Tickets", spec.tickets[me], spec.tickets[foe])}
      ${row("Tanks", tanks(me), tanks(foe))}
      ${row("Orbital strikes", spec.strikes[me], spec.strikes[foe])}
      ${row("Drop pods", spec.reinforcements[me] ? `+${spec.reinforcements[me]}` : "none", spec.reinforcements[foe] ? `+${spec.reinforcements[foe]}` : "none")}
      ${row("Turrets", me === "defender" ? spec.turrets : 0, me === "attacker" ? spec.turrets : 0)}
    </table>
    <p class="small">Strikes and drop pods come from holding the orbit. A shield generator held by the other side cuts strikes to one.</p>
    <button type="button" id="drop-in" class="primary">Drop in</button> <button type="button" id="auto-battle">Let the AI fight it</button>`);
  $("drop-in").onclick = async () => {
    hideModal();
    document.body.classList.add("in-battle");
    const { playBattle } = await import("./battle/view.ts");
    const result = await playBattle(spec, $<HTMLCanvasElement>("battle-view"), $("battle-hud"));
    document.body.classList.remove("in-battle");
    done(result);
  };
  $("auto-battle").onclick = () => { hideModal(); done(run(spec).over!); };
}

async function finish(result: BattleResult) {
  const spec = c.pending!.spec, won = result.winner === spec.hero, g = online();
  if (g) {
    busy = true;
    try {
      g.view = await sendBattle(g.link, result);
    } catch (e) {
      showModal(`<h2>The result didn't get through</h2><p>${esc((e as Error).message)}</p><button type="button" id="resend" class="primary">Try again</button>`);
      $("resend").onclick = () => void finish(result);
      return;
    } finally {
      busy = false;
    }
    useGame(g);
  } else if (game.kind === "local") {
    const step = report(game.table, me, result);
    if (!step.ok) return flash(step.error);
    useGame({ kind: "local", table: step.table });
  }
  showModal(`<h2>${won ? "Sector taken" : "Sector lost"}</h2>
    <p>${won ? (spec.hero === "attacker" ? `${spec.system}'s ${SECTOR_NAMES[spec.sector].toLowerCase()} is yours.` : "You held the line.") : "The battle went against you."}
      Tickets left: ${result.tickets[spec.hero]} to ${result.tickets[spec.hero === "attacker" ? "defender" : "attacker"]}.${result.heroDown ? " Your hero was carried off the field." : ""}</p>
    <button type="button" id="${hotseat() && seatUp() !== spec.factions[spec.hero] ? "pass-on-after" : "back-to-map"}" class="primary">Back to the map</button>`);
}

// Quick play, outside the campaign: the Wooka come for the shield generator. Hold the line as a
// Thunder Marine, or be the horde.
function skirmish(asWooka: boolean) {
  const spec: BattleSpec = {
    id: `skirmish-${Date.now()}`, turn: 0, system: "the forest moon", sector: "shield",
    factions: { attacker: "wooka", defender: "marines" }, hero: asWooka ? "attacker" : "defender", heroLevel: 1,
    armies: { attacker: 4, defender: 3 }, tickets: { attacker: 200, defender: 150 },
    vehicles: { attacker: 1, defender: 1 }, strikes: { attacker: 0, defender: 2 },
    reinforcements: { attacker: 0, defender: 30 }, turrets: 2, seed: Math.floor(Math.random() * 2 ** 31),
  };
  brief(spec, (r) => {
    const won = r.winner === spec.hero;
    showModal(`<h2>${asWooka ? (won ? "The forest is ours" : "Driven back into the ferns") : won ? "Horde repelled" : "Overrun"}</h2>
      <p>${asWooka ? (won ? "The generator is in pieces and someone is wearing a backpack as a hat." : "The Marines held. For now.") : won ? "They'll be back. They always come back." : "They got into the backpacks."}</p>
      <button type="button" id="close" class="primary">Back to the map</button>`);
  });
}
$("hold-line").onclick = () => skirmish(false);
$("be-horde").onclick = () => skirmish(true);

function showModal(html: string) { $("modal-body").innerHTML = html; $("modal").hidden = false; }
function hideModal() { $("modal").hidden = true; }

// Back from the battle's result: the next seat, or the waiting room.
document.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === "pass-on-after") passTo(seatUp());
  else if (id === "back-to-map") { hideModal(); afterTurn(); }
});

// Boot: a seat link in the address wins, then the online game this browser was last at, then the table.
async function boot() {
  const fromHash = linkInHash();
  if (fromHash) history.replaceState(null, "", location.pathname + location.search);
  const saved = read<Online & { draft?: { turn: number; orders: Orders } }>(ONLINE);
  const link = fromHash ?? saved;
  if (link) {
    try {
      const keep = saved && saved.id === link.id && saved.token === link.token ? saved : null;
      return useGame({ kind: "online", link: { ...link, invite: keep?.invite }, view: await fetchView(link) }, keep?.draft), afterTurn();
    } catch (e) {
      flash(`Couldn't reach that campaign: ${(e as Error).message}`);
    }
  }
  useGame(game, { turn: c.turn, orders: mine });
  if (hotseat() && !c.winner) return passTo(seatUp());
  afterTurn();
}
void boot();
