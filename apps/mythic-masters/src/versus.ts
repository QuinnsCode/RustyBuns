// Fight a friend, the page's screens: your Qollab friends (eqosys's hub: who they are, whether they're in the game) and
// the challenges they sent you, and a duel's room, where the two of you pick from your own line-ups and go straight into
// an arena fight. A challenge is a note through your hub to theirs with a link to `?duel=CODE`; whoever opens the link
// first sits in seat 0. "Team up vs the wilds" is the same room for two to four (`?coop=CODE`, #4400): you all pick,
// and fight one wild creature together, which every page plays as the same seeded bot (`wildOf`). The fight itself is
// main.ts's, on inputs from net/duel-link.ts. Walking together, the same room opens at a wild den or a keeper (#4413):
// the one who walked in sits first and brings what lives there (`DenAt`), a friend in the region joins from a prompt, and
// you fight that creature instead of a seeded one.
import { esc, mulberry32 } from "@rustybuns/util";
import type { HubView } from "@rustybuns/util/eqosys";
import { APP, canSignIn, fresh, hub, login, signIn } from "./account.ts";
import { icon } from "./icons.ts";
import type { Member } from "./journey.ts";
import { DuelLink, type DuelOpts } from "./net/duel-link.ts";
import { coopCode, duelCode, mintDuel, type DenFoe, type DuelOut, type Pick, type RoomKind } from "./net/duel.ts";
import { atLevel } from "./journey.ts";
import { creature, ROSTER, type Creature } from "./roster.ts";
import { tierOf } from "./tiers.ts";

type Go = Extract<DuelOut, { t: "go" }>;
/** What a co-op room can meet: the everyday wild ones, never a legend or an event creature. */
const WILDS = ROSTER.filter((c) => tierOf(c.id) === "common" || tierOf(c.id) === "uncommon").map((c) => c.id);
/** The wild one a co-op round fights, the same on every page: chosen by the room's seed, a few levels past the
 *  strongest pick for every friend past the first, so two or four of you still have a fight on your hands. */
export function wildOf(go: { picks: Pick[]; seed: number; foe?: DenFoe }): Pick {
  if (go.foe) return { c: go.foe.c, lv: go.foe.lv }; // the den's own creature, as the world put it there
  const c = WILDS[Math.floor(mulberry32(go.seed)() * WILDS.length)]!;
  return { c, lv: Math.min(100, Math.max(...go.picks.map((p) => p.lv)) + 3 * (go.picks.length - 1)) };
}
/** A co-op round's two sides: the friends in seat order, then the wild one (a keeper is no wild one). */
export function coopTeams(go: { picks: Pick[]; seed: number; foe?: DenFoe }): [Creature[], Creature[]] {
  const w = wildOf(go);
  return [go.picks.map((p) => atLevel(creature(p.c), p.lv)), [atLevel(creature(w.c), w.lv, !go.foe?.den.startsWith("keeper:"))]];
}

/** A challenge older than this is stale: the friend has long stopped waiting. */
export const CHALLENGE_MS = 30 * 60_000;
/** How often the friends list asks the hub again while it's open. */
const POLL_MS = 6000;

export interface Challenge { from: string; code: string; at: number; kind?: "coop" }
/** The challenges in a hub's notes: this game's, with a duel or co-op link on this site, newest first, one per friend. */
export function challenges(v: HubView, origin: string, now = Date.now()): Challenge[] {
  const seen = new Set<string>(), out: Challenge[] = [];
  for (const n of [...v.notes].sort((a, b) => b.at - a.at)) {
    if (n.kind !== "app" || n.app !== APP || !n.link || now - n.at > CHALLENGE_MS || seen.has(n.from.id)) continue;
    let u: URL;
    try { u = new URL(n.link); } catch { continue; }
    const code = duelCode(u.search), coop = coopCode(u.search);
    if (u.origin !== origin || !(code || coop)) continue;
    seen.add(n.from.id);
    out.push(code ? { from: n.from.name || "A friend", code, at: n.at } : { from: n.from.name || "A friend", code: coop!, at: n.at, kind: "coop" });
  }
  return out;
}

/** A co-op room opened at a den or a keeper: what lives there, whether we walked in (`host`: our pick brings the foe),
 *  and where "Fight alone" (the host) or "Back to the world" (a friend) goes. */
export interface DenAt { foe: DenFoe; host: boolean; alone(): void }

export interface VersusHost {
  /** Turn the book to this screen. */
  show(el: HTMLElement): void;
  /** Back to the title. */
  title(): void;
  /** Your line-up, or null before a journey has started. */
  lineUp(): Member[] | null;
  /** The room said go: fight round `r` with these picks, from seat `you`; a co-op round adds the wild one. */
  fight(go: Go, you: number, names: string[], kind: RoomKind): void;
  /** The friend left, the link dropped, or the pages fell out of step, while a fight was on. */
  broken(why: string): void;
  /** Link options for a harness (a guest's uid, another host). */
  opts?: () => Partial<DuelOpts>;
}

