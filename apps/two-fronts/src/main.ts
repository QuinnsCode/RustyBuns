// The page: the strategy map and its orders panel, the briefing for a hero battle, the battle
// itself, and back. A game against the AI or a hotseat game is a table kept in this browser,
// saved after every change. A game online lives in its campaign's Durable Object, and this page
// is one seat at it.
import "./locale.ts"; // first: the language goes into the content before the sim reads it
import { GALAXIES, SECTOR_NAMES, FACTION_NAMES, galaxyOf, isHold, type GalaxyId } from "./war/galaxy.ts";
import {
  CARDS, CARD_COST, CARD_NAMES, CARRY, ESCORT_CARRY, ORBIT_CARDS, decksOf, COST, ENERGY_CAP, FACTIONS, HAND_MAX, MUSTER_MAX, LOST_TURNS, MORALE_SHARE, MUSTER_MIN, ORBIT, SCORED, canBreakOut, checkRetreats, energyIncome, enemy, fieldsHeld, fogged, handOf, heroReady, idleShips, income, incomeBreakdown, keyShare, musterOf, planDeploys, planOrders, regionHolder, scoredHolds, supplied,
  type Attack, type Campaign, type Card, type Deck, type Order, type Orders, type Retreat, type Where,
} from "./war/rules.ts";
import { aiVote, castVote, handIn, heroFaction, humans, newTable, report, tally, waitingOn, type Seats, type Table, type Vote } from "./war/table.ts";
import { claimSeat, fetchView, linkInHash, pointerSocket, seatLink, sendBattle, sendOrders, sendVote, startOnline, type Online, type View } from "./net.ts";
import { EVENT_ICONS, eventLine, eventNow, eventSoon, forecasting, galeAt, sheltered } from "./war/gale.ts";
import { yearOf } from "./war/objectives.ts";
import { LAST, PHASES, attacking as attackingOrder, banner, forecast, phaseOf, standing, summary, won, type Battle, type PhaseNo, type Standing } from "./war/phases.ts";
import { applyTheme, installUi, toast as say } from "@rustybuns/ui";
import { WAR_TABLE, mountControlsPanel } from "./ui/controls-panel.ts";
import { KIND_ICONS, drawMap, drawPlanet, galeOn, mapLegend } from "./ui/map.ts";
import { STATE_ICONS, STATE_NAMES, placeStates, systemState, type PlaceState } from "./war/states.ts";
import { heroPlace, sheet } from "./war/sheet.ts";
import { POINTS, WARS, holdsGoal, isFrost, objective } from "./war/objectives.ts";
import { icon, tip } from "./ui/icons.ts";
import { PRESETS, PRESET_IDS, deploy, emptyDeployment, loadoutOf, placeLoadout, presetDeployment, room, totals, valueOf, type Loadout, type PresetId } from "./war/fleet.ts";
import { MODE_INFO, voteScreen, type VoteSeat } from "./ui/vote.ts";
import { run } from "./battle/sim.ts";
import { PLACES } from "./battle/cutscenes.ts";
import { HULL_PER_SHIP, ROUNDS, clash, encodePicks, fightPicks, playRound, startPicks, whyNot, type PickRound } from "./battle/space-picks.ts";
import { aiSpacePick } from "./war/ai.ts";
import { SPACE_ORDERS, VEHICLE_KINDS, other, type BattleResult, type BattleSpec, type Faction, type MatchMode, type Pods, type SectorKind, type Side, type SpaceBattleResult, type SpaceBattleSpec, type SpaceOrder } from "./battle/contract.ts";
import { esc } from "@rustybuns/util";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { accountChip, achieve, canSignIn, finishSignIn, login, reportButton, signIn } from "./eqosys.ts";
import { joinParty, mountSpaces, openParty, partyIn } from "./friends.ts";
import { jumpSpec, parseJump, parseOrbit, parseWar, sectorOf, type Jump } from "./jump.ts";
import { armyOrder, armySources, armyTargets, buildSites, deployMost, deployOrder, deploySources, deployTargets, fleetOrder, matchup, most, shipSources, shipTargets, skyOver, transportsFor, type ArmyCall } from "./war/calls.ts";
import { howMany, steps, tile, unit, unitName, vs, type Unit } from "./ui/call.ts";

installUi();
applyTheme(WAR_TABLE, document.documentElement);
mountControlsPanel();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// v2 gained the cannon sectors, v3 renamed the factions, v4 had a galaxy per campaign, v5 had
// canyon and jungle sectors and a vehicle pool per battle, v6 was a table with seats and a hero a
// side, v7 can pause on a space hero battle, v8 has cards and a deploy phase.
const SAVE = "two-fronts:v8", ONLINE = "two-fronts:online", SENT = "two-fronts:sent";
const POLL_MS = 5000;

type Game = { kind: "local"; table: Table } | { kind: "online"; link: Online; view: View };

const read = <T>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } };

const firstVisit = read(SAVE) === null;
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
// The phase of the turn this screen is in while orders are given, and what the turn started with.
let phase: PhaseNo = 1, phaseTurn = 0;
let turnStart: { turn: number; me: Faction; at: Standing; fights: Battle[] } | null = null;
// The play being called in the phase on screen (main.ts's call sheets): where from, where to, how
// many (null: all that can go). `choose` is set when the player asked to pick the "from" again.
let pick: { at: string; from: string | null; to: string | null; n: number | null; choose: boolean } = { at: "", from: null, to: null, n: null, choose: false };
let cardsOpen = false;
// The attack on you being answered with a pull-out, while its "where to" is picked (turn:place).
let pulling: string | null = null;

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
const CARD_ICONS: Record<Card, string> = {
  guns: "crosshair", troops: "shield-plus", trap: "bomb", dugin: "shovel", raid: "siren", sappers: "pickaxe",
  runner: "arrow-down-to-line", pinpoint: "target", flank: "chevrons-up", escort: "package", skylord: "orbit", baron: "gem",
  weather: "scan-eye", forecast: "binoculars", steer: "move-horizontal", shelter: "house", still: "pause", eye: "tornado",
};
const CARD_TIPS: Record<Card, string> = {
  guns: "Weapon upgrade: every die your side rolls defending this sector is a d8, until it's taken",
  troops: `Muster: free armies here, one for every two you have on this world already (${MUSTER_MIN} at least, ${MUSTER_MAX} at most)`,
  trap: "Trap: blows up half of whatever attacks here this turn, and everyone of yours there with it. For a place you hold with one army or ship",
  dugin: "Dig in: your side has cover in every ground fight across this sector's region this turn, attacking or holding",
  runner: "Blockade runner: on a world under their fleet, your landings this turn get down as if the sky were open (up to four), even if your transports lose the space battle",
  pinpoint: "Pinpoint bombardment: on an orbit you hold, this turn's bombardment there kills two an army a ship, and goes through a shield at full",
  flank: "Flank: on an orbit your ships are in or next to, +1 on your best die in the space battle there this turn",
  skylord: `Sky lord (scored): hold the orbit over every world of one region at the war's end for ${SCORED.skylord} points`,
  baron: `Crystal baron (scored): hold two crystal fields at the war's end for ${SCORED.baron} points`,
  escort: `Escort: your ships leaving this orbit this turn carry ${ESCORT_CARRY} armies each, not ${CARRY}`,
  raid: "Warren raid: on an enemy warren or spaceport next to a sector you hold, it loses an army and none of theirs land on it this turn",
  sappers: "Sappers: this turn your armies on this world move between any two sectors you hold here, touching or not",
  weather: "Read the weather: a world you can't see shows its numbers this turn and the next",
  forecast: "Forecast: this world shows the one sector the Gale blows to next, this turn and the next",
  steer: "Steer the Gale: at the end of the turn, before it takes its share, the Gale is pushed onto this sector next to it",
  shelter: "Shelter: your armies on this sector lose nothing to the Gale this turn",
  still: "Stillness: the Gale on this world doesn't blow on at the end of this turn",
  eye: `Eye of the storm (scored): more of your armies than theirs under the Gale at the war's end, for ${SCORED.eye} points`,
};
// Cards played on a sector you hold, on someone else's (shown only where they'd go), and on an orbit.
const SECTOR_CARDS: Card[] = ["guns", "troops", "trap", "dugin", "sappers", "shelter"], AIMED_CARDS: Card[] = ["raid", "steer"];
const ORBIT_PLAYS: Card[] = ["trap", ...ORBIT_CARDS];
const DECK_ICONS: Record<Deck, string> = { fleet: "rocket", ground: "swords", gale: "wind" };
const DECK_NAMES: Record<Deck, string> = { fleet: "Fleet", ground: "Ground", gale: "Gale" };

const systemDef = (id: string) => galaxyOf(c).system(id), neighbours = (id: string) => galaxyOf(c).neighbours(id);

const placeName = (w: Where) => {
  const d = systemDef(w.system);
  if (w.sector === ORBIT) return `${d.name} · Orbit`;
  return d.sectors.length > 1 ? `${d.name} · ${SECTOR_NAMES[d.sectors[w.sector]!]}` : d.name;
};
// A place's Open / Held / Contested as a chip in words, and as words after a destination's name.
const chip = (st: PlaceState) => `<span class="state ${st}">${icon(STATE_ICONS[st], 12)}${STATE_NAMES[st]}</span>`;
// A move into the enemy's ground or orbit is an attack, and says so.
const attacking = (o: Order) => attackingOrder(c, me, o);
// Where the turn is: the phase picked while orders are given, the last once attacks are declared,
// and Deploy again after the fighting. 0 while the fleets are being placed.
const nowPhase = (): number => (c.setup ? 0 : c.attacks ? LAST : c.deploying ? 2 : phase);
// An order in words: what it is and where it lands first (`Attack · Kessa · Warren`), then how
// many and from where.
const describe = (o: Order) =>
  o.kind === "build" ? `Build ${o.unit === "fleet" ? "a ship" : "an army"} at ${placeName(o.at)}`
  : o.kind === "card" ? `${CARD_NAMES[o.card]} at ${placeName(o.at)}`
  : o.kind === "buy" ? bought(c.market?.[o.deck][o.slot])
  : o.kind === "bombard" ? `Bombard ${placeName(o.at)} with ${o.count} ${o.count === 1 ? "ship" : "ships"}`
  : `<span>${attacking(o) ? "Attack" : "Move"} · ${o.kind === "fleet" ? placeName({ system: o.to, sector: ORBIT }) : placeName(o.to)} <small>${o.kind === "fleet"
    ? `${o.count} ${o.count === 1 ? "ship" : "ships"} from ${systemDef(o.from).name}`
    : `${o.count} ${o.count === 1 ? "army" : "armies"} from ${placeName(o.from)}`}</small></span>`;

const bought = (k: Card | undefined) => (k ? `Buy ${CARD_NAMES[k]} for ${CARD_COST[k]} energy` : "Buy a card");

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
/** A message at the foot of the screen, from the kit. */
function flash(msg: string) { say(msg); }

