// Fight a friend, the page's screens: your Qollab friends (eqosys's hub: who they are, whether they're in the game) and
// the challenges they sent you, and a duel's room, where the two of you pick from your own line-ups and go straight into
// an arena fight. A challenge is a note through your hub to theirs with a link to `?duel=CODE`; whoever opens the link
// first sits in seat 0. The fight itself is main.ts's, on inputs from net/duel-link.ts.
import { esc } from "@rustybuns/util";
import type { HubView } from "@rustybuns/util/eqosys";
import { APP, canSignIn, fresh, hub, login, signIn } from "./account.ts";
import { icon } from "./icons.ts";
import type { Member } from "./journey.ts";
import { DuelLink, type DuelOpts } from "./net/duel-link.ts";
import { duelCode, mintDuel, type DuelOut, type Pick } from "./net/duel.ts";
import { creature } from "./roster.ts";

/** A challenge older than this is stale: the friend has long stopped waiting. */
export const CHALLENGE_MS = 30 * 60_000;
/** How often the friends list asks the hub again while it's open. */
const POLL_MS = 6000;

export interface Challenge { from: string; code: string; at: number }
/** The challenges in a hub's notes: this game's, with a duel link on this site, newest first, one per friend. */
export function challenges(v: HubView, origin: string, now = Date.now()): Challenge[] {
  const seen = new Set<string>(), out: Challenge[] = [];
  for (const n of [...v.notes].sort((a, b) => b.at - a.at)) {
    if (n.kind !== "app" || n.app !== APP || !n.link || now - n.at > CHALLENGE_MS || seen.has(n.from.id)) continue;
    let u: URL;
    try { u = new URL(n.link); } catch { continue; }
    const code = duelCode(u.search);
    if (u.origin !== origin || !code) continue;
    seen.add(n.from.id);
    out.push({ from: n.from.name || "A friend", code, at: n.at });
  }
  return out;
}

export interface VersusHost {
  /** Turn the book to this screen. */
  show(el: HTMLElement): void;
  /** Back to the title. */
  title(): void;
  /** Your line-up, or null before a journey has started. */
  lineUp(): Member[] | null;
  /** The room said go: fight round `r` with these picks, from seat `you`. */
  fight(go: Extract<DuelOut, { t: "go" }>, you: 0 | 1, names: [string, string]): void;
  /** The friend left, the link dropped, or the pages fell out of step, while a fight was on. */
  broken(why: string): void;
  /** Link options for a harness (a guest's uid, another host). */
  opts?: () => Partial<DuelOpts>;
}

