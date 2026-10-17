// The page: the strategy map and its orders panel, the briefing for a hero battle, the battle
// itself, and back. A game against the AI or a hotseat game is a table kept in this browser,
// saved after every change. A game online lives in its campaign's Durable Object, and this page
// is one seat at it.
import { GALAXIES, SECTOR_NAMES, FACTION_NAMES, galaxyOf, type GalaxyId } from "./war/galaxy.ts";
import {
  CARDS, CARD_NAMES, COST, FACTIONS, MUSTER_MAX, MUSTER_MIN, ORBIT, checkRetreats, enemy, fogged, handOf, heroReady, idleShips, income, incomeBreakdown, keyShare, musterOf, planDeploys, planOrders, regionHolder, supplied,
  type Attack, type Campaign, type Card, type Order, type Orders, type Retreat, type Where,
} from "./war/rules.ts";
import { aiVote, castVote, handIn, heroFaction, humans, newTable, report, tally, waitingOn, type Seats, type Table, type Vote } from "./war/table.ts";
import { fetchView, linkInHash, pointerSocket, seatLink, sendBattle, sendOrders, sendVote, startOnline, type Online, type View } from "./net.ts";
import { drawMap } from "./ui/map.ts";
import { icon } from "./ui/icons.ts";
import { PRESETS, PRESET_IDS, deploy, emptyDeployment, loadoutOf, placeLoadout, presetDeployment, room, totals, valueOf, type Loadout, type PresetId } from "./war/fleet.ts";
import { MODE_INFO, voteScreen, type VoteSeat } from "./ui/vote.ts";
import { FLAVOR, run } from "./battle/sim.ts";
import { HULL_PER_SHIP, ROUNDS, clash, encodePicks, fightPicks, playRound, startPicks, whyNot, type PickRound } from "./battle/space-picks.ts";
import { aiSpacePick } from "./war/ai.ts";
import { SPACE_ORDERS, VEHICLE_KINDS, other, type BattleResult, type BattleSpec, type Faction, type MatchMode, type Side, type SpaceBattleResult, type SpaceBattleSpec, type SpaceOrder } from "./battle/contract.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// v2 gained the cannon sectors, v3 renamed the factions, v4 had a galaxy per campaign, v5 had
// canyon and jungle sectors and a vehicle pool per battle, v6 was a table with seats and a hero a
// side, v7 can pause on a space hero battle, v8 has cards and a deploy phase.
const SAVE = "two-fronts:v8", ONLINE = "two-fronts:online", SENT = "two-fronts:sent";
const POLL_MS = 5000;

type Game = { kind: "local"; table: Table } | { kind: "online"; link: Online; view: View };

const read = <T>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };

let game: Game = { kind: "local", table: read<{ table: Table }>(SAVE)?.table ?? newTable({ marines: "human", wooka: "ai" }, "short", undefined, true) };
let c: Campaign = game.table.campaign;
let me: Faction = c.player;
let mine: Orders = read<{ orders: Orders }>(SAVE)?.orders ?? { faction: me, orders: [] };
let selected: string | null = null;
// The moves this seat handed in online, to check its retreats against (the server keeps them hidden).
let sent = read<{ id: string; turn: number; orders: Orders }>(SENT);
let busy = false; // a call to the server, or a battle, is under way
let overviewOpen = true;
// While the fleets are being chosen: how many ships and armies this seat has to place.
let loadout: Loadout | null = null;

const online = () => (game.kind === "online" ? game : null);
const hotseat = () => game.kind === "local" && humans(game.table).length === 2;
const waiting = () => (game.kind === "local" ? waitingOn(game.table) : game.view.waiting);
// Whose orders this screen is giving: online, always this seat; at the table, whoever's up.
const seatUp = (): Faction => (game.kind === "online" ? game.view.seat : waitingOn(game.table)[0] ?? c.player);
const save = () => {
  if (game.kind === "local") write(SAVE, { table: game.table, orders: mine });
  else write(ONLINE, { ...game.link, draft: { turn: c.turn, orders: mine } });
};
// What this seat sees: the enemy's numbers only where it has someone to count them. Online, the
// server has done that already.
const seen = () => (game.kind === "local" ? fogged(c, me) : c);
// This seat's moves this turn, while the attacks wait on retreats.
const ownMoves = (): Orders | null => {
  if (game.kind === "local") return game.table.moves?.find((m) => m.faction === me) ?? null;
  return sent && sent.id === game.link.id && sent.turn === c.turn && sent.orders.faction === me ? sent.orders : null;
};
const sameWhere = (a: Where, b: Where) => a.system === b.system && a.sector === b.sector;
const myTurn = () => !c.winner && !c.pending && waiting().includes(me);
const deploying = () => !!c.deploying && myTurn();
const CARD_ICONS: Record<Card, string> = { guns: "crosshair", troops: "shield-plus", trap: "bomb" };
const CARD_TIPS: Record<Card, string> = {
  guns: "Weapon upgrade: every die your side rolls defending this sector is a d8, until it's taken",
  troops: `Muster: free armies here, one for every two you have on this world already (${MUSTER_MIN} at least, ${MUSTER_MAX} at most)`,
  trap: "Trap: blows up half of whatever attacks here this turn, and everyone of yours there with it. For a place you hold with one army or ship",
};

const systemDef = (id: string) => galaxyOf(c).system(id), neighbours = (id: string) => galaxyOf(c).neighbours(id);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const placeName = (w: Where) => {
  const d = systemDef(w.system);
  if (w.sector === ORBIT) return `${d.name} · Orbit`;
  return d.sectors.length > 1 ? `${d.name} · ${SECTOR_NAMES[d.sectors[w.sector]!]}` : d.name;
};
// A move into the enemy's ground or orbit is an attack, and says so.
const attacking = (o: Order) => {
  if (o.kind === "build" || o.kind === "card" || o.kind === "bombard") return false;
  const foe = enemy(me), s = c.systems[o.kind === "fleet" ? o.to : o.to.system]!;
  return o.kind === "fleet" ? s.orbit === foe || s.sectors.some((x) => x.owner === foe) : s.sectors[o.to.sector]!.owner === foe;
};
const describe = (o: Order) => (attacking(o) ? "Attack: " : "") + (
  o.kind === "build" ? `Build ${o.unit === "fleet" ? "a ship" : "an army"} at ${placeName(o.at)}`
  : o.kind === "card" ? `${CARD_NAMES[o.card]} at ${placeName(o.at)}`
  : o.kind === "bombard" ? `Bombard ${placeName(o.at)} with ${o.count} ${o.count === 1 ? "ship" : "ships"}`
  : o.kind === "fleet" ? `${o.count} ${o.count === 1 ? "ship" : "ships"}: ${systemDef(o.from).name} → ${systemDef(o.to).name}`
  : `${o.count} ${o.count === 1 ? "army" : "armies"}: ${placeName(o.from)} → ${placeName(o.to)}`);