function render() {
  const moving = deploying(), foe = enemy(me), g = online(), answering = !!c.attacks || !!c.deploying, ph = nowPhase();
  turnStart ??= c.setup ? null : { turn: c.turn, me, at: standing(c, me), fights: [] };
  // Before the war, the map shows this seat's fleet where it has put it.
  const draft = moving ? planDeploys(c, me, mine.deploys ?? []).c : planOrders(c, [mine]).c;
  // The map as this seat sees it, with the weather it has read and the forecasts it has made this turn.
  const looked = game.kind === "local" ? fogged({ ...c, sights: draft.sights ?? null }, me) : { ...c, sights: draft.sights ?? null };
  const v = c.setup && mine.deployment ? deploy(seen(), me, mine.deployment) : looked;
  $("map").innerHTML = drawMap(v, moving ? mine.deploys ?? [] : mine.orders, selected, mine.hero, { me, attacks: c.attacks ?? [], retreats: mine.retreats ?? [] });
  $("legend").innerHTML = c.setup ? "" : mapLegend();
  const places = placeStates(v, me, moving ? [] : mine.orders, c.attacks ?? []);
  const gx = galaxyOf(c), war = WARS[c.galaxy], pts = c.points ?? { marines: 0, wooka: 0 };
  const count = (f: Faction) => Object.values(v.systems).reduce((n, s) => ({ armies: n.armies + s.sectors.reduce((a, x) => a + x.armies[f], 0), ships: n.ships + s.fleets[f] }), { armies: 0, ships: 0 });
  const forces = count(me), held = gx.regions.filter((r) => regionHolder(c, r.id) === me).length;
  // The bar along the top of the map: what this side has to spend and to fight with.
  $("topbar").innerHTML = `
    <span class="res" title="Credits now, and next turn's income">${icon("coins")}<b>${draft.credits[me]}</b><small>+${income(c, me)}</small></span>
    <span class="res" title="Objective points, yours then theirs: counted every Frost (every 4th turn). First to ${war.target} wins, or the higher total after turn ${war.turns}.${keyShare(c, me) < MORALE_SHARE ? " Under 30% of the key sectors your income halves." : ""}">${icon("trophy")}<b>${pts[me]} · ${pts[foe]}</b><small>/${war.target}</small></span>
    <span class="res" title="Crystal fields you hold: ${POINTS.field} points each every Frost">${icon("gem")}<b>${fieldsHeld(c, me)}</b></span>
    <span class="res" title="Energy to buy command cards with: +${energyIncome(c, me)} each Muster (1 a capital, 2 a spaceport), up to ${ENERGY_CAP}">${icon("zap")}<b>${draft.energy?.[me] ?? 0}</b><small>/${ENERGY_CAP}</small></span>
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
  $("banner").innerHTML = bannerLine();
  $("phasebar").innerHTML = phaseBar(ph);
  $("status").innerHTML = `
    ${eventNews()}
    ${reinforcements()}
    ${c.setup ? "" : objectivesPanel()}
    ${g || hotseat() ? `<div class="row small seat"><span><i class="dot ${me}"></i>${g ? "Online" : "Hotseat"}: ${FACTION_NAMES[me]}</span>
      ${g ? `<span>${waitingLine()}</span>${g.link.invite ? `<button type="button" id="invite" class="icon-btn" title="The other side's link" aria-label="The other side's link">${icon("link")}</button>` : ""}` : ""}</div>` : ""}`;

  // The selected world: what's there, the cards you can play on it, and its rules behind one "i".
  // The orders themselves are called in the call sheet above it.
  let html = `<p class="hint">Pick a world on the map.</p>`;
  if (selected) {
    const d = systemDef(selected), s = v.systems[selected]!, ds = draft.systems[selected]!;
    // Their numbers, or a question mark where nobody of ours is here to count them.
    const theirs = (n: number, there: boolean) => (s.fog && there ? "?" : n);
    const opts = (n: number) => Array.from({ length: n }, (_, i) => `<option${i === n - 1 ? " selected" : ""}>${i + 1}</option>`).join("");
    const can = (o: Order) => planOrders(c, [{ ...mine, orders: [...mine.orders, o] }]).errors.at(-1);
    const btn = (label: string, o: Order, extra = "") => {
      const err = can(o);
      return `<button type="button" data-order="${esc(JSON.stringify(o))}" ${err ? `disabled title="${esc(err)}"` : ""} ${extra}>${label}</button>`;
    };
    // A button per card in hand that can go here, the card's icon with its rules as the tooltip.
    const cardButtons = (at: Where, kinds: Card[], fits = false) => kinds.filter((k) => handOf(draft, me).includes(k) && (!fits || !can({ kind: "card", card: k, at })))
      .map((k) => btn(icon(CARD_ICONS[k], 15), { kind: "card", card: k, at }, `class="build card" title="${CARD_TIPS[k]}" aria-label="Play ${CARD_NAMES[k]}"`)).join("");
    const orbitCards = !answering && ph === 1 ? cardButtons({ system: selected, sector: ORBIT }, ORBIT_PLAYS) : "";
    const goBtn = (attr: string, title: string) => `<button type="button" class="icon-btn go" ${attr} title="${title}" aria-label="${title}">${icon("send", 15)}</button>`;
    const idle = idleShips(draft, ds)[me];
    // Their fleet gone and the sky ours: train ships on a garrison below, before the landings.
    const gale = galeAt(c, selected), galeSoon = galeOn(v, me, selected), told = forecasting(v, me, selected);
    const bombardable = (i: number) => !c.setup && !answering && ph === 3 && s.orbit === me && !s.fleets[foe] && s.sectors[i]!.owner === foe && ds.sectors[i]!.armies[foe] > 0 && idle > 0 && gale !== i;
    const rules = [
      gale !== null && `The Gale is over the ${SECTOR_NAMES[s.sectors[gale]!.kind].toLowerCase()}: ${sheltered(s.sectors[gale]!.kind) ? "its shelter keeps the armies there safe" : "armies there lose 1 in 3 at the end of the turn"}, and nothing lands or is bombarded there. ${told && galeSoon.length ? `Your forecast: next turn it blows on to the ${SECTOR_NAMES[s.sectors[galeSoon[0]!]!.kind].toLowerCase()}.` : "Next turn it blows 1 to 3 sectors on."}`,
      s.sectors.some((x) => x.kind === "cannon") && "The cannon knocks a ship a turn out of an enemy fleet in orbit.",
      s.sectors.some((x) => x.kind === "canyon") && "The crystal field pays 4 a turn. It has no landing hold: take the warren or spaceport beside it and push over.",
      s.sectors.some((x) => isHold(x.kind)) && `Troops land on a warren or spaceport you hold, or next to one. Holding none, one assault landing goes onto a hold. A transport carries ${CARRY} troops.`,
      s.sectors.length > 3 && "Troops on the ground move only to a sector next door round the ring.",
      s.sectors.some((x) => x.kind === "jungle") && "The jungle's holder defends it as if they held the orbit.",
    ].filter(Boolean);
    html = `<div class="world"><div class="sys-head"><h2>${d.name}</h2><span class="small">${galaxyOf(c).regions.find((r) => r.id === d.region)?.name ?? ""}</span>${rules.length ? tip(rules.join("<br>")) : ""}</div>
      <div class="orbit-row"><span title="Orbit held by ${s.orbit ? FACTION_NAMES[s.orbit] : "nobody"}">${icon("orbit", 15)}<i class="dot ${s.orbit ?? ""}"></i></span>${chip(places[selected]!.orbit)}
        <span class="vsn" title="Warships here: yours, then theirs">${unit("ship", s.fleets[me], me)}${unit("ship", theirs(s.fleets[foe], s.orbit === foe), foe)}</span>
        ${musterCount(s, theirs)}</div>
      ${s.sectors.length > 3 ? drawPlanet(v, selected, me, places[selected]!) : ""}
      ${s.sectors.some((x) => x.armies[me]) && !supplied(c, me).has(selected) ? tip("Cut off: your troops here lose one a turn. Clear the enemy orbit on the way back to a capital.", true) : ""}
      ${orbitCards ? `<div class="act">${orbitCards}</div>` : ""}
      <ul class="sectors">${s.sectors.map((x, i) => {
        const at = { system: selected!, sector: i }, here = ds.sectors[i]!;
        const cards = !answering && ph === 1 ? (x.owner === me ? cardButtons(at, SECTOR_CARDS) : "") + cardButtons(at, AIMED_CARDS, true) : "";
        return `<li>
          <div class="sector"><i class="dot ${x.owner}"></i><span class="kind" title="${isHold(x.kind) ? "A landing hold" : SECTOR_NAMES[x.kind]}">${icon(KIND_ICONS[x.kind], 14)}</span><b>${SECTOR_NAMES[x.kind]}</b>${chip(places[selected!]!.sectors[i]!)}${gale === i ? `<i class="mark gale" title="Under the Gale: ${sheltered(x.kind) ? "sheltered here" : "armies in the open lose 1 in 3 this Collect"}; no landings, no bombardment, the holder has cover">${icon("wind", 13)}</i>` : galeSoon.includes(i) ? `<i class="mark gale-soon" title="${told ? "Your forecast: the Gale blows here next turn" : "The Gale may blow here next turn"}">${icon("wind", 13)}</i>` : ""}${x.guns ? `<i class="mark" title="Upgraded guns: its holder rolls d8s defending it">${icon("crosshair", 13)}</i>` : ""}${(v.traps ?? []).some((t) => sameWhere(t.at, at)) ? `<i class="mark" title="Your trap is set here">${icon("bomb", 13)}</i>` : ""}
            <span class="vsn armies" title="Troops here: yours, then theirs">${unit("troops", x.armies[me], me)}${unit("troops", theirs(x.armies[foe], x.owner === foe), foe)}</span></div>
          ${cards ? `<div class="act">${cards}</div>` : ""}
          ${bombardable(i) ? `<div class="act send"><span class="what" title="Their fleet is gone: each ship kills a troop here before the landings, half as many through a shield. Ships that bombard don't sail.">${icon("flame", 15)}</span><select data-bomb-n="${i}" title="Ships to train on this sector">${opts(idle)}</select>${goBtn(`data-bombard="${i}"`, "Bombard from orbit: each ship kills a troop here, half as many through a shield")}</div>` : ""}
        </li>`;
      }).join("")}</ul></div>`;
  }
  const calling = !c.setup && !c.winner && myTurn() && !answering && ph < LAST;
  $("detail").innerHTML = c.setup ? setupPanel(v) : !c.winner && !myTurn() ? waitPanel()
    : (c.attacks ? retreatPanel() : "")
      + (calling ? callSheet(ph as PhaseNo, draft, v, places) : moving ? deployCall(places) : "")
      + (ph === LAST && !c.deploying && !c.winner ? battlesPanel() : html);

  const rs = mine.retreats ?? [], ds = mine.deploys ?? [];
  $("orders").innerHTML = c.setup
    ? `<li class="hint">${myTurn() ? "Choose a fleet, place it on your worlds, then deploy." : "Your fleet is in place."}</li>`
    : c.deploying
    ? ds.length
      ? ds.map((o, i) => `<li>${describe(o)} <button type="button" class="x" data-drop-deploy="${i}" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>`).join("")
      : `<li class="hint">${moving ? "Staying put. Move troops into what you took, or up to the front." : "Waiting for the deploys."}</li>`
    : answering
    ? rs.length
      ? rs.map((r, i) => `<li>${r.kind === "calloff" ? `Call off the attack on ${placeName(r.to)}` : `Pull out of ${placeName(r.from)} to ${placeName(r.to)}`} <button type="button" class="x" data-drop-retreat="${i}" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>`).join("")
      : `<li class="hint">${myTurn() ? "Holding everywhere. Pull out where you'd rather not fight, or call an attack off." : "Your moves are in."}</li>`
    : mine.orders.length || mine.hero
    ? `${orderRows()}
       ${mine.hero ? `<li class="hero-order">${icon("swords", 14)} Hero ${mine.hero.sector === ORBIT ? "flies" : "leads"} at ${placeName(mine.hero)} <button type="button" class="x" data-drop="hero" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>` : ""}`
    : `<li class="hint">No orders yet.</li>`;
  $("log").innerHTML = c.log.map((l) => `<li>${esc(l)}</li>`).join("");
  // The sheet's head and the one big button: what this phase wants, and who the turn waits on.
  const sh = sheet({ c, me, phase, waiting: waiting(), mode: g ? "online" : hotseat() ? "hotseat" : "ai", busy, fleetChosen: !!loadout,
    heroAt: mine.hero ? systemDef(mine.hero.system).name : null, deploys: ds.length, retreats: rs.length });
  $("sheet-head").innerHTML = `<h2>${sh.live ? `<span class="live-dot" aria-hidden="true"></span>` : icon(sh.icon, 18)}${esc(sh.title)}</h2><p class="sub">${esc(sh.sub)}</p>`;
  const chipEl = $("wait-chip");
  chipEl.className = `chip ${sh.wait}`;
  chipEl.hidden = sh.wait === "none";
  chipEl.title = sh.chip;
  chipEl.innerHTML = `${icon(sh.wait === "you" ? "hand" : "hourglass", 15)}<span>${esc(sh.chip)}</span>`;
  const end = $("end-turn");
  end.toggleAttribute("disabled", sh.next.disabled);
  end.classList.toggle("hero", sh.next.hero);
  end.innerHTML = `${sh.next.icon === "chevrons-right" ? "" : icon(sh.next.icon, 18)}${esc(sh.next.label)}${sh.next.small ? ` <small>${esc(sh.next.small)}</small>` : ""}${sh.next.icon === "chevrons-right" ? icon("chevrons-right", 18) : ""}`;
  if (c.winner && !hotseat()) { void achieve("war-played"); if (c.winner === me) void achieve("war-won"); }
  if (c.winner) showModal(`<h2>${hotseat() ? `${FACTION_NAMES[c.winner]} win` : c.winner === me ? "Victory" : "Defeat"}</h2><p>${FACTION_NAMES[c.winner]} wins the war on turn ${c.turn - 1}, ${pts[c.winner]} points to ${pts[enemy(c.winner)]}.</p><button type="button" id="new-war" class="primary">New campaign</button>`);
}

// --- The call sheet: a phase's orders as a few big picks ---
// Muster: the credits and what they buy, then where each one starts. Deploy and Invasion: which
// troops, where to, how many. Armada: which warships, which orbit, how many. Every step shows the
// units as an icon and a number, and the last one the fight it starts and the odds, before Confirm.

const keyOf = (w: Where) => `${w.system}:${w.sector}`;
const whereOf = (k: string): Where => { const [system, sector] = k.split(":"); return { system: system!, sector: +sector! }; };
// The most one play can send: everything there that the rules let go (ships not bombarding, troops
// with transports enough).
function callMax(kind: string, from: string, to: string) {
  const d = planOrders(c, [mine]).c;
  if (kind === "fleet") return most(c, mine, (n) => fleetOrder(from, to, n), idleShips(d, d.systems[from]!)[me]);
  const w = whereOf(from);
  return most(c, mine, (n) => armyOrder(w, whereOf(to), n), d.systems[w.system]!.sectors[w.sector]!.armies[me]);
}
const sectorLabel = (w: Where) => { const x = c.systems[w.system]!.sectors[w.sector]; return x ? `${icon(KIND_ICONS[x.kind], 12)}${SECTOR_NAMES[x.kind]}` : `${icon("orbit", 12)}Orbit`; };
const unitAt = (w: Where): Unit => (w.sector === ORBIT ? "ship" : "troops");
const chipAt = (places: ReturnType<typeof placeStates>, w: Where) => chip(w.sector === ORBIT ? places[w.system]!.orbit : places[w.system]!.sectors[w.sector]!);
// The pick belongs to one phase of one turn (or its deploy after the fighting); a new one starts clean.
function pickFor(ph: PhaseNo | "after") {
  const at = `${c.turn}:${ph}:${me}`;
  if (pick.at !== at) pick = { at, from: null, to: null, n: null, choose: false };
  return pick;
}

function callSheet(ph: PhaseNo, draft: Campaign, v: Campaign, places: ReturnType<typeof placeStates>) {
  pickFor(ph);
  const body = ph === 1 ? musterCall(draft) : ph === 3 ? fleetCall(draft, v, places) : armyCall(ph === 2 ? "move" : "invade", draft, v, places);
  return `<div class="call">${body}</div>${ph === 1 ? marketPanel(draft) : ""}`;
}

function musterCall(draft: Campaign) {
  const cr = draft.credits[me], sites = buildSites(c, mine);
  const queued = (at: Where, u: "army" | "fleet") => mine.orders.filter((o) => o.kind === "build" && o.unit === u && sameWhere(o.at, at)).length;
  const can = (o: Order) => planOrders(c, [{ ...mine, orders: [...mine.orders, o] }]).errors.at(-1);
  const buyBtn = (at: Where, u: "army" | "fleet") => {
    const o: Order = { kind: "build", unit: u, at }, err = can(o), q = queued(at, u), what = u === "fleet" ? "ship" : "troops";
    return `<span class="buy-unit">${q ? `<button type="button" class="less" data-unbuild="${u}|${keyOf(at)}" title="One less" aria-label="One less">${icon("minus", 14)}</button>` : ""}
      <button type="button" class="more" data-order="${esc(JSON.stringify(o))}" ${err ? `disabled title="${esc(err)}"` : `title="${u === "fleet" ? "Build a warship" : "Raise a troop"} for ${COST[u]} credits"`}>${icon("plus", 13)}${unit(what, q ? `+${q}` : "", me)}<small>${icon("coins", 11)}${COST[u]}</small></button></span>`;
  };
  const here = (at: Where) => { const s = draft.systems[at.system]!; return `${unit("troops", s.sectors[at.sector]!.armies[me], me)}${unit("ship", s.fleets[me], me)}`; };
  return `<div class="bank"><span class="coins">${icon("coins", 22)}<b>${cr}</b></span><span class="buys">credits buy ${unit("troops", Math.floor(cr / COST.army), me)} or ${unit("ship", Math.floor(cr / COST.fleet), me)}</span></div>
    <p class="call-q">Where do they start?</p>
    ${sites.length ? `<ul class="sites">${sites.map((x) => `<li class="${x.at.system === selected ? "on" : ""}"><button type="button" class="site-name" data-select="${x.at.system}"><b>${systemDef(x.at.system).name}</b><span>${sectorLabel(x.at)}</span></button>
      <span class="here">${here(x.at)}</span><span class="buys">${x.units.map((u) => buyBtn(x.at, u)).join("")}</span></li>`).join("")}</ul>`
      : `<p class="hint">Nowhere to build: you need a capital or a spaceport out of a blockade.</p>`}`;
}

function armyCall(call: ArmyCall, draft: Campaign, v: Campaign, places: ReturnType<typeof placeStates>) {
  const foe = enemy(me), g = galaxyOf(c), p = pick;
  // Troops that have somewhere to go: their own ground next to them (a move), or someone else's (an invasion).
  const reach = (w: Where) => [w.system, ...g.neighbours(w.system)].some((id) => c.systems[id]!.sectors.some((x, i) => !(id === w.system && i === w.sector) && (x.owner === me) === (call === "move")));
  // Only troops with somewhere to go: a cheap look first, then the rules, for the first few dozen.
  const reachable = new Map(armySources(draft, me).filter(reach).sort((a, b) => Number(b.system === selected) - Number(a.system === selected))
    .slice(0, 24).map((w) => [keyOf(w), armyTargets(c, mine, w, call)] as const).filter(([, ts]) => ts.length));
  const sources = [...reachable.keys()].map(whereOf);
  if (!p.from || !reachable.has(p.from)) { p.from = p.choose ? null : sources.find((w) => w.system === selected) ? keyOf(sources.find((w) => w.system === selected)!) : null; p.to = null; }
  const from = p.from ? whereOf(p.from) : null;
  const targets = p.from ? reachable.get(p.from) ?? [] : [];
  if (p.to && !targets.some((t) => keyOf(t) === p.to)) p.to = null;
  const to = p.to ? whereOf(p.to) : null;
  const at = !from ? 0 : !to ? 1 : 2;
  const head = steps([
    { label: "Troops from", value: from ? placeName(from) : "", to: "from" },
    { label: call === "move" ? "Move to" : "Land on", value: to ? placeName(to) : "", to: "to" },
    { label: "How many" },
  ], at);
  const troopsAt = (w: Where) => draft.systems[w.system]!.sectors[w.sector]!.armies[me];
  if (at === 0) return `${head}<p class="call-q">${call === "move" ? "Which troops move?" : "Which troops invade?"}</p>
    ${sources.length ? `<div class="tiles">${sources.slice(0, 12).map((w) => tile(`data-call-from="${keyOf(w)}"`, systemDef(w.system).name, sectorLabel(w), unit("troops", troopsAt(w), me))).join("")}</div>`
      : `<p class="hint">${call === "move" ? "No troops of yours can move: they need ground of yours next door, or a transport." : `No troops can reach enemy ground: they need a sector next to theirs, or a transport (a free warship carries ${CARRY}) to a world next door.`}</p>`}`;
  if (at === 1) {
    const seenAt = (t: Where) => { const s = v.systems[t.system]!; return s.fog ? "?" : s.sectors[t.sector]!.armies[foe]; };
    return `${head}<p class="call-q">${call === "move" ? "Where to?" : "Which enemy sector?"}</p>
      ${targets.length ? `<div class="tiles">${targets.map((t) => tile(`data-call-to="${keyOf(t)}"`, systemDef(t.system).name, `${sectorLabel(t)}${chip(places[t.system]!.sectors[t.sector]!)}`,
        call === "move" ? unit("troops", draft.systems[t.system]!.sectors[t.sector]!.armies[me], me) : unit("troops", seenAt(t), foe))).join("")}</div>`
        : ""}`;
  }
  const max = callMax("army", p.from!, p.to!), n = Math.max(1, Math.min(p.n ?? max, max));
  const o = armyOrder(from!, to!, n), ride = transportsFor(c, mine, o), b = matchup(seen(), mine, o);
  const you = `${unit("troops", n, me, true)}${ride ? unit("transport", ride, me, true) : ""}`;
  const them = b ? unit("troops", b.defenders ?? "?", foe, true) : null;
  const sky = from!.system === to!.system ? null : skyOver(draft, mine, to!.system);
  const skyLine = !sky ? "" : sky.holder === "you" ? `${icon("orbit", 14)}<span>Your sky over ${systemDef(to!.system).name}: they all land.</span>`
    : sky.holder === "open" ? `${icon("orbit", 14)}<span>Open sky: up to ${sky.land} land.</span>`
    : `${icon("triangle-alert", 14)}<span>Their sky: ${sky.land ? `only ${sky.land} land` : "nobody lands"}${sky.armada ? ", unless your armada wins it" : ". Send an armada first"}.</span>`;
  return `${head}${howMany("troops", n, max, me)}
    ${ride ? `<p class="ride">${unit("transport", ride, me)}<span>${ride === 1 ? "warship flies" : "warships fly"} them from ${systemDef(from!.system).name} as ${ride === 1 ? "a transport" : "transports"}.</span></p>`
      : sky ? `<p class="ride">${icon("rocket", 14)}<span>They ride with the warships you're sending to ${systemDef(to!.system).name}.</span></p>` : ""}
    ${vs(you, them, b?.win ?? null)}
    ${skyLine ? `<p class="sky${sky?.holder === "them" ? " warn" : ""}">${skyLine}</p>` : ""}
    <button type="button" class="confirm" data-call-go="army">${icon(call === "move" ? "arrow-right" : "swords", 18)}${call === "move" ? "Move" : "Land"} ${unitName("troops", n)} <small>on ${placeName(to!)}</small></button>`;
}

function fleetCall(draft: Campaign, v: Campaign, places: ReturnType<typeof placeStates>) {
  const foe = enemy(me), p = pick;
  const idle = (id: string) => idleShips(draft, draft.systems[id]!)[me];
  const sources = shipSources(draft, me).sort((a, b) => Number(b === selected) - Number(a === selected));
  if (!p.from || !sources.includes(p.from)) { p.from = p.choose ? null : sources.includes(selected ?? "") ? selected : null; p.to = null; }
  const from = p.from, targets = from ? shipTargets(c, mine, from) : [];
  if (p.to && !targets.includes(p.to)) p.to = null;
  const to = p.to, at = !from ? 0 : !to ? 1 : 2;
  const head = steps([
    { label: "Warships from", value: from ? systemDef(from).name : "", to: "from" },
    { label: "Into orbit", value: to ? systemDef(to).name : "", to: "to" },
    { label: "How many" },
  ], at);
  if (at === 0) return `${head}<p class="call-q">Which fleet sails?</p>
    ${sources.length ? `<div class="tiles">${sources.slice(0, 12).map((id) => tile(`data-call-from="${id}"`, systemDef(id).name, sectorLabel({ system: id, sector: ORBIT }), unit("ship", idle(id), me))).join("")}</div>`
      : `<p class="hint">No warships free to sail. Build them at a spaceport in Muster.</p>`}`;
  if (at === 1) {
    const theirs = (id: string) => (v.systems[id]!.fog ? "?" : v.systems[id]!.fleets[foe]);
    return `${head}<p class="call-q">Which orbit?</p>
      ${targets.length ? `<div class="tiles">${targets.map((id) => tile(`data-call-to="${id}"`, systemDef(id).name, chip(systemState(places[id]!)), `${unit("ship", theirs(id), foe)}${draft.systems[id]!.fleets[me] ? unit("ship", draft.systems[id]!.fleets[me], me) : ""}`)).join("")}</div>`
        : `<p class="hint">No lane out of here is open this turn.</p>`}`;
  }
  const max = callMax("fleet", from!, to!), n = Math.max(1, Math.min(p.n ?? max, max));
  const o = fleetOrder(from!, to!, n), b = matchup(seen(), mine, o);
  return `${head}${howMany("ship", n, max, me)}
    ${vs(unit("ship", n, me, true), b ? unit("ship", b.defenders ?? "?", foe, true) : null, b?.win ?? null)}
    <p class="sky">${icon("orbit", 14)}<span>${b ? `Win it and the sky over ${systemDef(to!).name} is yours: troops land freely, and your ships can bombard.` : `Your ships hold the sky over ${systemDef(to!).name}: troops land freely under it.`}</span></p>
    <button type="button" class="confirm" data-call-go="fleet">${icon("rocket", 18)}Send ${unitName("ship", n)} <small>to ${systemDef(to!).name}</small></button>`;
}

// After the fighting: troops into what you took or up to the front, ships between orbits you hold.
// The same three picks as Deploy, checked with planDeploys: all but one may leave a place.
function deployCall(places: ReturnType<typeof placeStates>) {
  pickFor("after");
  const p = pick, ds = mine.deploys ?? [], draft = planDeploys(c, me, ds).c;
  const sources = deploySources(c, draft, me, ds, selected), keys = sources.map(keyOf);
  if (!p.from || !keys.includes(p.from)) { p.from = p.choose ? null : keys.find((k) => whereOf(k).system === selected) ?? null; p.to = null; }
  const from = p.from ? whereOf(p.from) : null, targets = from ? deployTargets(c, me, ds, from) : [];
  if (p.to && !targets.some((t) => keyOf(t) === p.to)) p.to = null;
  const to = p.to ? whereOf(p.to) : null, at = !from ? 0 : !to ? 1 : 2;
  const here = (w: Where) => { const s = draft.systems[w.system]!; return w.sector === ORBIT ? s.fleets[me] : s.sectors[w.sector]!.armies[me]; };
  const head = steps([
    { label: from?.sector === ORBIT ? "Warships from" : "Troops from", value: from ? placeName(from) : "", to: "from" },
    { label: "Move to", value: to ? placeName(to) : "", to: "to" },
    { label: "How many" },
  ], at);
  const body = at === 0 ? `<p class="call-q">The fighting's over. What moves up?</p>
      ${sources.length ? `<div class="tiles">${sources.slice(0, 12).map((w) => tile(`data-call-from="${keyOf(w)}"`, systemDef(w.system).name, sectorLabel(w), unit(unitAt(w), here(w), me))).join("")}</div>`
        : `<p class="hint">Nothing to spare: each place keeps one to hold it. Hand in to stay put.</p>`}`
    : at === 1 ? `<p class="call-q">Where to?</p>
      <div class="tiles">${targets.map((t) => tile(`data-call-to="${keyOf(t)}"`, systemDef(t.system).name, `${sectorLabel(t)}${chipAt(places, t)}`, unit(unitAt(t), here(t), me))).join("")}</div>`
    : (() => {
      const max = deployMost(c, me, ds, from!, to!), n = Math.max(1, Math.min(p.n ?? max, max)), u = unitAt(from!);
      return `${howMany(u, n, max, me)}${vs(unit(u, n, me, true), null, null)}
        <button type="button" class="confirm" data-call-go="deploy">${icon("arrow-right", 18)}Move ${unitName(u, n)} <small>to ${placeName(to!)}</small></button>`;
    })();
  return `<div class="call">${head}${body}</div>`;
}

// The orders given this turn, under the phase each belongs to, as units and arrows.
function orderRows() {
  const row = (o: Order, i: number) => {
    const att = attacking(o), ride = transportsFor(c, { ...mine, orders: mine.orders.slice(0, i) }, o);
    const tag = (o.kind === "fleet" || o.kind === "army") ? `<em class="tag ${att ? "attack" : "move"}">${icon(att ? "swords" : "arrow-right", 11)}${att ? "Attack" : "Move"}</em>` : "";
    const what = o.kind === "build" ? `${unit(o.unit === "fleet" ? "ship" : "troops", "+1", me)}<span class="o-what">${placeName(o.at)}</span><small>${icon("coins", 11)}${COST[o.unit]}</small>`
      : o.kind === "fleet" ? `${unit("ship", o.count, me)}<span class="o-what">${systemDef(o.from).name} ${icon("arrow-right", 12)} ${systemDef(o.to).name}</span>`
      : o.kind === "army" ? `${unit("troops", o.count, me)}${ride ? unit("transport", ride, me) : ""}<span class="o-what">${placeName(o.from)} ${icon("arrow-right", 12)} ${placeName(o.to)}</span>`
      : o.kind === "bombard" ? `${icon("flame", 14)}${unit("ship", o.count, me)}<span class="o-what">Bombard ${placeName(o.at)}</span>`
      : `<span class="o-what">${describe(o)}</span>`;
    return `<li class="o-row">${what}${tag}<button type="button" class="x" data-drop="${i}" title="Cancel" aria-label="Cancel">${icon("x", 14)}</button></li>`;
  };
  const byPhase = PHASES.map((p, k) => ({ p, rows: mine.orders.map((o, i) => (phaseOf(c, me, o) === k + 1 ? row(o, i) : "")).filter(Boolean) }));
  return byPhase.filter((g) => g.rows.length).map((g) => `<li class="o-head">${icon(g.p.icon, 13)}${g.p.name}<b>${g.rows.length}</b></li>${g.rows.join("")}`).join("");
}

// A world's muster force, yours then theirs: the armies on it, which feed the space battle over it.
// Theirs is a question mark where nobody of ours is there to count it.
function musterCount(s: Campaign["systems"][string], theirs: (n: number, there: boolean) => number | string) {
  const foe = enemy(me), mine = musterOf(s, me), their = musterOf(s, foe);
  const tip = `Muster force: armies on this world, yours then theirs. In the space battle over it they send boarding parties up, and a bigger muster boards harder; batteries below (yours: ${mine.batteries}) add to a screen or a bombardment. A muster card raises more where it's bigger.`;
  return `<span class="count" title="${esc(tip)}">${icon("shield-plus", 14)}<b class="${me}">${mine.troops}</b><b class="${foe}">${theirs(their.troops, s.sectors.some((x) => x.owner === foe || x.armies[foe] > 0))}</b></span>`;
}