export function mountVersus(el: HTMLElement, host: VersusHost) {
  let link: DuelLink | null = null, picked: number | null = null, poll: ReturnType<typeof setInterval> | undefined, view: HubView | null = null, note = "";
  const signedIn = () => { const l = login(); return !!l && fresh(l); };
  const friendName = () => { const s = link?.seats; return s ? s.names[s.you ? 0 : 1] : null; };

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
    sheet(`${asks.length ? `<h2>Challenges</h2><ul class="vs-list">${asks.map((c) => `<li><b>${esc(c.from)}</b><small>challenged you</small><button class="go" data-accept="${c.code}">${icon("play")} Accept</button></li>`).join("")}</ul>` : ""}
      <h2>Friends</h2>${friends.length ? `<ul class="vs-list">${friends.map((f) => `<li><b>${esc(f.name || "A friend")}</b><small>${inGame(f) ? "in Mythic Masters" : ""}</small><button data-challenge="${esc(f.id)}">${icon("zap")} Challenge</button></li>`).join("")}</ul>` : `<p class="tag">No friends yet.</p>`}
      <p class="tag"><a href="${esc(hub().friendsPage())}" target="_blank" rel="noopener">${icon("link")} Add friends on eqosys</a></p>${note ? `<p class="note">${esc(note)}</p>` : ""}`);
    el.querySelectorAll<HTMLElement>("[data-accept]").forEach((b) => b.addEventListener("click", () => enter(b.dataset.accept!)));
    el.querySelectorAll<HTMLButtonElement>("[data-challenge]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const code = mintDuel(), name = view?.friends.find((f) => f.id === b.dataset.challenge)?.name ?? "your friend";
      const why = await hub().notify(b.dataset.challenge!, `challenges you to a fight in Mythic Masters`, `${location.origin}/?duel=${code}`);
      if (why) { note = `Couldn't challenge ${name}: ${why}`; drawFriends(); return; }
      enter(code);
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
  function enter(code: string) {
    clearInterval(poll);
    leaveRoom();
    picked = null;
    history.replaceState(null, "", `?duel=${code}`);
    link = new DuelLink(code, {
      onSeats: () => drawRoom(),
      onStatus: () => drawRoom(),
      onGo: (g) => {
        const s = link?.seats, you = s?.you ?? 0, names: [string, string] = [s?.names[0] ?? "", s?.names[1] ?? ""];
        names[you] = "You";
        host.fight(g, you, names);
      },
      onDesync: () => host.broken("Your two fights fell out of step, so this one is called off."),
      ...host.opts?.(),
    });
    drawRoom(); host.show(el);
  }
  function drawRoom() {
    if (!link) return;
    const team = host.lineUp() ?? [], s = link.seats, them = friendName(), theirsIn = !!s && s.picked[s.you ? 0 : 1];
    // The friend left while a fight was on: it can't go on.
    if (link.step && s && !them) { link.step = null; host.broken("Your friend left the fight."); }
    if (link.step && link.status !== "in") { link.step = null; host.broken("The link to your friend dropped."); }
    const say = { joining: "Opening the duel...", offline: "Lost the duel's link; trying again.", full: "Two are already fighting in this duel.", signin: "Sign in with eqosys again to fight.", in: them ? `${esc(them)} is here${theirsIn ? " and has picked" : ", picking"}.` : "Waiting for your friend to open the challenge." }[link.status];
    el.innerHTML = `<div class="sheet paper duel"><h1>${icon("zap")} Duel <small>${esc(link.code)}</small></h1>
      <p class="tag" role="status">${say}</p>
      ${link.status === "in" ? `<h2>Who fights for you?</h2><div class="five">${team.map((mm, i) => { const c = creature(mm.id); return `<button class="card starter${picked === i ? " on" : ""}" data-pick="${i}" aria-pressed="${picked === i}"><b>${esc(c.name)}</b><small>Lv ${mm.level} · ${esc(c.archetype)}</small></button>`; }).join("")}</div>` : ""}
      <div class="row"><button id="vsCopy">${icon("link")} Copy link</button><button id="vsLeave">${icon("x")} Leave</button></div></div>`;
    el.querySelectorAll<HTMLElement>("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const mm = team[Number(b.dataset.pick)];
      if (!mm) return;
      picked = Number(b.dataset.pick);
      link?.pick(pickOf(mm));
      drawRoom();
    }));
    el.querySelector("#vsCopy")!.addEventListener("click", () => void navigator.clipboard?.writeText(`${location.origin}/?duel=${link?.code}`));
    el.querySelector("#vsLeave")!.addEventListener("click", leave);
  }
  const pickOf = (mm: Member): Pick => ({ c: mm.id, lv: mm.level });

  function leaveRoom() { link?.close(); link = null; }
  function leave() { clearInterval(poll); leaveRoom(); host.title(); }

  return {
    open, enter, leave,
    /** The live duel, while there is one. */
    link: () => link,
    /** After a fight: the same pick again, or back to the room to choose. */
    rematch: () => { const mm = picked === null ? null : host.lineUp()?.[picked]; if (link && mm) { link.pick(pickOf(mm)); drawRoom(); host.show(el); } },
    room: () => { picked = null; drawRoom(); host.show(el); },
    friend: friendName,
  };
}