// Queues an order (or in the deploy phase, a deploy) if the rules take it, and says why not if they don't.
function order(o: Order) {
  if (c.deploying) {
    const deploys = [...(mine.deploys ?? []), o], err = planDeploys(c, me, deploys).errors.at(-1);
    if (err) return flash(err);
    mine.deploys = deploys;
    save(); render(); return;
  }
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
  const moving = deploying(), foe = enemy(me), g = online(), answering = !!c.attacks || !!c.deploying;
  // Before the war, the map shows this seat's fleet where it has put it.
  const v = c.setup && mine.deployment ? deploy(seen(), me, mine.deployment) : seen();
  const draft = moving ? planDeploys(c, me, mine.deploys ?? []).c : planOrders(c, [mine]).c;
  $("map").innerHTML = drawMap(v, moving ? mine.deploys ?? [] : mine.orders, selected, mine.hero, { me, attacks: c.attacks ?? [], retreats: mine.retreats ?? [] });
  const share = keyShare(c, me), gx = galaxyOf(c);
  const count = (f: Faction) => Object.values(v.systems).reduce((n, s) => ({ armies: n.armies + s.sectors.reduce((a, x) => a + x.armies[f], 0), ships: n.ships + s.fleets[f] }), { armies: 0, ships: 0 });
  const forces = count(me), held = gx.regions.filter((r) => regionHolder(c, r.id) === me).length;
  // The bar along the top of the map: what this side has to spend and to fight with.
  $("topbar").innerHTML = `
    <span class="res" title="Credits now, and next turn's income">${icon("coins")}<b>${draft.credits[me]}</b><small>+${income(c, me)}</small></span>
    <span class="res score" title="War score: key sectors held (capitals and spaceports). Hold 75% to win; fall under 30% and your income halves.">${icon("flag")}
      <span class="war"><i class="marines" style="width:${keyShare(c, "marines") * 100}%"></i><i class="wooka" style="width:${keyShare(c, "wooka") * 100}%"></i></span><b>${Math.round(share * 100)}%</b></span>
    <span class="res" title="Your armies">${icon("users")}<b>${forces.armies}</b></span>
    <span class="res" title="Your ships">${icon("rocket")}<b>${forces.ships}</b></span>
    <span class="res" title="Regions you hold every capital in">${icon("map")}<b>${held}</b><small>/${gx.regions.length}</small></span>
    ${CARDS.map((k) => ({ k, n: handOf(draft, me).filter((x) => x === k).length })).filter((h) => h.n).map((h) => `<span class="res card" title="In your hand: ${CARD_TIPS[h.k]}">${icon(CARD_ICONS[h.k])}<b>${h.n}</b></span>`).join("")}
    <span class="res${heroReady(c, me) ? "" : " bad"}" title="${heroReady(c, me) ? `Your hero, level ${c.heroes[me].level}` : `Your hero is wounded until turn ${c.heroes[me].woundedUntil}`}">${icon("swords")}<b>${heroReady(c, me) ? `Lv ${c.heroes[me].level}` : `T${c.heroes[me].woundedUntil}`}</b></span>`;
  // The overview: every world you hold ground on, with what you have there.
  const fed = supplied(c, me);
  const worlds = gx.systems.filter((d) => v.systems[d.id]!.sectors.some((x) => x.owner === me) || v.systems[d.id]!.fleets[me]);
  $("overview").innerHTML = `<button type="button" id="overview-toggle" class="ov-head" title="${overviewOpen ? "Hide" : "Show"} your worlds">Overview <small>${worlds.length}</small>${icon("chevron-down", 14)}</button>
    ${overviewOpen ? `<ul>${worlds.map((d) => {
      const s = v.systems[d.id]!, armies = s.sectors.reduce((a, x) => a + x.armies[me], 0), foeOrbit = s.orbit === enemy(me);
      return `<li data-system="${d.id}" class="${selected === d.id ? "on" : ""}">
        <span class="ov-name">${d.name}${armies && !fed.has(d.id) ? `<i class="ov-warn" title="Cut off from supply">${icon("unplug", 12)}</i>` : ""}${foeOrbit ? `<i class="ov-warn" title="Blockaded: the enemy holds the orbit">!</i>` : ""}</span>
        <span class="ov-dots">${s.sectors.map((x) => `<i class="dot ${x.owner}" title="${SECTOR_NAMES[x.kind]}"></i>`).join("")}</span>
        <span class="ov-n" title="Your armies here">${icon("users", 12)}${armies}</span>
        <span class="ov-n" title="Your ships here">${icon("rocket", 12)}${s.fleets[me]}</span></li>`;
    }).join("")}</ul>` : ""}`;
  $("turn-n").textContent = `Turn ${c.turn}`;
  $("status").innerHTML = `
    ${phases()}
    ${reinforcements()}
    ${g || hotseat() ? `<div class="row small seat"><span><i class="dot ${me}"></i>${g ? "Online" : "Hotseat"}: ${FACTION_NAMES[me]}</span>
      ${g ? `<span>${waitingLine()}</span>${g.link.invite ? `<button type="button" id="invite" class="icon-btn" title="The other side's link" aria-label="The other side's link">${icon("link")}</button>` : ""}` : ""}</div>` : ""}`;

  // The selected system: what's there, and what you can order.
  let html = `<p class="hint">Pick a world on the map.</p>`;
  if (selected) {
    const d = systemDef(selected), s = v.systems[selected]!, ds = draft.systems[selected]!;
    // Their numbers, or a question mark where nobody of ours is here to count them.
    const theirs = (n: number, there: boolean) => (s.fog && there ? "?" : n);
    const opts = (n: number) => Array.from({ length: n }, (_, i) => `<option${i === n - 1 ? " selected" : ""}>${i + 1}</option>`).join("");
    const can = (o: Order) => planOrders(c, [{ ...mine, orders: [...mine.orders, o] }]).errors.at(-1);
    // One hero battle a turn: a sector's ground battle, or the space battle over the system.
    const heroButton = (sector: number, title: string) => {
      const on = mine.hero?.system === selected && mine.hero.sector === sector;
      return `<button type="button" class="hero${on ? " on" : ""}" data-hero="${sector}" ${heroReady(c, me) ? "" : "disabled"} title="${heroReady(c, me) ? title : "Your hero is wounded"}" aria-label="Hero battle">${icon("swords", 15)}</button>`;
    };
    const btn = (label: string, o: Order, extra = "") => {
      const err = can(o);
      return `<button type="button" data-order="${esc(JSON.stringify(o))}" ${err ? `disabled title="${esc(err)}"` : ""} ${extra}>${label}</button>`;
    };
    // A button per card in hand that can go here, the card's icon with its rules as the tooltip.
    const cardButtons = (at: Where, kinds: Card[]) => kinds.filter((k) => handOf(draft, me).includes(k))
      .map((k) => btn(icon(CARD_ICONS[k], 15), { kind: "card", card: k, at }, `class="build card" title="${CARD_TIPS[k]}" aria-label="Play ${CARD_NAMES[k]}"`)).join("");
    // A send row: what's moving, how many, an arrow, where to, and a send button.
    const sendRow = (what: string, n: string, to: string, go: string) =>
      `<div class="act send"><span class="what">${what}</span>${n}${icon("arrow-right", 14)}${to}${go}</div>`;
    const goBtn = (attr: string, title: string) => `<button type="button" class="icon-btn go" ${attr} title="${title}" aria-label="${title}">${icon("send", 15)}</button>`;
    const note = (text: string, warn = false) => `<p class="note${warn ? " warn" : ""}">${icon(warn ? "triangle-alert" : "info", 14)}<span>${text}</span></p>`;
    const targets: Where[] = [
      ...s.sectors.map((_, i) => ({ system: selected!, sector: i })),
      ...neighbours(selected).flatMap((n) => c.systems[n]!.sectors.map((_, i) => ({ system: n, sector: i }))),
    ];
    const idle = idleShips(draft, ds)[me];
    // Their fleet gone and the sky ours: train ships on a garrison below, before the landings.
    const bombardable = (i: number) => !c.setup && !answering && s.orbit === me && !s.fleets[foe] && s.sectors[i]!.owner === foe && ds.sectors[i]!.armies[foe] > 0 && idle > 0;
    html = `<div class="sys-head"><h2>${d.name}</h2><span class="small">${galaxyOf(c).regions.find((r) => r.id === d.region)?.name ?? ""}</span></div>
      <div class="orbit-row"><span title="Orbit held by ${s.orbit ? FACTION_NAMES[s.orbit] : "nobody"}">${icon("orbit", 15)}<i class="dot ${s.orbit ?? ""}"></i></span>
        <span class="count" title="Ships here: yours, then theirs">${icon("rocket", 14)}<b class="${me}">${s.fleets[me]}</b><b class="${foe}">${theirs(s.fleets[foe], s.orbit === foe)}</b></span>
        ${musterCount(s, theirs)}
        ${heroButton(ORBIT,"Fly the space battle here yourself, if one happens this turn")}</div>
      ${s.sectors.some((x) => x.armies[me]) && !supplied(c, me).has(selected) ? note("Cut off: your armies here lose one a turn. Clear the enemy orbit on the way back to a capital.", true) : ""}
      ${s.sectors.some((_, i) => bombardable(i)) ? note("Their fleet is gone. Train your ships on a garrison below: each kills an army before the landings, half as many through a shield. Ships that bombard don't sail.") : ""}
      ${s.sectors.some((x) => x.kind === "cannon") ? note("The cannon knocks a ship a turn out of an enemy fleet in orbit.") : ""}
      ${s.sectors.some((x) => x.kind === "canyon") ? note("The canyon's ore pays like a capital.") : ""}
      ${s.sectors.some((x) => x.kind === "jungle") ? note("The jungle's holder defends it as if they held the orbit.") : ""}
      ${idle && !answering ? sendRow(icon("rocket", 15), `<select id="ship-n" title="Ships to send">${opts(idle)}</select>`,
        `<select id="ship-to" title="Send them to">${neighbours(selected).map((n) => `<option value="${n}">${systemDef(n).name}</option>`).join("")}</select>`,
        goBtn('id="send-ships"', "Send the ships")) : ""}
      ${moving && ds.orbit === me && ds.fleets[me] > 1 && neighbours(selected).some((n) => draft.systems[n]!.orbit === me) ? sendRow(icon("rocket", 15), `<select id="ship-n" title="Ships to move">${opts(ds.fleets[me] - 1)}</select>`,
        `<select id="ship-to" title="Move them to">${neighbours(selected).filter((n) => draft.systems[n]!.orbit === me).map((n) => `<option value="${n}">${systemDef(n).name}</option>`).join("")}</select>`,
        goBtn('id="send-ships"', "Move the ships")) : ""}
      ${s.orbit === me && !answering ? `<div class="act">${cardButtons({ system: selected, sector: ORBIT }, ["trap"])}</div>` : ""}
      <ul class="sectors">${s.sectors.map((x, i) => {
        const at = { system: selected!, sector: i }, here = ds.sectors[i]!;
        const builds = x.owner === me && !answering ? [
          (x.kind === "spaceport" || (x.kind === "capital" && !s.sectors.some((y) => y.kind === "spaceport"))) && btn(`${icon("plus", 13)}${icon("rocket", 15)}<small>${icon("coins", 12)}${COST.fleet}</small>`, { kind: "build", unit: "fleet", at }, `class="build" title="Build a ship for ${COST.fleet} credits" aria-label="Build a ship"`),
          x.kind === "capital" && btn(`${icon("plus", 13)}${icon("users", 15)}<small>${icon("coins", 12)}${COST.army}</small>`, { kind: "build", unit: "army", at }, `class="build" title="Raise an army for ${COST.army} credits" aria-label="Raise an army"`),
          cardButtons(at, CARDS),
        ].filter(Boolean).join("") : "";
        // In the deploy phase: move what's spare (all but one) to a place you hold, here or next door.
        const deployTo = moving && x.owner === me && here.armies[me] > 1 ? targets.filter((t) => !sameWhere(t, at) && draft.systems[t.system]!.sectors[t.sector]!.owner === me && !planDeploys(draft, me, [{ kind: "army", from: at, to: t, count: 1 }]).errors[0]) : [];
        return `<li>
          <div class="sector"><i class="dot ${x.owner}"></i><b>${SECTOR_NAMES[x.kind]}</b>${x.guns ? `<i class="mark" title="Upgraded guns: its holder rolls d8s defending it">${icon("crosshair", 13)}</i>` : ""}${(v.traps ?? []).some((t) => sameWhere(t.at, at)) ? `<i class="mark" title="Your trap is set here">${icon("bomb", 13)}</i>` : ""}
            <span class="count armies" title="Armies here: Marines, then Wooka">${icon("users", 14)}<b class="marines">${foe === "marines" ? theirs(x.armies.marines, x.owner === foe) : x.armies.marines}</b><b class="wooka">${foe === "wooka" ? theirs(x.armies.wooka, x.owner === foe) : x.armies.wooka}</b></span>
            ${heroButton(i, "Play the battle here yourself, if one happens this turn")}</div>
          ${builds ? `<div class="act">${builds}</div>` : ""}
          ${bombardable(i) ? `<div class="act send"><span class="what">${icon("flame", 15)}</span><select data-bomb-n="${i}" title="Ships to train on this sector">${opts(idle)}</select>${goBtn(`data-bombard="${i}"`, "Bombard from orbit: each ship kills an army here, half as many through a shield")}</div>` : ""}
          ${here.armies[me] && x.owner === me && !answering ? sendRow(icon("users", 15), `<select data-army-n="${i}" title="Armies to send">${opts(here.armies[me])}</select>`,
            `<select data-army-to="${i}" title="Send them to">${targets.filter((t) => !(t.system === selected && t.sector === i)).map((t) => `<option value="${t.system}:${t.sector}">${placeName(t)}</option>`).join("")}</select>`,
            goBtn(`data-army-go="${i}"`, "Send the armies")) : ""}
          ${deployTo.length ? sendRow(icon("users", 15), `<select data-army-n="${i}" title="Armies to move">${opts(here.armies[me] - 1)}</select>`,
            `<select data-army-to="${i}" title="Move them to">${deployTo.map((t) => `<option value="${t.system}:${t.sector}">${placeName(t)}</option>`).join("")}</select>`,
            goBtn(`data-army-go="${i}"`, "Move the armies")) : ""}
        </li>`;
      }).join("")}</ul>`;
  }
  $("detail").innerHTML = c.setup ? setupPanel(v) : (c.attacks && myTurn() ? retreatPanel() : "") + html;

  const rs = mine.retreats ?? [], ds = mine.deploys ?? [];
  $("orders").innerHTML = c.setup
    ? `<li class="hint">${myTurn() ? "Choose a fleet, place it on your worlds, then deploy." : "Your fleet is in place."}</li>`
    : c.deploying
    ? ds.length
      ? ds.map((o, i) => `<li>Move ${describe(o)} <button type="button" class="x" data-drop-deploy="${i}" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>`).join("")
      : `<li class="hint">${moving ? "Staying put. Move troops into what you took, or up to the front." : "Waiting for the deploys."}</li>`
    : answering
    ? rs.length
      ? rs.map((r, i) => `<li>${r.kind === "calloff" ? `Call off the attack on ${placeName(r.to)}` : `Pull out of ${placeName(r.from)} to ${placeName(r.to)}`} <button type="button" class="x" data-drop-retreat="${i}" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>`).join("")
      : `<li class="hint">${myTurn() ? "Holding everywhere. Pull out where you'd rather not fight, or call an attack off." : "Your moves are in."}</li>`
    : mine.orders.length || mine.hero
    ? `${mine.orders.map((o, i) => `<li>${describe(o)} <button type="button" class="x" data-drop="${i}" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>`).join("")}
       ${mine.hero ? `<li class="hero-order">${icon("swords", 14)} Hero ${mine.hero.sector === ORBIT ? "flies" : "leads"} at ${placeName(mine.hero)} <button type="button" class="x" data-drop="hero" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>` : ""}`
    : `<li class="hint" title="Build, send ships to take an orbit, land armies under it, and pick one battle to lead with the swords button">No orders yet.</li>`;
  $("log").innerHTML = c.log.map((l) => `<li>${esc(l)}</li>`).join("");
  const end = $("end-turn");
  end.toggleAttribute("disabled", busy || !myTurn() || (!!c.setup && !loadout));
  end.innerHTML = (c.setup && myTurn() ? "Deploy fleet" : moving ? (ds.length ? "Confirm moves" : "Stay put")
    : answering && myTurn() ? (rs.length ? "Confirm retreats" : "Hold everywhere")
    : g ? (myTurn() ? "Send orders" : waitingLine()) : hotseat() ? "Hand in orders" : "Next turn") + icon("chevrons-right", 18);
  if (c.winner) showModal(`<h2>${hotseat() ? `${FACTION_NAMES[c.winner]} win` : c.winner === me ? "Victory" : "Defeat"}</h2><p>${FACTION_NAMES[c.winner]} wins the war on turn ${c.turn - 1}.</p><button type="button" id="new-war" class="primary">New campaign</button>`);
}