// Once the attacks are declared: each one against you as a matchup (their side a question mark,
// since nobody sees how many are coming), with Hold or Pull out and where to as tiles; and each of
// yours, which goes ahead or is called off.
function retreatPanel() {
  const attacks = c.attacks ?? [], foe = enemy(me), own = ownMoves(), rs = mine.retreats ?? [];
  const after = planOrders(c, [own ?? { faction: me, orders: [] }]).c, g = galaxyOf(c);
  const group = (list: Attack[]) => [...new Map(list.map((a) => [keyOf(a.to), list.filter((b) => sameWhere(b.to, a.to))])).values()];
  const mineAt = (w: Where) => w.sector === ORBIT ? after.systems[w.system]!.fleets[me] : after.systems[w.system]!.sectors[w.sector]!.armies[me];
  const from = (list: Attack[]) => list.map((a) => systemDef(a.from).name).join(", ");
  const head = (to: Where, list: Attack[]) => `<div class="f-head">${icon(to.sector === ORBIT ? "rocket" : "swords", 14)}<b>${placeName(to)}</b><span>from ${from(list)}</span></div>`;
  const choice = (attr: string, name: string, sub: string, ic: string, on: boolean) => tile(attr, name, sub, icon(ic, 18), on);
  const against = group(attacks.filter((a) => a.faction === foe && mineAt(a.to) > 0)).map((list) => {
    const to = list[0]!.to, k = keyOf(to), out = rs.find((r): r is Extract<Retreat, { kind: "withdraw" }> => r.kind === "withdraw" && sameWhere(r.from, to));
    const others = rs.filter((r) => r !== out), fits = (r: Retreat) => !own || !checkRetreats(c, own, [...others, r]).at(-1);
    const near: Where[] = to.sector === ORBIT
      ? g.neighbours(to.system).map((n) => ({ system: n, sector: ORBIT }))
      : [to.system, ...g.neighbours(to.system)].flatMap((id) => c.systems[id]!.sectors.map((_, i) => ({ system: id, sector: i })));
    const options = near.filter((p) => fits({ kind: "withdraw", from: to, to: p })), pull = !!out || pulling === `${c.turn}:${k}`;
    return `<li>${head(to, list)}${vs(unit(unitAt(to), mineAt(to), me, true), unit(unitAt(to), "?", foe, true), null)}
      ${options.length ? `<div class="tiles two">${choice(`data-hold="${k}"`, "Hold", "Stand and fight", "shield", !pull)}${choice(`data-pull="${k}"`, "Pull out", out ? `to ${placeName(out.to)}` : to.sector === ORBIT ? "Give up the sky, keep the ships" : "Give up the ground, keep the troops", "undo-2", pull)}</div>
        ${pull ? `<p class="call-q">Pull back to?</p><div class="tiles">${options.map((p) => tile(`data-withdraw="${k}|${keyOf(p)}"`, systemDef(p.system).name, sectorLabel(p), unit(unitAt(p), mineAt(p), me), !!out && sameWhere(out.to, p))).join("")}</div>` : ""}`
        : `<p class="hint">Nowhere to pull back to: they stand.</p>`}</li>`;
  }).join("");
  const fights = forecast(seen(), me, own?.orders ?? []);
  const ours = group(attacks.filter((a) => a.faction === me)).map((list) => {
    const to = list[0]!.to, k = keyOf(to), off = rs.some((r) => r.kind === "calloff" && sameWhere(r.to, to)), b = fights.find((x) => sameWhere(x.to, to));
    return `<li>${head(to, list)}<p class="ride">${unit(unitAt(to), b?.attackers ?? "?", me)}${icon("arrow-right", 14)}${unit(unitAt(to), b?.defenders ?? "?", foe)}</p>
      <div class="tiles two">${choice(`data-goahead="${k}"`, "Go ahead", "The attack goes in", "swords", !off)}${choice(`data-calloff="${k}"`, "Call off", "They stay home", "undo-2", off)}</div></li>`;
  }).join("");
  return `<div class="call attacks">
    ${against ? `<p class="call-q">Attacks on you</p><ul class="answers">${against}</ul>` : ""}
    ${ours ? `<p class="call-q">Your attacks</p><ul class="answers">${ours}</ul>` : ""}
    ${tip("Hold, and the fight happens. Pull out, and the ground is theirs but your troops live.")}</div>`;
}

