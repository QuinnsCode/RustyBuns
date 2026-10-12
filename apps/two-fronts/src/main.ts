// The page: the strategy map and its orders panel, the briefing for a hero battle, the battle
// itself, and back. The campaign is saved in this browser after every change.
import { SECTOR_NAMES, FACTION_NAMES, neighbours, systemDef, SYSTEMS } from "./war/galaxy.ts";
import {
  COST, applyBattleResult, enemy, heroReady, income, keyShare, newCampaign, planOrders, resolveTurn,
  type Campaign, type Order, type Orders, type Where,
} from "./war/rules.ts";
import { aiOrders } from "./war/ai.ts";
import { drawMap } from "./ui/map.ts";
import { FLAVOR, run } from "./battle/sim.ts";
import type { BattleResult, BattleSpec, Side } from "./battle/contract.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE = "two-fronts:v2"; // v1 was the factions before they were the Marines and the Wooka

function load(): { campaign: Campaign; orders: Orders } | null {
  try { return JSON.parse(localStorage.getItem(SAVE) ?? "null"); } catch { return null; }
}
const saved = load();
let c: Campaign = saved?.campaign ?? newCampaign(Math.floor(Math.random() * 1e9));
let mine: Orders = saved?.orders ?? { faction: c.player, orders: [] };
let selected: string | null = null;
const save = () => { try { localStorage.setItem(SAVE, JSON.stringify({ campaign: c, orders: mine })); } catch { /* private window */ } };

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
  const draft = planOrders(c, [mine]).c, me = c.player, foe = enemy(me);
  $("map").innerHTML = drawMap(c, mine.orders, selected, mine.hero);
  const share = keyShare(c, me);
  $("status").innerHTML = `
    <div class="row"><b>Turn ${c.turn}</b><span title="Credits now, and next turn's income">◈ ${draft.credits[me]} <small>+${income(c, me)}/turn</small></span></div>
    <div class="war" title="Key sectors held (capitals and spaceports). Hold 75% to win; fall under 30% and your income halves.">
      <i class="marines" style="width:${keyShare(c, "marines") * 100}%"></i><i class="wooka" style="width:${keyShare(c, "wooka") * 100}%"></i>
    </div>
    <div class="row small"><span>War score ${Math.round(share * 100)}%</span><span>${heroReady(c) ? `Hero, level ${c.hero.level}` : `Hero wounded until turn ${c.hero.woundedUntil}`}</span></div>`;

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
            <button type="button" class="hero${isHero ? " on" : ""}" data-hero="${i}" ${heroReady(c) ? "" : "disabled"} title="${heroReady(c) ? "Play the battle here yourself, if one happens this turn" : "Your hero is wounded"}">⚔</button></div>
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
  $("end-turn").toggleAttribute("disabled", !!c.winner);
  if (c.winner) showModal(`<h2>${c.winner === me ? "Victory" : "Defeat"}</h2><p>${FACTION_NAMES[c.winner]} wins the war on turn ${c.turn - 1}.</p><button type="button" id="new-war" class="primary">New campaign</button>`);
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
  if (t.id === "new-war" || t.id === "confirm-new") { c = newCampaign(Math.floor(Math.random() * 1e9)); mine = { faction: c.player, orders: [] }; selected = null; hideModal(); save(); render(); return; }
  if (t.id === "restart") return showModal(`<h2>Start over?</h2><p>This campaign will be lost.</p><button type="button" id="confirm-new" class="primary">New campaign</button> <button type="button" id="close">Keep playing</button>`);
  if (t.id === "close") hideModal();
});
document.addEventListener("keydown", (e) => {
  const sys = (e.target as HTMLElement).closest?.<SVGGElement>("[data-system]");
  if (sys && (e.key === "Enter" || e.key === " ")) { selected = sys.dataset.system!; render(); }
});

function endTurn() {
  c = resolveTurn(c, [mine, aiOrders(c, enemy(c.player))]);
  mine = { faction: c.player, orders: [] };
  save(); render();
  if (c.pending) brief(c.pending.spec, finish);
}

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

function finish(result: BattleResult) {
  const spec = c.pending!.spec, won = result.winner === spec.hero;
  c = applyBattleResult(c, result);
  save(); render();
  showModal(`<h2>${won ? "Sector taken" : "Sector lost"}</h2>
    <p>${won ? (spec.hero === "attacker" ? `${spec.system}'s ${SECTOR_NAMES[spec.sector].toLowerCase()} is yours.` : "You held the line.") : "The battle went against you."}
      Tickets left: ${result.tickets[spec.hero]} to ${result.tickets[spec.hero === "attacker" ? "defender" : "attacker"]}.${result.heroDown ? " Your hero was carried off the field." : ""}</p>
    <button type="button" id="close" class="primary">Back to the map</button>`);
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

selected = SYSTEMS.find((d) => c.systems[d.id]!.sectors.some((x) => x.owner === c.player))?.id ?? null;
render();
if (c.pending) brief(c.pending.spec, finish);