export function mountVersus(el: HTMLElement, host: VersusHost) {
  let link: DuelLink | null = null, den: DenAt | null = null, kind: RoomKind = "duel", picked: number | null = null, poll: ReturnType<typeof setInterval> | undefined, view: HubView | null = null, note = "";
  const signedIn = () => { const l = login(); return !!l && fresh(l); };
  /** The others in the room, by name. */
  const friendNames = () => { const s = link?.seats; return s ? s.names.filter((n, k): n is string => n !== null && k !== s.you) : []; };
  const friendName = () => friendNames().join(" and ") || null;

  // --- the friends list --------------------------------------------------------------------------------
  async function refresh() { view = await hub().state(); if (!link) drawFriends(); }
  function drawFriends() {
    const sheet = (body: string) => { el.innerHTML = `<div class="sheet paper"><h1>${icon("users")} Fight a Friend</h1>${body}<div class="row"><button id="vsBack">${icon("x")} Back</button></div></div>`; el.querySelector("#vsBack")!.addEventListener("click", leave); };
    if (!signedIn()) {
      sheet(`<p class="tag">Sign in with eqosys and your friends are here: challenge one, and you both go straight into the arena with what you've caught.</p>
        ${canSignIn() ? `<div class="row"><button class="go" id="vsSignIn">${icon("log-in")} Sign in</button></div>` : ""}`);
      el.querySelector("#vsSignIn")?.addEventListener("click", () => void signIn("versus"));
      return;
    }
    if (!host.lineUp()?.length) { sheet(`<p class="tag">You fight with what you've caught: start a journey and bind a few first.</p>`); return; }
    if (!view) { sheet(`<p class="tag">Asking eqosys who your friends are...</p>`); return; }
    const asks = challenges(view, location.origin);
    const inGame = (f: HubView["friends"][number]) => f.presence.some((p) => p.app === APP);
    const friends = [...view.friends].sort((a, b) => Number(inGame(b)) - Number(inGame(a)) || a.name.localeCompare(b.name));
    sheet(`<div class="row"><button class="go" id="vsCoop">${icon("swords")} Team up vs the wilds</button></div>
      ${asks.length ? `<h2>Challenges</h2><ul class="vs-list">${asks.map((c) => `<li><b>${esc(c.from)}</b><small>${c.kind ? "wants to team up" : "challenged you"}</small><button class="go" data-accept="${c.code}" data-kind="${c.kind ?? "duel"}">${icon("play")} Accept</button></li>`).join("")}</ul>` : ""}
      <h2>Friends</h2>${friends.length ? `<ul class="vs-list">${friends.map((f) => `<li><b>${esc(f.name || "A friend")}</b><small>${inGame(f) ? "in Mythic Masters" : ""}</small><button data-challenge="${esc(f.id)}">${icon("zap")} Challenge</button><button data-challenge="${esc(f.id)}" data-kind="coop" title="Team up vs the wilds" aria-label="Team up vs the wilds">${icon("swords")}</button></li>`).join("")}</ul>` : `<p class="tag">No friends yet.</p>`}
      <p class="tag"><a href="${esc(hub().friendsPage())}" target="_blank" rel="noopener">${icon("link")} Add friends on eqosys</a></p>${note ? `<p class="note">${esc(note)}</p>` : ""}`);
    el.querySelectorAll<HTMLElement>("[data-accept]").forEach((b) => b.addEventListener("click", () => enter(b.dataset.accept!, b.dataset.kind === "coop" ? "coop" : "duel")));
    el.querySelector("#vsCoop")!.addEventListener("click", () => enter(mintDuel(), "coop"));
    el.querySelectorAll<HTMLButtonElement>("[data-challenge]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const code = mintDuel(), name = view?.friends.find((f) => f.id === b.dataset.challenge)?.name ?? "your friend", k: RoomKind = b.dataset.kind === "coop" ? "coop" : "duel";
      const why = await hub().notify(b.dataset.challenge!, k === "coop" ? "wants to team up against the wilds in Mythic Masters" : "challenges you to a fight in Mythic Masters", `${location.origin}/?${k}=${code}`);
      if (why) { note = `Couldn't ask ${name}: ${why}`; drawFriends(); return; }
      enter(code, k);
    }));
  }

  /** The friends list: open it, and keep it fresh while it's up. */
  function open() {
    leaveRoom(); note = "";
    history.replaceState(null, "", "?vs=1");
    drawFriends(); host.show(el);
    if (signedIn()) { void refresh(); clearInterval(poll); poll = setInterval(() => { if (!el.hidden && !link) void refresh(); }, POLL_MS); }
  }

  // --- a duel's room -----------------------------------------------------------------------------------
  function enter(code: string, k: RoomKind = "duel", at: DenAt | null = null) {
    clearInterval(poll);
    leaveRoom();
    picked = null; kind = at ? "coop" : k; inRound = 0; den = at;
    if (!at) history.replaceState(null, "", `?${kind}=${code}`); // a den's room is part of a walk: the world's address stays
    link = new DuelLink(code, {
      kind,
      onSeats: () => drawRoom(),
      onStatus: () => drawRoom(),
      onGo: (g) => {
        const s = link?.seats, you = s?.you ?? 0, names = g.picks.map((_, k) => (k === you ? "You" : s?.names[k] ?? "A friend"));
        inRound = g.picks.length;
        host.fight(g, you, names, kind);
      },
      onDesync: () => host.broken(`Your fights fell out of step, so this one is called off.`),
      ...host.opts?.(),
    });
    drawRoom(); host.show(el);
  }
  function drawRoom() {
    if (!link) return;
    const team = host.lineUp() ?? [], s = link.seats, them = friendName(), coop = kind === "coop";
    const theirsIn = !!s && s.names.every((n, k) => n === null || k === s.you || s.picked[k]);
    // Someone in the fight left while it was on: lockstep can't go on without their hands.
    if (link.step && s && s.names.filter((n) => n !== null).length < inRound) { link.step = null; host.broken(coop ? "A friend left the fight." : "Your friend left the fight."); }
    if (link.step && link.status !== "in") { link.step = null; host.broken("The link to your friend dropped."); }
    const room = coop ? "co-op room" : "duel";
    const say = { joining: `Opening the ${room}...`, offline: `Lost the ${room}'s link; trying again.`, full: coop ? "This co-op room is full." : "Two are already fighting in this duel.", signin: "Sign in with eqosys again to fight.",
      in: them ? `${esc(them)} ${friendNames().length > 1 ? "are" : "is"} here${theirsIn ? ", all picked" : ", picking"}.${coop ? " Pick, and you all go in together." : ""}` : den ? "Your friends in this region were asked to join. Pick, and you go in once one of them has." : coop ? "Waiting for a friend: send them the link." : "Waiting for your friend to open the challenge." }[link.status];
    const head = den ? `Team up vs ${esc(creature(den.foe.c).name)} <small>Lv ${den.foe.lv}</small>` : `${coop ? "Team up vs the wilds" : "Duel"} <small>${esc(link.code)}</small>`;
    const out = den ? `<button id="vsLeave">${icon(den.host ? "swords" : "map")} ${den.host ? "Fight alone" : "Back to the world"}</button>` : `<button id="vsCopy">${icon("link")} Copy link</button><button id="vsLeave">${icon("x")} Leave</button>`;
    el.innerHTML = `<div class="sheet paper duel"><h1>${icon(coop ? "swords" : "zap")} ${head}</h1>
      <p class="tag" role="status">${say}</p>
      ${link.status === "in" ? `<h2>Who fights for you?</h2><div class="five">${team.map((mm, i) => { const c = creature(mm.id); return `<button class="card starter${picked === i ? " on" : ""}" data-pick="${i}" aria-pressed="${picked === i}"><b>${esc(c.name)}</b><small>Lv ${mm.level} · ${esc(c.archetype)}</small></button>`; }).join("")}</div>` : ""}
      <div class="row">${out}</div></div>`;
    el.querySelectorAll<HTMLElement>("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const mm = team[Number(b.dataset.pick)];
      if (!mm) return;
      picked = Number(b.dataset.pick);
      link?.pick(pickOf(mm), den?.host ? den.foe : undefined);
      drawRoom();
    }));
    el.querySelector("#vsCopy")?.addEventListener("click", () => void navigator.clipboard?.writeText(`${location.origin}/?${kind}=${link?.code}`));
    el.querySelector("#vsLeave")!.addEventListener("click", () => { const at = den; if (!at) { leave(); return; } leaveRoom(); at.alone(); });
  }
  const pickOf = (mm: Member): Pick => ({ c: mm.id, lv: mm.level });
  /** How many sit in the round being fought (0 between rounds). */
  let inRound = 0;

  function leaveRoom() { link?.close(); link = null; den = null; }
  function leave() { clearInterval(poll); leaveRoom(); host.title(); }

  return {
    open, enter, leave,
    /** Out of the room without turning to the title: a den's co-op fight is over, and the world is next. */
    drop: leaveRoom,
    /** The line-up member we picked last, by its place in the line-up. */
    picked: () => picked,
    /** The live duel, while there is one. */
    link: () => link,
    /** After a fight: the same pick again, or back to the room to choose. */
    rematch: () => { const mm = picked === null ? null : host.lineUp()?.[picked]; if (link && mm) { link.pick(pickOf(mm), den?.host ? den.foe : undefined); drawRoom(); host.show(el); } },
    room: () => { picked = null; drawRoom(); host.show(el); },
    friend: friendName,
  };
}