// The phase bar: the five phases of a turn, the one we're in lit and the rest greyed. A click goes
// back to a phase while orders are being given; once attacks are declared or the fighting is done
// the engine sets the phase.
function phaseBar(now: number) {
  const free = !c.setup && !c.attacks && !c.deploying && myTurn();
  // How many orders each phase holds this turn, as a badge: the turn's call sheet at a glance.
  const n = (k: number) => (c.setup || c.attacks || c.deploying ? 0 : mine.orders.filter((o) => phaseOf(c, me, o) === k).length);
  return PHASES.map((p, i) => `<button type="button" data-phase="${i + 1}" class="${i + 1 === now ? "on" : i + 1 < now ? "done" : ""}" title="${i + 1} ${esc(p.tip)}" aria-label="${i + 1} ${p.name}" ${free ? "" : "disabled"}${i + 1 === now ? ' aria-current="step"' : ""}>${icon(p.icon, 15)}<b>${i + 1}</b><span>${p.name}</span>${n(i + 1) ? `<em title="${n(i + 1)} declared">${n(i + 1)}</em>` : ""}</button>`).join("");
}
// The banner over the map: year and turn, whose seat, the phase and its job, and who we wait on.
// It reads the same on a phone and a desk: two lines, the waiting chip lit while it's you.
function bannerLine() {
  const b = banner(c, me, phase, waiting(), heroFaction(c));
  return `<span class="when">${icon("calendar", 13)} Year ${b.year} · Turn ${b.turn}</span><span class="who"><i class="dot ${me}"></i>${esc(b.who)}</span>
    <span class="ph">${esc(b.phase)}</span><span class="step">${esc(b.step)}</span><span class="wait${b.mine ? " mine" : ""}" title="Who the turn is waiting on">${icon(b.mine ? "hand" : "hourglass", 13)} Waiting on: <b>${esc(b.waiting)}</b></span>`;
}
// The year's galaxy event: this turn's, or the one the year's last turn announces.
function eventNews() {
  const now = eventNow(c), soon = eventSoon(c), e = now ?? soon;
  return e && !c.setup && !c.winner ? `<p class="event">${icon(EVENT_ICONS[e.kind], 14)}<b>${now ? "This turn" : `Next year (turn ${c.turn + 1})`}:</b> ${esc(eventLine(c, e))}</p>` : "";
}
// While the turn waits on the other side: what this seat has in, and where the fights are.
function waitPanel() {
  const foe = enemy(me), own = ownMoves()?.orders ?? [];
  const live = c.pending ? (c.pending.kind === "space" ? { system: c.pending.system, sector: ORBIT } : c.pending.at) : null;
  const done = !!live;
  const row = (to: Where, what: string, state: string) => {
    const on = !!live && sameWhere(live, to);
    return `<li class="${on ? "live" : done ? "done" : ""}">${icon(to.sector === ORBIT ? "rocket" : "users", 14)}${placeName(to)} <span class="small">${what}</span><b>${on ? "being fought" : state}</b></li>`;
  };
  const ours = forecast(seen(), me, own).map((b) => row(b.to, `${b.attackers} ${b.space ? (b.attackers === 1 ? "ship" : "ships") : b.attackers === 1 ? "army" : "armies"}${mine.hero && sameWhere(mine.hero, b.to) ? ", hero" : ""}`, done ? "settled" : "declared"));
  const theirs = (c.attacks ?? []).filter((a) => a.faction === foe).map((a) => row(a.to, `they attack from ${systemDef(a.from).name}`, done ? "settled" : "you hold"));
  const list = [...ours, ...theirs];
  if (live && !list.some((l) => l.includes('class="live"'))) list.push(row(live, heroPlace(c), ""));
  return list.length ? `<ul class="wait-list">${list.join("")}</ul>` : `<p class="hint">Nothing of yours to fight this turn.</p>`;
}