// A world's muster force, yours then theirs: the armies on it, which feed the space battle over it.
// Theirs is a question mark where nobody of ours is there to count it.
function musterCount(s: Campaign["systems"][string], theirs: (n: number, there: boolean) => number | string) {
  const foe = enemy(me), mine = musterOf(s, me), their = musterOf(s, foe);
  const tip = `Muster force: armies on this world, yours then theirs. In the space battle over it they send boarding parties up, and a bigger muster boards harder; batteries below (yours: ${mine.batteries}) add to a screen or a bombardment. A muster card raises more where it's bigger.`;
  return `<span class="count" title="${esc(tip)}">${icon("shield-plus", 14)}<b class="${me}">${mine.troops}</b><b class="${foe}">${theirs(their.troops, s.sectors.some((x) => x.owner === foe || x.armies[foe] > 0))}</b></span>`;
}

// Once the attacks are declared: each one against you, with where you could pull back to, and
// each of yours, which you can call off. Nobody sees how many are coming.
function retreatPanel() {
  const attacks = c.attacks ?? [], foe = enemy(me), own = ownMoves(), rs = mine.retreats ?? [];
  const after = planOrders(c, [own ?? { faction: me, orders: [] }]).c, g = galaxyOf(c);
  const key = (w: Where) => `${w.system}:${w.sector}`;
  const group = (list: Attack[]) => [...new Map(list.map((a) => [key(a.to), list.filter((b) => sameWhere(b.to, a.to))])).values()];
  const touched = (w: Where) => w.sector === ORBIT ? after.systems[w.system]!.fleets[me] > 0 : after.systems[w.system]!.sectors[w.sector]!.armies[me] > 0;
  const fits = (r: Retreat) => !own || !checkRetreats(c, own, [...rs, r]).at(-1);
  const from = (list: Attack[]) => list.map((a) => systemDef(a.from).name).join(", ");
  const against = group(attacks.filter((a) => a.faction === foe && touched(a.to))).map((list) => {
    const to = list[0]!.to, out = rs.find((r) => r.kind === "withdraw" && sameWhere(r.from, to));
    const places: Where[] = to.sector === ORBIT
      ? g.neighbours(to.system).map((n) => ({ system: n, sector: ORBIT }))
      : [to.system, ...g.neighbours(to.system)].flatMap((id) => c.systems[id]!.sectors.map((_, i) => ({ system: id, sector: i })));
    const options = out ? [] : places.filter((p) => fits({ kind: "withdraw", from: to, to: p }));
    return `<li><div><b>${placeName(to)}</b> <span class="small">from ${from(list)}, strength unknown</span></div>
      ${out ? `<div class="small">Pulling out to ${placeName(out.to)}</div>`
        : options.length ? `<div class="act"><select data-withdraw-to="${key(to)}">${options.map((p) => `<option value="${key(p)}">${placeName(p)}</option>`).join("")}</select>
          <button type="button" data-withdraw="${key(to)}">Pull out</button></div>` : `<div class="small">Nowhere to pull back to: they stand.</div>`}</li>`;
  }).join("");
  const ours = group(attacks.filter((a) => a.faction === me)).map((list) => {
    const to = list[0]!.to, off = rs.some((r) => r.kind === "calloff" && sameWhere(r.to, to));
    return `<li><div><b>${placeName(to)}</b> <span class="small">from ${from(list)}</span></div>
      ${off ? `<div class="small">Called off</div>` : `<div class="act"><button type="button" data-calloff="${key(to)}">Call it off</button></div>`}</li>`;
  }).join("");
  return `<div class="attacks"><h2>Attacks declared</h2>
    ${against ? `<h3>Against you</h3><ul class="sectors">${against}</ul>` : ""}
    ${ours ? `<h3>Yours</h3><ul class="sectors">${ours}</ul>` : ""}
    <p class="small">Hold, and the fight happens. Pull out, and the ground is theirs but your troops live.</p></div>`;
}