// The Battles phase: every fight this side's orders start, with its odds, and the choice of letting
// the dice settle it or fighting it as the hero (one a turn).
function battlesPanel() {
  const own = c.attacks ? ownMoves()?.orders ?? [] : mine.orders, fights = forecast(seen(), me, own), ready = heroReady(c, me);
  const key = (b: Battle) => `${b.to.system}:${b.to.sector}`;
  const card = (b: Battle) => {
    const fight = !!mine.hero && sameWhere(mine.hero, b.to), u = b.space ? "ship" : "troops";
    return `<li class="fight"><div class="f-head">${icon(b.space ? "rocket" : "swords", 14)}<b>${b.space ? "Armada" : "Invasion"}</b><span>${placeName(b.to)}</span></div>
      ${vs(unit(u, b.attackers, me, true), unit(u, b.defenders ?? "?", enemy(me), true), b.win)}
      <div class="act"><button type="button" data-auto="${key(b)}" class="${fight ? "" : "on"}" title="Quick: the dice settle it, with a little luck">${icon("dices", 15)} Auto</button>
        <button type="button" data-fight="${key(b)}" class="${fight ? "on" : ""}" ${ready ? "" : "disabled"} title="${ready ? "Fight this one yourself, on the ground or in orbit (one a turn)" : "Your hero is wounded"}">${icon("swords", 15)} Fight it</button></div></li>`;
  };
  const breakouts = Object.values(seen().systems).filter((x) => !x.fog && canBreakOut(x, me)).map((x) => {
    const on = !!mine.hero && sameWhere(mine.hero, { system: x.id, sector: ORBIT });
    return `<li><div><b>Breakout: ${systemDef(x.id).name}</b>
        <div class="small">${icon("rocket", 12)} one ship against ${x.fleets[enemy(me)]} · very hard, and a lost hero is out ${LOST_TURNS} turns</div></div>
      <div class="act"><button type="button" data-fight="${x.id}:${ORBIT}" class="${on ? "on" : ""}" ${ready ? "" : "disabled"} title="${ready ? "Your hero flies up from the surface to break the blockade (one battle a turn)" : "Your hero is wounded"}">${icon("swords", 15)} Break out</button></div></li>`;
  });
  return `<div class="battles">${breakouts.length ? `<ul class="sectors">${breakouts.join("")}</ul>` : ""}${fights.length ? `<ul class="sectors">${fights.map(card).join("")}</ul>
    ${fights.length > 1 ? `<div class="act"><button type="button" data-auto="all" title="Let the dice settle every fight">${icon("dices", 15)} Auto-resolve all</button></div>` : ""}`
    : `<p class="hint">No fights this turn.</p>`}
    ${fights.length ? tip("Odds count what you sent against what you can see. They may have moved too.") : ""}</div>`;
}

// The Muster market: each deck's face-up cards with what they cost, the same for both sides, and a
// buy button each. A buy doesn't take the card from the other side; the next turns up after the turn.
function marketPanel(draft: Campaign) {
  const bought = (deck: Deck, slot: number) => mine.orders.some((o) => o.kind === "buy" && o.deck === deck && o.slot === slot);
  const rows = decksOf(c).map((deck) => `<div class="market-row"><span class="deck" title="${DECK_NAMES[deck]} deck">${icon(DECK_ICONS[deck], 15)}</span>${(c.market?.[deck] ?? []).map((card, slot) => {
    const o: Order = { kind: "buy", deck, slot }, err = bought(deck, slot) ? "Bought" : planOrders(c, [{ ...mine, orders: [...mine.orders, o] }]).errors.at(-1);
    return `<button type="button" class="buy${SCORED[card] ? " scored" : ""}" data-order="${esc(JSON.stringify(o))}" ${err ? "disabled" : ""} title="${esc(`${CARD_TIPS[card]}${err ? ` (${err})` : ""}`)}" aria-label="Buy ${CARD_NAMES[card]}">${icon(CARD_ICONS[card], 15)}<span>${CARD_NAMES[card]}</span><small>${icon("zap", 11)}${CARD_COST[card]}</small></button>`;
  }).join("")}</div>`).join("");
  return `<details class="market"${cardsOpen ? " open" : ""}><summary>${icon("layers", 14)} Cards <small>${icon("zap", 11)}${draft.energy?.[me] ?? 0} energy · hand ${handOf(draft, me).length}/${HAND_MAX}</small>${icon("chevron-down", 14)}</summary>${rows}</details>`;
}

// The war's objectives: the two public ones, held or not, and this side's secret one.
function objectivesPanel() {
  const held = (id: string) => { const o = objective(c.galaxy, id); return o ? { name: o.name, ok: holdsGoal(c, me, o.goal) } : null; };
  const pub = (c.objectives ?? []).map(held).filter((o) => o !== null), mySecret = c.secrets?.[me], secret = mySecret ? held(mySecret) : null;
  const scored = handOf(c, me).filter((k) => SCORED[k]);
  const line = (o: { name: string; ok: boolean }, ic: string, pts: number, when: string) =>
    `<li class="${o.ok ? "ok" : ""}" title="${esc(`${pts} points ${when}${o.ok ? ": you hold it now" : ""}`)}">${icon(o.ok ? "circle-check" : ic, 13)}<span>${esc(o.name)}</span><b>${pts}</b></li>`;
  const war = WARS[c.galaxy], left = war.turns - c.turn;
  return `<details class="reinf objectives" open><summary title="What scores at the next Frost">${icon("trophy", 14)}<span>Objectives</span><small>${isFrost(c.turn) ? "Frost: counted this turn" : `next Frost turn ${c.turn + 4 - (c.turn % 4)}`} · ${left > 0 ? `${left} turns left` : "last turn"}</small>${icon("chevron-down", 14)}</summary><ul>
    ${pub.map((o) => line(o, "flag", POINTS.objective, "every Frost")).join("")}
    ${secret ? line(secret, "lock", POINTS.secret, "at the war's end, secret") : ""}
    ${scored.map((k) => line({ name: CARD_NAMES[k], ok: scoredHolds(c, me, k) }, CARD_ICONS[k], SCORED[k]!, "at the war's end, scored card")).join("")}
    </ul></details>`;
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

// An "i" opens or closes its text.
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".tip-btn");
  if (!b) return;
  const t = b.nextElementSibling as HTMLElement;
  t.hidden = !t.hidden;
  b.setAttribute("aria-expanded", String(!t.hidden));
});

// Clicks, delegated.
document.addEventListener("click", (e) => {
  // A click on an icon or label inside a button counts as the button.
  const t = ((e.target as HTMLElement).closest?.("button") ?? e.target) as HTMLElement;
  const sys = t.closest<SVGGElement>("[data-system]");
  if (sys) return pickOnMap(sys.dataset.system!);
  if (t.dataset.select) { selected = t.dataset.select; render(); return; }
  if (t.dataset.callFrom) { pick = { ...pick, from: t.dataset.callFrom, to: null, n: null, choose: false }; selected = t.dataset.callFrom.split(":")[0]!; render(); return; }
  if (t.dataset.callTo) { pick = { ...pick, to: t.dataset.callTo, n: null }; render(); return; }
  if (t.dataset.callN) { pick.n = Math.max(1, +t.dataset.callN); render(); return; }
  if (t.dataset.callBack) { pick = t.dataset.callBack === "from" ? { ...pick, from: null, to: null, n: null, choose: true } : { ...pick, to: null, n: null }; render(); return; }
  if (t.dataset.callGo) return confirmCall(t.dataset.callGo);
  if (t.dataset.unbuild) {
    const [u, k] = t.dataset.unbuild.split("|"), at = whereOf(k!), i = mine.orders.findLastIndex((o) => o.kind === "build" && o.unit === u && sameWhere(o.at, at));
    if (i >= 0) { mine.orders.splice(i, 1); save(); render(); }
    return;
  }
  if (t.closest(".market > summary")) { cardsOpen = !cardsOpen; return; }
  if (t.dataset.phase) { phase = +t.dataset.phase as PhaseNo; render(); return; }
  if (t.dataset.fight) {
    const [system, sector] = t.dataset.fight.split(":");
    mine.hero = { system: system!, sector: +sector! };
    save(); render(); return;
  }
  if (t.dataset.auto) { if (t.dataset.auto === "all" || t.dataset.auto === (mine.hero && `${mine.hero.system}:${mine.hero.sector}`)) mine.hero = undefined; save(); render(); return; }
  if (t.dataset.order) return order(JSON.parse(t.dataset.order));
  if (t.dataset.step) {
    const ctr = t.closest<HTMLElement>(".ctr")!, b = ctr.querySelector("b")!;
    b.textContent = String(Math.max(1, Math.min(+ctr.dataset.max!, +b.textContent! + +t.dataset.step)));
    return;
  }
  if (t.dataset.sail) return order({ kind: "fleet", from: selected!, to: t.dataset.sail, count: +t.closest("li")!.querySelector(".ctr b")!.textContent! });
  if (t.dataset.recall) {
    mine.orders = mine.orders.filter((o) => !(o.kind === "fleet" && o.from === selected && o.to === t.dataset.recall));
    save(); render(); return;
  }
  if (t.dataset.drop) {
    if (t.dataset.drop === "hero") mine.hero = undefined;
    else mine.orders.splice(+t.dataset.drop, 1);
    save(); render(); return;
  }
  // The answers to the attacks: hold (no withdrawal here), pull out (then where to), go ahead or call off.
  const withdrawing = (w: Where) => (r: Retreat) => r.kind === "withdraw" && sameWhere(r.from, w);
  const callingOff = (w: Where) => (r: Retreat) => r.kind === "calloff" && sameWhere(r.to, w);
  const answer = (keep: (r: Retreat) => boolean, add?: Retreat) => { mine.retreats = [...(mine.retreats ?? []).filter(keep), ...(add ? [add] : [])]; save(); render(); };
  if (t.dataset.hold) { pulling = null; return answer((r) => !withdrawing(whereOf(t.dataset.hold!))(r)); }
  if (t.dataset.pull) { pulling = `${c.turn}:${t.dataset.pull}`; render(); return; }
  if (t.dataset.withdraw) {
    const [k, to] = t.dataset.withdraw.split("|"), from = whereOf(k!);
    return answer((r) => !withdrawing(from)(r), { kind: "withdraw", from, to: whereOf(to!) });
  }
  if (t.dataset.goahead) return answer((r) => !callingOff(whereOf(t.dataset.goahead!))(r));
  if (t.dataset.calloff) { const to = whereOf(t.dataset.calloff); return answer((r) => !callingOff(to)(r), { kind: "calloff", to }); }
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
  if (t.dataset.start === "friends") return void withFriends();
  if (t.dataset.start) return startGame(t.dataset.start as "ai" | "hotseat" | "online");
  if (t.id === "invite") return showInvite();
  if (t.id === "copy-link") { void navigator.clipboard?.writeText($<HTMLInputElement>("seat-link").value); flash("Link copied"); return; }
  if (t.id === "pass-on") { hideModal(); return afterTurn(); }
  if (t.id === "close") { hideModal(); if (c.setup) afterTurn(); }
});
document.addEventListener("keydown", (e) => {
  const sys = (e.target as HTMLElement).closest?.<SVGGElement>("[data-system]");
  if (sys && (e.key === "Enter" || e.key === " ")) pickOnMap(sys.dataset.system!);
});
// A world clicked on the map: the "to" of the play being called when it's somewhere that play can
// go, else the world to look at (and to call the next play from).
function pickOnMap(id: string) {
  const ph = nowPhase(), calling = !c.setup && !c.winner && myTurn() && !c.attacks && !c.deploying && ph >= 2 && ph <= 4;
  if (calling && pick.from && pick.at.endsWith(`:${ph}:${me}`)) {
    if (ph === 3 && pick.from !== id && shipTargets(c, mine, pick.from).includes(id)) { pick = { ...pick, to: id, n: null }; return render(); }
    if (ph !== 3) {
      const there = armyTargets(c, mine, whereOf(pick.from), ph === 2 ? "move" : "invade").filter((t) => t.system === id);
      if (there.length === 1) { pick = { ...pick, to: keyOf(there[0]!), n: null }; return render(); }
    }
  }
  if (deploying() && pick.from && pick.at.endsWith(`:after:${me}`)) {
    const there = deployTargets(c, me, mine.deploys ?? [], whereOf(pick.from)).filter((t) => t.system === id);
    if (there.length === 1) { pick = { ...pick, to: keyOf(there[0]!), n: null }; return render(); }
  }
  selected = id;
  pick = { ...pick, from: null, to: null, n: null, choose: false };
  render();
}
// Confirm: the play becomes an order, and the caller goes back to "where to?" from the same place.
function confirmCall(kind: string) {
  const ph = nowPhase(), from = pick.from, to = pick.to;
  if (!from || !to) return;
  if (kind === "deploy") {
    const ds = mine.deploys ?? [], max = deployMost(c, me, ds, whereOf(from), whereOf(to)), n = Math.max(1, Math.min(pick.n ?? max, max));
    pick = { ...pick, to: null, n: null };
    return order(deployOrder(whereOf(from), whereOf(to), n));
  }
  const max = callMax(kind, from, to);
  const n = Math.max(1, Math.min(pick.n ?? max, max));
  pick = { ...pick, to: null, n: null };
  if (ph === 3 || ph === 2 || ph === 4) order(kind === "fleet" ? fleetOrder(from, to, n) : armyOrder(whereOf(from), whereOf(to), n));
}

// --- Games ---

// The first thing a war asks: which side, then how big and who against. `first` is the opening
// screen of a browser with no war yet, with no campaign to go back to.
/** The title's and lobby's hero plate, baked by scripts/plates.ts (public/plates, #3565): the insignia set in a bulkhead plate. */
const HERO = "/plates/hero.webp";
const SIDES: { id: Faction; pitch: string }[] = [
  { id: "marines", pitch: "Armoured and precise: walkers, gunships and orbital strikes. Win the sky, then land." },
  { id: "wooka", pitch: "A furry horde that knows every fern: outnumber them, hide in the jungle, spring traps." },
];
function chooseGame(first = false) {
  if (first) $("modal").classList.add("fresh");
  showModal(`<header class="crest${first ? " title" : ""}"><img class="hero" src="${HERO}" alt="Thunder Marines insignia on a bulkhead plate" width="960" height="300" />
      <h2>${first ? "Two Fronts<small>Thunderwooka Saga</small>" : "New campaign"}</h2>
      <p class="readout">Fleet command <i></i> Doren approach <i></i> Channel 07</p></header>
    ${first ? "" : `<p class="small">${game.kind === "local" ? "The campaign in this browser will be lost." : "You can come back to the online one from its link."}</p>`}
    <h3>Choose your side</h3>
    <div class="sides">${SIDES.map((s, i) => `<label class="side ${s.id}"><input type="radio" name="side" value="${s.id}"${i ? "" : " checked"} />
      <b>${FACTION_NAMES[s.id]}</b><span class="small">${s.pitch}</span></label>`).join("")}</div>
    <h3>Choose the war</h3>
    <div class="choices">${Object.values(GALAXIES).map((g, i) =>
      `<label title="${esc(g.blurb)}"><input type="radio" name="galaxy" value="${g.id}"${i ? "" : " checked"} /> ${g.name} <small>${g.systems.length} systems</small></label>`).join("")}</div>
    <p class="small">The short war is an evening, the full campaign several.</p>
    <div class="choices starts">
      <button type="button" data-start="ai" class="primary" title="Your side against the AI">${icon("bot", 15)} Against the AI</button>
      <button type="button" data-start="hotseat" title="Two players taking turns at this screen">${icon("users", 15)} Hotseat</button>
      <button type="button" data-start="online" title="Two players, a turn at a time, each from their own link">${icon("link", 15)} Online</button>
      ${canSignIn() ? `<button type="button" data-start="friends" title="${login() ? "Open a party your eqosys friends join, then start the war together" : "Sign in with eqosys to play your friends"}">${icon("user-plus", 15)} With friends</button>` : ""}
    </div>
    ${first ? "" : `<button type="button" id="close" class="link">Keep playing</button>`}`);
  // Who you are, on the title as in the panel: your eqosys name with Sign out, or Sign in.
  $("modal-body").querySelector("header.crest")?.append(accountChip(Object.assign(document.createElement("span"), { className: "account" }), { onSignOut: () => chooseGame(first) }));
}