// The turn's six phases, the one we're in lit: draw and place happen with the orders, declare
// while the retreats are out, combat while a hero battle waits, deploy after the fighting, and
// collect at the turn's end.
function phases() {
  const now = c.setup ? -1 : c.pending ? 3 : c.deploying ? 4 : c.attacks ? 2 : 1;
  const list: [string, string][] = [
    ["layers", "Draw: a card each turn"],
    ["map-pin", "Place: raise troops and ships, then play cards"],
    ["megaphone", "Declare: move, and answer the attacks declared"],
    ["dices", "Combat: cannon barrages. The leader rolls a d8, the rest d6s, highest against highest, ties to the attacker"],
    ["move", "Deploy: move into what you took, and move what's left"],
    ["gift", "Collect: income, region bonuses, and a card for taking 3 or more places"],
  ];
  return `<div class="phases" role="list">${list.map(([name, tip], i) => `<span role="listitem" class="${i === now ? "on" : i < now ? "done" : ""}" title="${tip}">${icon(name, 14)}</span>`).join("")}</div>`;
}

// Next turn's income, counted out like reinforcements: sectors, each region held, broken morale.
function reinforcements() {
  const b = incomeBreakdown(c, me);
  return `<details class="reinf"><summary title="Next turn's income: show where it comes from">${icon("coins")}<b>+${b.total}</b><span>next turn</span>${b.morale ? `<i class="bad" title="Morale broken">${icon("triangle-alert", 14)}</i>` : ""}${icon("chevron-down", 14)}</summary><ul>
    <li><span>Sectors held</span><b>+${b.sectors}</b></li>
    ${b.regions.map((r) => `<li><span>${esc(r.name)} held</span><b>+${r.bonus}</b></li>`).join("")}
    ${b.morale ? `<li class="bad"><span>Morale broken</span><b>${b.morale}</b></li>` : ""}
    </ul></details>`;
}

function waitingLine() {
  if (c.winner) return "The war is over";
  const h = heroFaction(c);
  if (h) return h === me ? "Your hero battle" : `${FACTION_NAMES[h]} are fighting a hero battle`;
  if (waiting().includes(me)) return c.setup ? "Place your fleet" : c.deploying ? "Deploy" : c.attacks ? "Answer the attacks" : "Your move";
  return `Waiting for the ${waiting().map((f) => FACTION_NAMES[f]).join(" and ")}${c.deploying ? " to deploy" : c.attacks ? " to answer the attacks" : ""}`;
}