/** "With friends": signed in, a party for the war picked here; signed out, eqosys's sign-in first. */
async function withFriends() {
  if (!login()) return void signIn();
  const galaxy = (document.querySelector<HTMLInputElement>('input[name="galaxy"]:checked')?.value ?? "short") as GalaxyId;
  const side = (document.querySelector<HTMLInputElement>('input[name="side"]:checked')?.value ?? "marines") as Faction;
  if (!(await openParty(side, galaxy))) flash("eqosys didn't open a party just now. Sign in again, or try in a minute.");
}

/** A party link: the lobby (who is in, Ready, the host's Start), then this page's seat in the war it starts. */
function showParty(p: NonNullable<ReturnType<typeof partyIn>>) {
  const signedIn = !!login();
  showModal(`<h2>${icon("user-plus", 18)} With friends</h2>
    <p>The ${FACTION_NAMES[p.side]} against the ${FACTION_NAMES[enemy(p.side)]}, ${GALAXIES[p.galaxy].name}. Whoever opened the party plays the ${FACTION_NAMES[p.side]}; the first friend in plays the other side.</p>
    ${signedIn ? `<div id="party-lobby"></div>` : `<p class="small">Sign in with eqosys to join this party.</p><button type="button" id="party-sign-in" class="primary">${icon("log-in", 15)} Sign in</button>`}
    <button type="button" id="leave-party" class="link">Not now</button>`);
  // eqosys sends players back to the page without its query, so the party rides along in `then` (boot reads it).
  if (!signedIn) return void ($("party-sign-in").onclick = () => void signIn(`party${location.search}`));
  const leave = joinParty(p.code, $("party-lobby"), async ({ room, seat, ticket }) => {
    try {
      const got = await claimSeat(room, { seat, side: p.side, galaxy: p.galaxy, ...(ticket && { ticket }) }, login()?.token ?? "");
      leave();
      history.replaceState(null, "", location.pathname);
      turnStart = null; phase = 1; $("modal").classList.remove("fresh");
      const link = { id: got.id, token: got.token };
      useGame({ kind: "online", link, view: await fetchView(link) });
      hideModal(); afterTurn();
    } catch (e) {
      flash(`Couldn't take your seat: ${(e as Error).message}`);
    }
  });
  $("leave-party").onclick = () => { leave(); history.replaceState(null, "", location.pathname); hideModal(); chooseGame(firstVisit); };
}

async function startGame(kind: "ai" | "hotseat" | "online",
  galaxy = (document.querySelector<HTMLInputElement>('input[name="galaxy"]:checked')?.value ?? "short") as GalaxyId,
  side = (document.querySelector<HTMLInputElement>('input[name="side"]:checked')?.value ?? "marines") as Faction, seed?: number) {
  const foe = enemy(side);
  turnStart = null; phase = 1; $("modal").classList.remove("fresh");
  const seats: Seats = { marines: "human", wooka: "human", [foe]: kind === "ai" ? "ai" : "human" };
  if (kind !== "online") {
    hideModal();
    try { localStorage.removeItem(ONLINE); } catch { /* private window */ }
    useGame({ kind: "local", table: newTable(seats, galaxy, seed, true) });
    return hotseat() ? passTo(seatUp()) : afterTurn();
  }
  try {
    const { id, tokens } = await startOnline(seats, galaxy);
    const link = { id, token: tokens[side]!, invite: tokens[foe] };
    useGame({ kind: "online", link, view: await fetchView(link) });
    showInvite();
  } catch (e) {
    flash(`Online play needs the Worker (bun run edge:dev): ${(e as Error).message}`);
  }
}

function useGame(g: Game, draft?: { turn: number; orders: Orders }) {
  game = g;
  void achieve("played"); void achieve("alpha");
  c = g.kind === "local" ? g.table.campaign : g.view.campaign;
  me = seatUp();
  mine = draft?.turn === c.turn && draft.orders.faction === me ? draft.orders : { faction: me, orders: [] };
  // Moves before the attacks are declared, retreats after, and deploys after the fighting.
  mine = c.deploying ? { faction: me, orders: [], deploys: mine.deploys ?? [] }
    : c.attacks ? { faction: me, orders: [], retreats: mine.retreats ?? [], ...(mine.hero && { hero: mine.hero }) }
    : { faction: me, orders: mine.orders, ...(mine.hero && { hero: mine.hero }), ...(c.setup && mine.deployment && { deployment: mine.deployment }) };
  loadout = c.setup && mine.deployment ? totals(mine.deployment) : null;
  selected = galaxyOf(c).systems.find((d) => c.systems[d.id]!.sectors.some((x) => x.owner === me))?.id ?? null;
  if (phaseTurn !== c.turn) { phase = 1; phaseTurn = c.turn; }
  const last = turnStart;
  turnStart = c.setup ? null : last && last.turn === c.turn && last.me === me ? last : { turn: c.turn, me, at: standing(c, me), fights: [] };
  save(); render();
  if (last && last.turn < c.turn && last.me === me && !c.winner && !hotseat()) showSummary(last);
}

// What the turn that just ended changed, in a few lines.
function showSummary(from: NonNullable<typeof turnStart>) {
  const lines = summary(from.at, standing(c, me), from.fights.map((b) => ({ label: `the ${b.space ? "space" : "ground"} battle at ${placeName(b.to)}`, win: b.win, won: won(c, me, b) })));
  showModal(`<h2>Turn ${from.turn} done</h2><ul class="recap">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <button type="button" id="close" class="primary">Turn ${c.turn}</button>`);
}

function showInvite() {
  const g = online();
  if (!g?.link.invite) return;
  showModal(`<h2>Your war, online</h2>
    <p>You're the ${FACTION_NAMES[g.view.seat]}. Send this link to whoever plays the ${FACTION_NAMES[enemy(g.view.seat)]}. Keep it to yourselves: the link is their seat.</p>
    <input id="seat-link" class="seat-link" readonly value="${esc(seatLink(g.link.id, g.link.invite))}" />
    <p><button type="button" id="copy-link">Copy link</button></p>
    <p class="small">Your own link, to play from another device: <a href="${esc(seatLink(g.link.id, g.link.token))}">this one</a>.</p>
    <button type="button" id="close" class="primary">To the map</button>`);
}

async function endTurn() {
  if (c.winner) return chooseGame();
  if (c.pending && heroFaction(c) === me) return afterTurn();
  if (!c.setup && !c.attacks && !c.deploying && phase < LAST) { phase++; return render(); }
  // The odds on this turn's fights, to set beside how they went.
  if (turnStart && !c.attacks && !c.deploying) turnStart.fights = forecast(seen(), me, mine.orders);
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
  if (p && heroFaction(c) === me) return p.kind === "space" ? briefSpace(p.spec, finishSpace) : brief(p.spec, undefined, finish);
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
function brief(spec: BattleSpec, jump: Jump | undefined, done: (r: BattleResult) => void) {
  const me = spec.hero, foe = me === "attacker" ? "defender" : "attacker";
  const horde = spec.factions[foe] === "wooka", place = PLACES[spec.sector];
  const vehicles = (s: Side) => {
    if (spec.factions[s] === "wooka") return "none, just more Wooka";
    const list = VEHICLE_KINDS.filter((k) => spec.vehicles[s][k]).map((k) => `${spec.vehicles[s][k]} ${k}${spec.vehicles[s][k]! > 1 ? "s" : ""}`);
    return list.join(", ") || "none";
  };
  const pods = (p: Pods) => (p.cap ? `up to ${p.cap}, ${p.perMinute}/min from 1:00` : "none");
  const row = (label: string, a: number | string, b: number | string) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
  const role = `You ${me === "attacker" ? "attack" : "defend"} as ${spec.factions[me] === "wooka" ? `a Wooka chieftain. The armoured ones came to hunt. Show them who the ${place.ours} belongs to` : "a Thunder Marine"}.${spec.mode && spec.mode !== "conquest" ? "" : " Take the command posts and run their tickets out."}`;
  const about = `${MODE_INFO[spec.mode ?? "conquest"].blurb} ${role}${horde && spec.factions[me] === "marines" ? ` You are not the hunter here. They know the ${place.know}, they know your smell, and they are already ${place.lurk}.` : ""}`;
  showModal(`<h2>Hero battle: ${spec.system}, ${SECTOR_NAMES[spec.sector].toLowerCase()}</h2>
    <p class="mode-line">${icon(MODE_INFO[spec.mode ?? "conquest"].icon, 16)}<b>${MODE_INFO[spec.mode ?? "conquest"].name}</b>${tip(about)}</p>
    <table class="spec"><tr><th></th><td>You</td><td>Enemy</td></tr>
      ${row("Armies", spec.armies[me], spec.armies[foe])}
      ${row("Tickets", spec.tickets[me], spec.tickets[foe])}
      ${row("Vehicles", vehicles(me), vehicles(foe))}
      ${row("Orbital strikes", spec.strikes[me], spec.strikes[foe])}
      ${row("Drop pods", pods(spec.reinforcements[me]), pods(spec.reinforcements[foe]))}
      ${row("Turrets", me === "defender" ? spec.turrets : 0, me === "attacker" ? spec.turrets : 0)}
    </table>
    ${tip("Strikes, drop pods and gunships come from holding the orbit, and the pods land only while the side holds a command post, and walkers from holding the world's capital. A shield generator held by the other side cuts strikes to one.")}
    <button type="button" id="drop-in" class="primary">Drop in</button> <button type="button" id="auto-battle">Let the AI fight it</button>`);
  const dropIn = async () => {
    hideModal();
    document.body.classList.add("in-battle");
    const { playBattle, endLiveBattle } = await import("./battle/view.ts");
    // A jump may start the fight already under way, skip the intros, and end itself for the win or loss screen.
    if (jump?.end) setTimeout(() => endLiveBattle(jump.end === "win" ? spec.hero : other(spec.hero)), jump.endAfter * 1000);
    const result = await playBattle(spec, $<HTMLCanvasElement>("battle-view"), $("battle-hud"), jump && { warm: jump.near, cuts: false });
    document.body.classList.remove("in-battle");
    done(result);
  };
  $("drop-in").onclick = dropIn;
  if (jump && !jump.brief) void dropIn();
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
    <p class="mode-line">${icon("orbit", 16)}<b>${ROUNDS} rounds</b>${tip(`You command the ${spec.factions[me] === "wooka" ? "Wooka raft fleet" : "Thunder Marine line"} for the orbit. Each round you pick an order, they pick one, and you see theirs once yours is in. More hull at the end holds the orbit.`)}</p>
    <table class="spec"><tr><th></th><td>You</td><td>Enemy</td></tr>
      <tr><th>${icon("rocket", 13)} Ships</th><td>${spec.fleets[me]}</td><td>${spec.fleets[foe]}</td></tr>
      <tr><th title="Armies on the world below: they board, and a bigger muster boards harder">${icon("shield-plus", 13)} Muster below</th><td>${spec.muster?.[me] ?? 0}</td><td>${spec.muster?.[foe] ?? 0}</td></tr>
      <tr><th title="Cannons, shields and upgraded guns below: they add to a screen or a bombardment">${icon("crosshair", 13)} Batteries below</th><td>${spec.batteries?.[me] ?? 0}</td><td>${spec.batteries?.[foe] ?? 0}</td></tr>
    </table>
    ${tip("Lose the orbit and the world is blockaded: nothing gets built there, supply through it is cut, their landings come down, and a fleet of two or more bombards the armies below every turn.")}
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

// Quick play, outside the campaign, on Doren, the forest moon: the Thunder Marines came to hunt and found
// themselves the quarry. Hold the line as a Thunder Marine, or be the horde that stalks them.
// `?world=canyon` (or capital, cannon, spaceport, jungle) plays the same fight on another sector's map.
const asked = new URLSearchParams(location.search).get("world");
const world = sectorOf(asked) ?? "shield";
// `jump`: a battle arrived at from the address or `window.twoFronts.jump` (jump.ts); the quick-play buttons have none.
function skirmish(wookaSide: boolean, mode: MatchMode = "conquest", jump?: Jump) {
  const side: Side = wookaSide ? "attacker" : "defender";
  const spec = jump ? jumpSpec(jump) : jumpSpec({ world, side, hero: wookaSide ? "wooka" : "marines", assist: true, handicap: false, mode, seed: Math.floor(Math.random() * 2 ** 31) });
  brief(spec, jump, (r) => {
    const won = r.winner === spec.hero;
    const asWooka = spec.factions[spec.hero] === "wooka";
    // The result, and the vote for a rematch against the AI, whose pointer wanders over too.
    const mine = spec.factions[spec.hero], theirs = spec.factions[other(spec.hero)];
    const votes: Partial<Record<Faction, MatchMode>> = { [theirs]: aiVote(spec.id, theirs, mode) };
    const screen = voteScreen($("vote"), {
      title: asWooka ? (won ? "The hunt is over" : "Driven back into the ferns") : won ? "Still breathing" : "Hunted down",
      text: asWooka ? (won ? "The generator is in pieces, the armoured ones are running, and someone is wearing a backpack as a hat." : "The Thunder Marines held. The forest remembers their smell.") : won ? "You came to Doren to hunt. You leave knowing what it is to be hunted. They'll be back. They always come back." : "Nobody heard them coming. They got into the backpacks.",
      seats: [{ faction: mine, who: "here" }, { faction: theirs, who: "ai", vote: votes[theirs] }],
      leave: { label: "Back to the map", title: "No rematch" },
      cast(f, m) { votes[f] = m; screen.update(votes, tally(spec.id, votes)); },
      done(picked) { if (picked) skirmish(asWooka, picked, jump && { ...jump, mode: picked, near: 0, seed: Math.floor(Math.random() * 2 ** 31) }); },
    });
  });
}
// The panel's fixed buttons and headings get their icons once.
$("restart").innerHTML = icon("rotate-ccw", 18);
// Signed in through eqosys, the account's name shows in the panel's header with a way out (the shared chip, in the
// war room's skin); otherwise a way in. Campaign seats are still secret links: the name is for show.
$("restart").before(accountChip(Object.assign(document.createElement("span"), { className: "account" }), { onSignOut: () => location.reload() }));
// Signed in, Spaces (your eqosys groups, text and voice) sits beside the name.
const spacesBtn = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn spaces-btn" });
$("restart").before(spacesBtn);
mountSpaces(spacesBtn);
$("hold-line").insertAdjacentHTML("afterbegin", icon("shield", 16));
$("be-horde").insertAdjacentHTML("afterbegin", icon("paw-print", 16));
$("dogfight").innerHTML = icon("rocket", 16);
$("orders-h").insertAdjacentHTML("afterbegin", icon("list-checks", 14));
$("log-h").insertAdjacentHTML("afterbegin", icon("scroll-text", 14));
$("hold-line").onclick = () => skirmish(false);
$("be-horde").onclick = () => skirmish(true);
// Quick play in orbit: three Thunder Marine ships hold the orbit over Doren against three Wooka ones,
// with a Thunder Marine outpost and its shield below and the Wooka horde in the ferns.
$("dogfight").title = "Quick battle: hold the orbit over Doren, picking orders or flying a fighter";
$("dogfight").onclick = () => {
  const spec: SpaceBattleSpec = {
    id: `dogfight-${Date.now()}`, turn: 0, system: "Doren", factions: { attacker: "wooka", defender: "marines" },
    hero: "defender", heroLevel: 1, fleets: { attacker: 3, defender: 3 },
    muster: { attacker: 4, defender: 2 }, batteries: { attacker: 0, defender: 1 }, seed: Math.floor(Math.random() * 2 ** 31),
  };
  briefSpace(spec, orbitOver(spec));
};
const orbitOver = (spec: SpaceBattleSpec) => (r: SpaceBattleResult) => {
  const won = r.winner === spec.hero, wooka = spec.factions[spec.hero] === "wooka";
  showModal(`<h2>${won ? (wooka ? "Orbit taken" : "Orbit held") : wooka ? "Driven off" : "Orbit lost"}</h2>
    <p>${won === wooka ? "There are Wooka in the cruisers now. They are pressing every button." : "The log gliders are drifting back to Doren. Some of them are still on fire."}</p>
    <button type="button" id="close" class="primary">Back to the map</button>`);
};
// Straight into the flown space battle from the address (`?orbit=1`, jump.ts), or watched with `watch=1`.
async function flyOrbit(o: NonNullable<ReturnType<typeof parseOrbit>>) {
  hideModal();
  document.body.classList.add("in-battle");
  const { playSpaceBattle } = await import("./battle/space-view.ts");
  const result = await playSpaceBattle(o.spec, $<HTMLCanvasElement>("battle-view"), $("battle-hud"), { watch: o.watch });
  document.body.classList.remove("in-battle");
  orbitOver(o.spec)(result);
}

function showModal(html: string) { $("modal-body").innerHTML = html; $("modal-body").className = "ui-panel ui-dialog"; $("modal").hidden = false; }
function hideModal() { $("modal").hidden = true; }

// Back from the battle's result: the next seat, or the waiting room.
document.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === "pass-on-after") { hideModal(); voteIfOpen(() => passTo(seatUp())); }
  else if (id === "back-to-map") { hideModal(); voteIfOpen(afterTurn); }
});

// Jump to a state (jump.ts): `?battle=1&world=desert&side=attacker&hero=wooka&assist=off&near=1&end=win` from the
// address, or the same from a script or an agent: `twoFronts.jump({ world: "station", side: "attacker" })`,
// `twoFronts.end("win")` to finish the battle on screen, `twoFronts.state()` for what is on screen.
const twoFronts = {
  jump(over: Record<string, string | number | boolean> = {}) {
    const q = new URLSearchParams({ battle: "1", ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    const j = parseJump(`?${q}`)!;
    hideModal();
    skirmish(j.side === "attacker", j.mode, j);
    return jumpSpec(j);
  },
  async end(winner: "win" | "loss" = "win") {
    const { endLiveBattle, liveBattle } = await import("./battle/view.ts");
    const b = liveBattle();
    return !!b && endLiveBattle(winner === "win" ? b.spec.hero : other(b.spec.hero));
  },
  async state() {
    const b = (await import("./battle/view.ts")).liveBattle();
    return b && { world: b.spec.sector, side: b.spec.hero, hero: b.spec.factions[b.spec.hero], assist: b.spec.assist !== false, time: Math.round(b.time), tickets: b.tickets, over: !!b.over };
  },
};
Object.assign(window, { twoFronts });

// The same three as commands: WebMCP tools for an agent, and the Cmd/Ctrl+K palette for a person.
const flat = (a: unknown): Record<string, string | number | boolean> =>
  Object.fromEntries(Object.entries(typeof a === "object" && a ? a : {}).filter((e): e is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof e[1])));
addCommands([
  { name: "tf_jump", title: "Jump into a battle", group: "Battle", description: "Drop straight into a ground battle: sector (forest, desert, city, beach, station), side (marines or wooka), assist (false for off), near (seconds the AI has fought), end (win or loss), mode, seed.",
    inputSchema: { type: "object", properties: { sector: { type: "string" }, side: { type: "string" }, assist: { type: "boolean" }, near: { type: "number" }, end: { type: "string" }, mode: { type: "string" }, seed: { type: "number" } } },
    execute: (a) => { const { assist, ...rest } = flat(a); return twoFronts.jump({ ...rest, ...(assist === false && { assist: "off" }) }); } },
  { name: "tf_end", title: "End the battle", group: "Battle", description: "Finish the battle on screen as a win or loss for the hero.",
    inputSchema: { type: "object", properties: { result: { type: "string", enum: ["win", "loss"] } } }, execute: async (a) => ({ ended: await twoFronts.end(flat(a).result === "loss" ? "loss" : "win") }) },
  { name: "tf_state", title: "Look at the battle", group: "Battle", description: "World, side, hero, assist, time and tickets of the battle on screen.",
    annotations: { readOnlyHint: true }, execute: async () => (await twoFronts.state()) ?? { battle: false } },
]);
mountPalette();

// Boot: a seat link in the address wins, then the online game this browser was last at, then the table.
async function boot() {
  reportButton();
  const back = await finishSignIn();
  if (back?.error) flash(back.error);
  // A party link, or one carried through eqosys's sign-in: its lobby first.
  const asked = partyIn(location.search) ?? (back?.then.startsWith("party?") ? partyIn(back.then.slice(5)) : null);
  if (asked) { history.replaceState(null, "", `?${new URLSearchParams({ party: asked.code, side: asked.side, galaxy: asked.galaxy })}`); useGame(game, { turn: c.turn, orders: mine }); return showParty(asked); }
  const fromHash = linkInHash();
  if (fromHash) history.replaceState(null, "", location.pathname + location.search);
  // `?war=short&side=wooka&vs=online` (jump.ts): a fresh war, once; the address drops it so a reload keeps playing.
  const war = fromHash ? null : parseWar(location.search);
  if (war) {
    history.replaceState(null, "", location.pathname);
    useGame(game);
    return void startGame(war.vs, war.galaxy, war.side, war.seed);
  }
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
  const orbit = parseOrbit(location.search);
  if (orbit) return void flyOrbit(orbit);
  const jump = parseJump(location.search);
  if (jump) return void skirmish(jump.side === "attacker", jump.mode, jump);
  if (firstVisit && !fromHash) return chooseGame(true);
  if (hotseat() && !c.winner) return passTo(seatUp());
  afterTurn();
}
void boot();