// Clicks, delegated.
document.addEventListener("click", (e) => {
  // A click on an icon or label inside a button counts as the button.
  const t = ((e.target as HTMLElement).closest?.("button") ?? e.target) as HTMLElement;
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
  if (t.dataset.withdraw) {
    const [system, sector] = document.querySelector<HTMLSelectElement>(`[data-withdraw-to="${t.dataset.withdraw}"]`)!.value.split(":");
    const [fs, fx] = t.dataset.withdraw.split(":");
    mine.retreats = [...(mine.retreats ?? []), { kind: "withdraw", from: { system: fs!, sector: +fx! }, to: { system: system!, sector: +sector! } }];
    save(); render(); return;
  }
  if (t.dataset.calloff) {
    const [system, sector] = t.dataset.calloff.split(":");
    mine.retreats = [...(mine.retreats ?? []), { kind: "calloff", to: { system: system!, sector: +sector! } }];
    save(); render(); return;
  }
  if (t.dataset.dropRetreat) { mine.retreats?.splice(+t.dataset.dropRetreat, 1); save(); render(); return; }
  if (t.dataset.dropDeploy) { mine.deploys?.splice(+t.dataset.dropDeploy, 1); save(); render(); return; }
  if (t.dataset.bombard) {
    const i = t.dataset.bombard;
    return order({ kind: "bombard", at: { system: selected!, sector: +i }, count: +document.querySelector<HTMLSelectElement>(`[data-bomb-n="${i}"]`)!.value });
  }
  if (t.dataset.preset) return chooseFleet(t.dataset.preset as PresetId);
  if (t.dataset.custom) {
    const [kind, by] = t.dataset.custom.split(":") as ["ships" | "armies", string], l = { ...(loadout ?? loadoutOf(c, me, "line")) };
    l[kind] = Math.max(0, l[kind] + +by);
    if (room(c, me, l) < 0) return;
    loadout = l;
    return pickFleet();
  }
  if (t.id === "custom-go") { chooseFleet(loadout ?? loadoutOf(c, me, "line")); return; }
  if (t.id === "change-fleet") { loadout = null; return pickFleet(); }
  if (t.id === "auto-place") { if (loadout) { mine.deployment = placeLoadout(c, me, loadout); save(); render(); } return; }
  if (t.dataset.place) return placeUnit(t.dataset.place);
  if (t.id === "end-turn") return endTurn();
  if (t.id === "overview-toggle") { overviewOpen = !overviewOpen; render(); return; }
  if (t.id === "new-war" || t.id === "restart") return chooseGame();
  if (t.dataset.start) return startGame(t.dataset.start as "ai" | "hotseat" | "online");
  if (t.id === "invite") return showInvite();
  if (t.id === "copy-link") { void navigator.clipboard?.writeText($<HTMLInputElement>("seat-link").value); flash("Link copied"); return; }
  if (t.id === "pass-on") { hideModal(); return afterTurn(); }
  if (t.id === "close") { hideModal(); if (c.setup) afterTurn(); }
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
    useGame({ kind: "local", table: newTable(seats, galaxy, undefined, true) });
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
  // Moves before the attacks are declared, retreats after, and deploys after the fighting.
  mine = c.deploying ? { faction: me, orders: [], deploys: mine.deploys ?? [] }
    : c.attacks ? { faction: me, orders: [], retreats: mine.retreats ?? [], ...(mine.hero && { hero: mine.hero }) }
    : { faction: me, orders: mine.orders, ...(mine.hero && { hero: mine.hero }), ...(c.setup && mine.deployment && { deployment: mine.deployment }) };
  loadout = c.setup && mine.deployment ? totals(mine.deployment) : null;
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
    if (!c.attacks && !c.deploying) write(SENT, (sent = { id: g.link.id, turn: c.turn, orders: structuredClone(mine) }));
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
  if (c.attacks && myTurn()) flash("Attacks declared: hold, or pull back");
  if (c.deploying && myTurn()) flash("Deploy: move into what you took");
  afterTurn();
}

function passTo(f: Faction) {
  const battle = heroFaction(c) === f;
  showModal(`<h2>${FACTION_NAMES[f]}, you're up</h2>
    <p>${battle ? "Your hero has a battle to fight." : c.setup ? "Choose a fleet and place it." : c.deploying ? "The fighting's over. Move into what you took, and move what's left." : c.attacks ? "The attacks are declared. Decide where to stand and where to pull back." : `Turn ${c.turn}: give your orders.`} Hand the screen over.</p>
    <button type="button" id="pass-on" class="primary">I'm the ${FACTION_NAMES[f]}</button>`);
}

// --- Choosing and placing a fleet ---

// The first thing a war asks: which fleet. A preset, or a mix of your own, from a pool of value.
function pickFleet() {
  const l = loadout ?? loadoutOf(c, me, "line"), pool = c.pool?.[me] ?? 0, left = room(c, me, l);
  const stepper = (kind: "ships" | "armies", name: string, ico: string, cost: number) => `<span class="stepper" title="${name}: ${cost} each">${icon(ico, 15)}
    <button type="button" class="icon-btn" data-custom="${kind}:-1" aria-label="Fewer ${name}" ${l[kind] ? "" : "disabled"}>${icon("minus", 13)}</button><b>${l[kind]}</b>
    <button type="button" class="icon-btn" data-custom="${kind}:1" aria-label="More ${name}" ${left >= cost ? "" : "disabled"}>${icon("plus", 13)}</button></span>`;
  showModal(`<h2>Choose your fleet</h2>
    <ol class="steps"><li><b>Choose</b> a fleet to fight with.</li><li><b>Place</b> it on your worlds. Where you put it is the opening move.</li>
      <li><b>Fight</b>: each turn give orders at once with the other side. Moving into enemy space is an attack. Win the sky over a world and you can bombard its garrison; hold the ground to win the war.</li></ol>
    <div class="presets">${PRESET_IDS.map((id) => {
      const p = PRESETS[id], x = loadoutOf(c, me, id);
      return `<button type="button" class="preset" data-preset="${id}" title="${esc(p.blurb)}"><span class="p-name">${icon(p.icon, 16)}${p.name}</span>
        <span class="p-mix"><span>${icon("rocket", 13)}${x.ships}</span><span>${icon("users", 13)}${x.armies}</span></span><span class="small">${p.blurb}</span></button>`;
    }).join("")}</div>
    <div class="custom"><b>Your own</b>${stepper("ships", "Ships", "rocket", COST.fleet)}${stepper("armies", "Armies", "users", COST.army)}
      <span class="small" title="What you don't spend goes to the treasury">${icon("coins", 13)} ${left} of ${pool} left</span>
      <button type="button" id="custom-go" class="primary">Use this fleet</button></div>`);
  $("modal-body").classList.add("wide");
}

// Takes the loadout and puts it down as the preset (or an even spread) would, to adjust from.
function chooseFleet(from: PresetId | Loadout) {
  const preset = typeof from === "string" ? from : null;
  loadout = preset ? loadoutOf(c, me, preset) : from as Loadout;
  mine.deployment = preset ? presetDeployment(c, me, preset) : placeLoadout(c, me, loadout);
  hideModal();
  save(); render();
}

// The setup panel: where the fleet stands, and +/- on the selected world to move it about.
function setupPanel(v: Campaign): string {
  const step = (n: number, text: string) => `<p class="step"><b>Step ${n} of 2</b> ${text}</p>`;
  if (!waiting().includes(me)) return step(2, "Your fleet is in place. Waiting for the other side to place theirs.");
  if (!loadout) return `${step(1, "Choose your fleet.")}<p><button type="button" id="change-fleet" class="primary">${icon("rocket", 15)} Choose a fleet</button></p>`;
  const d = mine.deployment ?? emptyDeployment(), placed = totals(d), left = { ships: loadout.ships - placed.ships, armies: loadout.armies - placed.armies };
  const gx = galaxyOf(c), mineHere = selected && v.systems[selected]!.sectors.some((x) => x.owner === me);
  const stepBtns = (key: string, n: number, canAdd: boolean) => `<button type="button" class="icon-btn" data-place="${key}:-1" ${n ? "" : "disabled"} aria-label="Remove one">${icon("minus", 13)}</button><b>${n}</b>
    <button type="button" class="icon-btn" data-place="${key}:1" ${canAdd ? "" : "disabled"} aria-label="Add one">${icon("plus", 13)}</button>`;
  const sys = mineHere ? (() => {
    const id = selected!, s = v.systems[id]!;
    return `<div class="sys-head"><h2>${gx.system(id).name}</h2></div>
      <div class="act place"><span class="what" title="Ships over ${gx.system(id).name}">${icon("rocket", 15)}</span>${stepBtns(`ships:${id}`, d.ships[id] ?? 0, left.ships > 0)}</div>
      <ul class="sectors">${s.sectors.map((x, i) => x.owner !== me ? "" : `<li><div class="sector"><i class="dot ${x.owner}"></i><b>${SECTOR_NAMES[x.kind]}</b></div>
        <div class="act place"><span class="what" title="Armies on this sector">${icon("users", 15)}</span>${stepBtns(`armies:${id}:${i}`, d.armies[`${id}:${i}`] ?? 0, left.armies > 0)}</div></li>`).join("")}</ul>`;
  })() : `<p class="hint">Pick one of your worlds on the map to move ships and armies onto it.</p>`;
  return `${step(2, "Place your fleet. Everything on the front hits first; everything at the back holds out longest.")}
    <div class="loadout"><span title="Ships still to place">${icon("rocket", 15)}<b>${left.ships}</b> to place</span><span title="Armies still to place">${icon("users", 15)}<b>${left.armies}</b> to place</span>
      <button type="button" id="auto-place" class="icon-btn" title="Spread them out again" aria-label="Spread them out again">${icon("rotate-ccw", 14)}</button>
      <button type="button" id="change-fleet" class="link" title="Choose a different fleet">Change fleet</button></div>
    ${left.ships || left.armies ? `<p class="small">${icon("coins", 12)} What you don't place goes to the treasury (${valueOf(left)}).</p>` : ""}
    ${sys}`;
}

// A +1 or -1 on a system's ships or a sector's armies in the fleet being placed.
function placeUnit(arg: string) {
  const parts = arg.split(":"), by = +parts.pop()!, kind = parts[0] as "ships" | "armies", key = parts.slice(1).join(":");
  const d = (mine.deployment ??= emptyDeployment()), bag = d[kind], placed = totals(d);
  if (by > 0 && (!loadout || placed[kind] >= loadout[kind])) return;
  bag[key] = Math.max(0, (bag[key] ?? 0) + by);
  if (!bag[key]) delete bag[key];
  save(); render();
}

// --- The end-of-match vote ---

const openVote = (): Vote | null => {
  const v = game.kind === "local" ? game.table.vote : game.view.vote;
  return v && !v.picked ? v : null;
};
let voting = false, putOff: string | null = null; // the vote on screen; one this seat said "Later" to

// After a ground battle, the vote for the next one's mode, if this screen has a vote left to cast.
// Then carry on. Nothing waits on it: a vote nobody finishes leaves the mode as it was.
function voteIfOpen(then: () => void) {
  const v = openVote();
  const here = (f: Faction) => (game.kind === "local" ? game.table.seats[f] === "human" : game.view.seat === f);
  if (!v || voting || putOff === v.match || !FACTIONS.some((f) => here(f) && !v.votes[f])) return then();
  const g = online();
  const seatOf = (f: Faction) => (game.kind === "local" ? game.table.seats[f] : game.view.seats[f]);
  const seats: VoteSeat[] = FACTIONS.map((f) => ({ faction: f, who: here(f) ? "here" : seatOf(f) === "ai" ? "ai" : "away", ...(v.votes[f] && { vote: v.votes[f] }) }));
  voting = true;
  const sock = g ? pointerSocket(g.link, (m) => {
    if (m.t === "at" && m.seat !== g.view.seat) screen.point(m.seat, m.x, m.y);
    if (m.t === "vote" && m.vote?.match === v.match) { g.view.vote = m.vote; screen.update(m.vote.votes, m.vote.picked); }
  }) : null;
  const screen = voteScreen($("vote"), {
    title: "Next match",
    text: "Everyone gets one vote for how the next ground battle is fought.",
    seats,
    moved: sock ? (x, y) => sock.at(x, y) : undefined,
    cast(f, mode) {
      if (g) {
        sendVote(g.link, v.match, mode).then((view) => { g.view = view; c = view.campaign; if (view.vote) screen.update(view.vote.votes, view.vote.picked); })
          .catch((e) => flash((e as Error).message));
        return;
      }
      if (game.kind !== "local") return;
      const step = castVote(game.table, f, v.match, mode);
      if (!step.ok) return flash(step.error);
      game.table = step.table;
      c = game.table.campaign;
      save();
      screen.update(step.table.vote!.votes, step.table.vote!.picked);
    },
    done(picked) {
      voting = false;
      sock?.close();
      if (!picked) putOff = v.match;
      else flash(`Next ground battle: ${MODE_INFO[picked].name}`);
      render();
      then();
    },
  });
}

// After anything moves the turn on: fight our hero battle if it's ours, or wait for the others.
function afterTurn() {
  if (c.winner || busy || voting) return;
  if (c.setup && myTurn() && !loadout) return pickFleet();
  const p = c.pending;
  if (p && heroFaction(c) === me) return p.kind === "space" ? briefSpace(p.spec, finishSpace) : brief(p.spec, finish);
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
    const moved = v.campaign.turn !== c.turn || !!v.campaign.pending !== !!c.pending || !!v.campaign.deploying !== !!c.deploying || v.waiting.join() !== g.view.waiting.join();
    g.view = v;
    if (moved) useGame(g, { turn: c.turn, orders: mine });
  } catch { /* try again next time */ }
  if ($("modal").hidden && !document.body.classList.contains("in-battle")) return voteIfOpen(afterTurn);
  afterTurn();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && online()) void poll(); });

// The hero battle's briefing: what the map has given each side for this fight.
function brief(spec: BattleSpec, done: (r: BattleResult) => void) {
  const me = spec.hero, foe = me === "attacker" ? "defender" : "attacker";
  const horde = spec.factions[foe] === "wooka";
  const vehicles = (s: Side) => {
    if (spec.factions[s] === "wooka") return "none, just more Wooka";
    const list = VEHICLE_KINDS.filter((k) => spec.vehicles[s][k]).map((k) => `${spec.vehicles[s][k]} ${k}${spec.vehicles[s][k]! > 1 ? "s" : ""}`);
    return list.join(", ") || "none";
  };
  const row = (label: string, a: number | string, b: number | string) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
  showModal(`<h2>Hero battle: ${spec.system}, ${SECTOR_NAMES[spec.sector].toLowerCase()}</h2>
    <p class="mode-line">${icon(MODE_INFO[spec.mode ?? "conquest"].icon, 16)}<b>${MODE_INFO[spec.mode ?? "conquest"].name}</b> <span class="small">${MODE_INFO[spec.mode ?? "conquest"].blurb}</span></p>
    <p>You ${me === "attacker" ? "attack" : "defend"} as ${spec.factions[me] === "wooka" ? "a Wooka chieftain. The armoured ones came to hunt. Show them who the forest belongs to" : "a Thunder Marine"}.${spec.mode && spec.mode !== "conquest" ? "" : " Take the command posts and run their tickets out."}</p>
    ${horde ? `<p class="small">${spec.factions[me] === "marines" ? "You are not the hunter here. They know the trees, they know your smell, and they are already in the ferns." : ""}</p><p class="flavor">“${FLAVOR[Math.floor(Math.random() * FLAVOR.length)]}”</p>` : ""}
    <table class="spec"><tr><th></th><td>You</td><td>Enemy</td></tr>
      ${row("Armies", spec.armies[me], spec.armies[foe])}
      ${row("Tickets", spec.tickets[me], spec.tickets[foe])}
      ${row("Vehicles", vehicles(me), vehicles(foe))}
      ${row("Orbital strikes", spec.strikes[me], spec.strikes[foe])}
      ${row("Drop pods", spec.reinforcements[me] ? `+${spec.reinforcements[me]}` : "none", spec.reinforcements[foe] ? `+${spec.reinforcements[foe]}` : "none")}
      ${row("Turrets", me === "defender" ? spec.turrets : 0, me === "attacker" ? spec.turrets : 0)}
    </table>
    <p class="small">Strikes, drop pods and gunships come from holding the orbit, and walkers from holding the world's capital. A shield generator held by the other side cuts strikes to one.</p>
    <button type="button" id="drop-in" class="primary">Drop in</button> <button type="button" id="auto-battle">Let the AI fight it</button>`);
  $("drop-in").onclick = async () => {
    hideModal();
    document.body.classList.add("in-battle");
    const { playBattle } = await import("./battle/view.ts");
    const result = await playBattle(spec, $<HTMLCanvasElement>("battle-view"), $("battle-hud"));
    document.body.classList.remove("in-battle");
    done(result);
  };
  $("auto-battle").onclick = () => { hideModal(); done({ ...run(spec).over!, auto: true }); };
}

// The orders of a pick battle, as the hand shows them.
const ORDER_INFO: Record<SpaceOrder, { name: string; icon: string; tip: string }> = {
  broadside: { name: "Broadside", icon: "zap", tip: "The gun lines fire. Beats boarders crossing the gap, and a fleet bombarding" },
  screen: { name: "Screen", icon: "shield", tip: "Fighters out front. Beats a broadside and a bombardment. Your batteries below add flak" },
  board: { name: "Board", icon: "anchor", tip: "Close in and send troops across. Beats a screen and a bombardment, and takes prize ships. Needs troops below, a big muster boards harder, and a broadside costs half of them" },
  bombard: { name: "Bombard", icon: "flame", tip: "Turn the guns on the world: kills their armies below, twice as many if they pull back or bombard too. But every hit lands, and none goes back" },
  withdraw: { name: "Pull back", icon: "undo-2", tip: "Take half the fire, give none, and come back harder next round. Nobody can board you" },
};

// The space battle's briefing: the fleets over the system and the muster force below. Fight it by
// picking orders (the default), fly it in a fighter, or leave it to the AI.
function briefSpace(spec: SpaceBattleSpec, done: (r: SpaceBattleResult) => void) {
  const me = spec.hero, foe = other(me);
  showModal(`<h2>Space battle: over ${spec.system}</h2>
    <p>You command the ${spec.factions[me] === "wooka" ? "Wooka raft fleet" : "Thunder Marine line"} for the orbit. ${ROUNDS} rounds: each round you pick an order, they pick one, and you see theirs once yours is in. More hull at the end holds the orbit.</p>
    <table class="spec"><tr><th></th><td>You</td><td>Enemy</td></tr>
      <tr><th>${icon("rocket", 13)} Ships</th><td>${spec.fleets[me]}</td><td>${spec.fleets[foe]}</td></tr>
      <tr><th title="Armies on the world below: they board, and a bigger muster boards harder">${icon("shield-plus", 13)} Muster below</th><td>${spec.muster?.[me] ?? 0}</td><td>${spec.muster?.[foe] ?? 0}</td></tr>
      <tr><th title="Cannons, shields and upgraded guns below: they add to a screen or a bombardment">${icon("crosshair", 13)} Batteries below</th><td>${spec.batteries?.[me] ?? 0}</td><td>${spec.batteries?.[foe] ?? 0}</td></tr>
    </table>
    <p class="small">Lose the orbit and the world is blockaded: nothing gets built there, supply through it is cut, their landings come down, and a fleet of two or more bombards the armies below every turn.</p>
    <button type="button" id="fight-picks" class="primary">${icon("swords", 15)} Fight it</button> <button type="button" id="launch" title="Fly a fighter in the battle yourself">${icon("rocket", 15)} Fly it</button> <button type="button" id="auto-battle">Let the AI fight it</button>`);
  $("fight-picks").onclick = () => pickBattle(spec, done);
  $("launch").onclick = async () => {
    hideModal();
    document.body.classList.add("in-battle");
    const { playSpaceBattle } = await import("./battle/space-view.ts");
    const result = await playSpaceBattle(spec, $<HTMLCanvasElement>("battle-view"), $("battle-hud"));
    document.body.classList.remove("in-battle");
    done(result);
  };
  $("auto-battle").onclick = () => { hideModal(); done({ ...fightPicks(spec, [], aiSpacePick)!.over!, auto: true }); };
}

// The pick battle: a round at a time, the hand of orders, the enemy's pick shown once yours is in.
// The result carries the hero's picks, so whoever checks it can fight it again.
function pickBattle(spec: SpaceBattleSpec, done: (r: SpaceBattleResult) => void) {
  const b = startPicks(spec), me = spec.hero, foe = other(me), picks: SpaceOrder[] = [];
  let last: PickRound | null = null;
  const finish = () => { hideModal(); done({ ...b.over!, inputs: encodePicks(picks) }); };
  const fleet = (s: Side) => `<div class="fleet-row"><span class="who"><i class="dot ${spec.factions[s]}"></i>${s === me ? "You" : "Enemy"}</span>
    <span class="hull" title="Hull: ${b.hull[s]}"><i class="${spec.factions[s]}" style="width:${(100 * b.hull[s]) / Math.max(1, b.top[s])}%"></i></span>
    <span class="count" title="Ships still fit to fly">${icon("rocket", 13)}<b>${Math.floor(b.hull[s] / HULL_PER_SHIP)}</b></span>
    <span class="count" title="Muster force below: armies that can board">${icon("shield-plus", 13)}<b>${b.troops[s]}</b></span></div>`;
  const card = (o: SpaceOrder, cls: string) => `<span class="order-card ${cls}" title="${ORDER_INFO[o].tip}">${icon(ORDER_INFO[o].icon, 18)}<span>${ORDER_INFO[o].name}</span></span>`;
  const say = (r: PickRound) => {
    const v = clash(r.picks[me], r.picks[foe]), out: string[] = [];
    if (r.hit[foe]) out.push(`${r.hit[foe]} hull into theirs`);
    if (r.hit[me]) out.push(`${r.hit[me]} into yours`);
    if (r.prizes[me]) out.push(`${r.prizes[me]} taken as prizes`);
    if (r.prizes[foe]) out.push(`${r.prizes[foe]} of yours taken as prizes`);
    if (r.killed[foe]) out.push(`${r.killed[foe]} of their armies below killed`);
    if (r.killed[me]) out.push(`${r.killed[me]} of your armies below killed`);
    if (r.boarders[me]) out.push(`${r.boarders[me]} boarding ${r.boarders[me] === 1 ? "party" : "parties"} lost`);
    return `<p class="verdict ${v}">${v === "win" ? "You read them right." : v === "lose" ? "They read you." : "Neither side has the edge."} ${out.join(", ") || "Nothing hits"}.</p>`;
  };
  const draw = () => {
    const end = b.over && (b.over.winner === me ? `<h3>The orbit is ours</h3>` : `<h3>The orbit is lost</h3>`);
    showModal(`<div class="picks"><h2>Over ${spec.system} <small>${b.over ? "Over" : `Round ${b.round + 1} of ${ROUNDS}`}</small></h2>
      ${fleet(me)}${fleet(foe)}
      ${last ? `<div class="reveal">${card(last.picks[me], "mine")}<span class="vs">vs</span>${card(last.picks[foe], "theirs flip")}</div>${say(last)}` : `<p class="small">Pick an order. They pick at the same moment, and you see theirs once yours is in.</p>`}
      ${end || `<div class="hand">${SPACE_ORDERS.map((o) => {
        const why = whyNot(b, me, o);
        return `<button type="button" class="order" data-pick="${o}" ${why ? `disabled title="${esc(why)}"` : `title="${ORDER_INFO[o].tip}"`}>${icon(ORDER_INFO[o].icon, 20)}<span>${ORDER_INFO[o].name}</span></button>`;
      }).join("")}</div>`}
      ${b.over ? `<button type="button" id="picks-done" class="primary">Back to the war</button>` : `<button type="button" id="picks-ai" class="link">${icon("bot", 14)} Let the AI finish it</button>`}</div>`);
    $("modal-body").classList.add("wide");
    document.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((btn) => (btn.onclick = () => {
      const o = btn.dataset.pick as SpaceOrder;
      // The enemy's pick is made from what it's seen so far, never from this one.
      last = playRound(b, { [me]: o, [foe]: aiSpacePick(b, foe) } as Record<Side, SpaceOrder>);
      picks.push(o);
      draw();
    }));
    if (b.over) $("picks-done").onclick = finish;
    else $("picks-ai").onclick = () => {
      while (!b.over) playRound(b, { [me]: aiSpacePick(b, me), [foe]: aiSpacePick(b, foe) } as Record<Side, SpaceOrder>);
      finish();
    };
  };
  draw();
}

// Hand the hero battle's result to the table, here or in the campaign's Durable Object.
// False if it didn't get through.
async function sendResult(result: BattleResult | SpaceBattleResult, retry: () => void): Promise<boolean> {
  const g = online();
  if (g) {
    busy = true;
    try {
      g.view = await sendBattle(g.link, result);
    } catch (e) {
      showModal(`<h2>The result didn't get through</h2><p>${esc((e as Error).message)}</p><button type="button" id="resend" class="primary">Try again</button>`);
      $("resend").onclick = retry;
      return false;
    } finally {
      busy = false;
    }
    useGame(g);
  } else if (game.kind === "local") {
    const step = report(game.table, me, result);
    if (!step.ok) { flash(step.error); return false; }
    useGame({ kind: "local", table: step.table });
  }
  return true;
}
// The button that closes a result: hand the screen over in hotseat, else back to the map.
const backButton = (f: Faction) => `<button type="button" id="${hotseat() && seatUp() !== f ? "pass-on-after" : "back-to-map"}" class="primary">Back to the map</button>`;

async function finishSpace(result: SpaceBattleResult) {
  if (c.pending?.kind !== "space") return;
  const spec = c.pending.spec, won = result.winner === spec.hero;
  if (!(await sendResult(result, () => void finishSpace(result)))) return;
  // What the orbit meant on the map: the toll below, the blockade, the landings and what they took.
  const after = c.log.filter((l) => l.includes(spec.system) && !l.startsWith("Hero space battle"));
  showModal(`<h2>${won ? "Orbit taken" : "Orbit lost"}</h2>
    <p>${won ? `The orbit over ${spec.system} is ours.` : "The fleet went down fighting."}
      Ships left: ${result.fleets[spec.hero]} to ${result.fleets[other(spec.hero)]}.${result.heroDown ? " Your hero was shot down." : ""}</p>
    ${after.length ? `<ul class="cascade">${after.map((l) => `<li>${icon(won ? "orbit" : "triangle-alert", 14)}<span>${esc(l)}</span></li>`).join("")}</ul>` : ""}
    ${backButton(spec.factions[spec.hero])}`);
}

async function finish(result: BattleResult) {
  if (c.pending?.kind !== "ground") return;
  const spec = c.pending.spec, won = result.winner === spec.hero;
  if (!(await sendResult(result, () => void finish(result)))) return;
  showModal(`<h2>${won ? "Sector taken" : "Sector lost"}</h2>
    <p>${won ? (spec.hero === "attacker" ? `${spec.system}'s ${SECTOR_NAMES[spec.sector].toLowerCase()} is yours.` : "You held the line.") : "The battle went against you."}
      Tickets left: ${result.tickets[spec.hero]} to ${result.tickets[spec.hero === "attacker" ? "defender" : "attacker"]}.${result.heroDown ? " Your hero was carried off the field." : ""}</p>
    ${backButton(spec.factions[spec.hero])}`);
}

// Quick play, outside the campaign, on Doren, the forest moon: the Marines came to hunt and found
// themselves the quarry. Hold the line as a Thunder Marine, or be the horde that stalks them.
function skirmish(asWooka: boolean, mode: MatchMode = "conquest") {
  const spec: BattleSpec = {
    id: `skirmish-${Date.now()}`, turn: 0, system: "Doren", sector: "shield",
    factions: { attacker: "wooka", defender: "marines" }, hero: asWooka ? "attacker" : "defender", heroLevel: 1,
    armies: { attacker: 4, defender: 3 }, tickets: { attacker: 200, defender: 150 },
    vehicles: { attacker: { tank: 1 }, defender: { walker: 1, speeder: 1 } }, strikes: { attacker: 0, defender: 2 },
    reinforcements: { attacker: 0, defender: 30 }, turrets: 2, ...(mode !== "conquest" && { mode }), seed: Math.floor(Math.random() * 2 ** 31),
  };
  brief(spec, (r) => {
    const won = r.winner === spec.hero;
    // The result, and the vote for a rematch against the AI, whose pointer wanders over too.
    const mine = spec.factions[spec.hero], theirs = spec.factions[other(spec.hero)];
    const votes: Partial<Record<Faction, MatchMode>> = { [theirs]: aiVote(spec.id, theirs, mode) };
    const screen = voteScreen($("vote"), {
      title: asWooka ? (won ? "The hunt is over" : "Driven back into the ferns") : won ? "Still breathing" : "Hunted down",
      text: asWooka ? (won ? "The generator is in pieces, the armoured ones are running, and someone is wearing a backpack as a hat." : "The Marines held. The forest remembers their smell.") : won ? "You came to Doren to hunt. You leave knowing what it is to be hunted. They'll be back. They always come back." : "Nobody heard them coming. They got into the backpacks.",
      seats: [{ faction: mine, who: "here" }, { faction: theirs, who: "ai", vote: votes[theirs] }],
      leave: { label: "Back to the map", title: "No rematch" },
      cast(f, m) { votes[f] = m; screen.update(votes, tally(spec.id, votes)); },
      done(picked) { if (picked) skirmish(asWooka, picked); },
    });
  });
}
// The panel's fixed buttons and headings get their icons once.
$("restart").innerHTML = icon("rotate-ccw", 18);
$("hold-line").insertAdjacentHTML("afterbegin", icon("shield", 16));
$("be-horde").insertAdjacentHTML("afterbegin", icon("paw-print", 16));
$("dogfight").innerHTML = icon("rocket", 16);
$("orders-h").insertAdjacentHTML("afterbegin", icon("list-checks", 14));
$("log-h").insertAdjacentHTML("afterbegin", icon("scroll-text", 14));
$("hold-line").onclick = () => skirmish(false);
$("be-horde").onclick = () => skirmish(true);
// Quick play in orbit: three Marine ships hold the orbit over Doren against three Wooka ones,
// with a Marine outpost and its shield below and the Wooka horde in the ferns.
$("dogfight").title = "Quick battle: hold the orbit over Doren, picking orders or flying a fighter";
$("dogfight").onclick = () => {
  const spec: SpaceBattleSpec = {
    id: `dogfight-${Date.now()}`, turn: 0, system: "Doren", factions: { attacker: "wooka", defender: "marines" },
    hero: "defender", heroLevel: 1, fleets: { attacker: 3, defender: 3 },
    muster: { attacker: 4, defender: 2 }, batteries: { attacker: 0, defender: 1 }, seed: Math.floor(Math.random() * 2 ** 31),
  };
  briefSpace(spec, (r) => {
    const won = r.winner === spec.hero;
    showModal(`<h2>${won ? "Orbit held" : "Orbit lost"}</h2>
      <p>${won ? "The log gliders are drifting back to Doren. Some of them are still on fire." : "There are Wooka in the cruisers now. They are pressing every button."}</p>
      <button type="button" id="close" class="primary">Back to the map</button>`);
  });
};

function showModal(html: string) { $("modal-body").innerHTML = html; $("modal-body").className = "modal-body"; $("modal").hidden = false; }
function hideModal() { $("modal").hidden = true; }

// Back from the battle's result: the next seat, or the waiting room.
document.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === "pass-on-after") { hideModal(); voteIfOpen(() => passTo(seatUp())); }
  else if (id === "back-to-map") { hideModal(); voteIfOpen(afterTurn); }
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
