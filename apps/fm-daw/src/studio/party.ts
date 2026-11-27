// Qevent (#5915): an event built in the studio builder. A party is a name, a time (or open now) and its scenes; a
// scene is one performer's setup (a studio: their gear, instruments and layout, as the builder edits it). Every saved
// version of a party stays, so an old setup can be looked at and brought back. You can keep as many parties as you
// like, but only one is live: the room other people join. Every change hands back a new store, so the page can keep
// it in this browser and a sesh or an agent's tool can send the same data later.
import { arr, check, int, nul, obj, opt, str, type Of } from "@rustybuns/util/guard";
import type { StudioDef, Venue } from "./room.ts";
import { edit, MAX_SPOTS, Studio } from "./builder.ts";

export const MAX_PARTIES = 24;
export const MAX_SCENES = 12;
/** Saved versions kept per party, oldest dropped past this (a studio is a few kB; a browser keeps about 5 MB). */
export const MAX_VERSIONS = 60;

const ID = str(32, { re: /^[a-z0-9][a-z0-9-]*$/ });
const Scene = obj({ id: ID, performer: str(40, { min: 1 }), studio: Studio });
const Version = obj({ n: int(1, 1e6), at: int(0, 2 ** 53), note: str(80), scene: ID, scenes: arr(Scene, MAX_SCENES, { min: 1 }) });
export const Party = obj({
  id: ID, name: str(60, { min: 1 }),
  /** When it starts (ms since 1970), or null for open now. */
  when: nul(int(0, 2 ** 53)),
  /** The scene on stage: the performer up now. */
  scene: ID,
  scenes: arr(Scene, MAX_SCENES, { min: 1 }),
  versions: arr(Version, MAX_VERSIONS),
  /** The Qollab event this party is (an event on the owner's eqosys account, #6428): its room lets in whom the event does. */
  event: opt(str(40, { re: /^[\w-]{1,40}$/ })),
});
/** Every party this browser keeps, which one is open in the builder and which one is live. */
export const Parties = obj({ open: opt(ID), live: opt(ID), parties: arr(Party, MAX_PARTIES) });
export type Scene = Of<typeof Scene>;
export type Version = Of<typeof Version>;
export type Party = Of<typeof Party>;
export type Parties = Of<typeof Parties>;

export const EMPTY: Parties = { parties: [] };
/** Where this browser keeps its parties. */
export const PARTIES = "qollab-studio:parties";
export function stored(raw: string | null): Parties {
  if (!raw) return EMPTY;
  try { return check(Parties, JSON.parse(raw)) ?? EMPTY; } catch { return EMPTY; }
}

export type Done = { ok: true; store: Parties } | { ok: false; store: Parties; why: string };
const no = (store: Parties, why: string): Done => ({ ok: false, store, why });

function slug(name: string, taken: Iterable<string>, fallback: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 26) || fallback;
  const used = new Set(taken);
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
  return id;
}
const sceneOf = (p: Party) => p.scenes.find((s) => s.id === p.scene) ?? p.scenes[0]!;
export const openParty = (s: Parties) => s.parties.find((p) => p.id === s.open);
/** The scene on stage at the open party, the studio the builder shows. */
export const openScene = (s: Parties) => { const p = openParty(s); return p ? sceneOf(p) : undefined; };
/** The live party's studio on stage: the room /jam.html?studio=yours walks into while a party is live. */
export const liveStudio = (s: Parties) => { const p = s.parties.find((x) => x.id === s.live); return p ? sceneOf(p).studio : undefined; };
function withParty(s: Parties, id: string | undefined, f: (p: Party) => Party | string): Done {
  const p = s.parties.find((x) => x.id === id);
  if (!p) return no(s, "There's no party open");
  const next = f(p);
  if (typeof next === "string") return no(s, next);
  return { ok: true, store: { ...s, parties: s.parties.map((x) => (x === p ? next : x)) } };
}

/** Make a party for `when` (or open now, null), its first scene `studio` for `performer`, and open it. */
export function makeParty(s: Parties, name: string, when: number | null, studio: StudioDef, performer = "Opening act"): Done {
  name = name.trim();
  if (!name) return no(s, "A party needs a name");
  if (s.parties.length >= MAX_PARTIES) return no(s, `${MAX_PARTIES} parties is the most this browser keeps: take one away first`);
  const id = slug(name, s.parties.map((p) => p.id), "party");
  const scene: Scene = { id: "s1", performer, studio: structuredClone(studio) };
  const p: Party = { id, name: name.slice(0, 60), when, scene: scene.id, scenes: [scene], versions: [] };
  return { ok: true, store: { ...s, open: id, parties: [...s.parties, p] } };
}

/** Open a party in the builder (or none). */
export function open(s: Parties, id: string | undefined): Done {
  if (id !== undefined && !s.parties.some((p) => p.id === id)) return no(s, "No party by that name");
  return { ok: true, store: { ...s, open: id } };
}

/** Take a party away, with every version of it. */
export function dropParty(s: Parties, id: string): Done {
  if (!s.parties.some((p) => p.id === id)) return no(s, "No party by that name");
  return { ok: true, store: { parties: s.parties.filter((p) => p.id !== id), open: s.open === id ? undefined : s.open, live: s.live === id ? undefined : s.live } };
}

/** Make `id` the live party, the one room people join; whatever was live stops being. null takes it off. */
export function goLive(s: Parties, id: string | null): Done {
  if (id !== null && !s.parties.some((p) => p.id === id)) return no(s, "No party by that name");
  return { ok: true, store: { ...s, live: id ?? undefined } };
}

/** Open the plan as The Event (#6020): the open party goes live as it stands, or, with none open, a new one named
 *  `name` from `studio` (the room as planned) does. Nothing is built again: the stacks, their aim and the power travel in the studio. */
export function openAsEvent(s: Parties, name: string, studio: StudioDef): Done {
  if (openParty(s)) return goLive(s, s.open ?? null);
  const made = makeParty(s, name, null, studio);
  return made.ok ? goLive(made.store, made.store.open ?? null) : made;
}

/** Change the open party's name or time. */
export const reschedule = (s: Parties, patch: { name?: string; when?: number | null }): Done => withParty(s, s.open, (p) => {
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) return "A party needs a name";
  return { ...p, name: name ? name.slice(0, 60) : p.name, when: patch.when === undefined ? p.when : patch.when };
});

/** Tie the open party to one of the owner's Qollab events (its id), or to none (null): the room's door follows the event's. */
export const linkEvent = (s: Parties, event: string | null): Done => withParty(s, s.open, (p) => {
  const { event: _was, ...rest } = p;
  return event ? { ...rest, event } : rest;
});

/** The builder changed the scene on stage: keep it (the party's working copy, not a saved version). */
export const keepStudio = (s: Parties, studio: StudioDef): Done => withParty(s, s.open, (p) => ({
  ...p, scenes: p.scenes.map((x) => (x.id === p.scene ? { ...x, studio } : x)),
}));

/** Lay every scene of the open party out in one real venue (#5933), or take it away (null): the performers change over
 *  in the same place. Each scene keeps its own seats; a scene whose room the venue's edit refuses says why. */
export const setVenue = (s: Parties, venue: Venue | null): Done => withParty(s, s.open, (p) => {
  const scenes: Scene[] = [];
  for (const x of p.scenes) {
    const b = edit(x.studio, { t: "venue", venue });
    if (!b.ok) return `${x.performer}'s scene: ${b.why}`;
    scenes.push({ ...x, studio: b.def });
  }
  return { ...p, scenes };
});

/** A new scene for `performer`, starting from `studio` (the one on stage, as a rule), and put it on stage. */
export const addScene = (s: Parties, performer: string, studio: StudioDef): Done => withParty(s, s.open, (p) => {
  performer = performer.trim();
  if (!performer) return "A scene needs its performer's name";
  if (p.scenes.length >= MAX_SCENES) return `${MAX_SCENES} performers is the most a party holds`;
  const id = slug(performer, p.scenes.map((x) => x.id), "act");
  return { ...p, scene: id, scenes: [...p.scenes, { id, performer: performer.slice(0, 40), studio: structuredClone(studio) }] };
});

/** Put a scene on stage: the performers change over. */
export const switchScene = (s: Parties, id: string): Done => withParty(s, s.open, (p) =>
  p.scenes.some((x) => x.id === id) ? { ...p, scene: id } : "No scene by that name");

/** Take a scene out of the open party (the last one stays). */
export const dropScene = (s: Parties, id: string): Done => withParty(s, s.open, (p) => {
  if (!p.scenes.some((x) => x.id === id)) return "No scene by that name";
  if (p.scenes.length === 1) return "A party keeps at least one scene";
  const scenes = p.scenes.filter((x) => x.id !== id);
  return { ...p, scenes, scene: p.scene === id ? scenes[0]!.id : p.scene };
});

/**
 * Every performer's setup out at once: the scene on stage's room, with the other scenes' seats added in (their ids
 * marked with the scene's, so two drum kits stay two). A seat past the room's limit, or the same seat twice, is left
 * out. The builder's own check (`problems`) still says if two setups stand on each other.
 */
export function together(p: Party): StudioDef {
  const base = sceneOf(p), out = structuredClone(base.studio), seen = new Set(out.spots.map((x) => x.id));
  for (const sc of p.scenes) {
    if (sc === base) continue;
    for (const spot of sc.studio.spots) {
      if (out.spots.length >= MAX_SPOTS) break;
      const id = `${sc.id}-${spot.id}`.slice(0, 32).replace(/-+$/, "");
      if (seen.has(id)) continue;
      seen.add(id);
      out.spots.push({ ...structuredClone(spot), id, label: `${sc.performer}: ${spot.label}`.slice(0, 40) });
    }
  }
  return out;
}

/** Put every performer's setup out at once as its own scene ("Everyone"), on stage, to edit like the rest. */
export const everyone = (s: Parties): Done => {
  const p = openParty(s);
  if (!p) return no(s, "There's no party open");
  if (p.scenes.length < 2) return no(s, "One performer is already everyone: add a scene first");
  return addScene(s, "Everyone", together(p));
};

/**
 * Save a version of the open party (`note` says what changed). A version the same as the last one isn't saved twice.
 * Past MAX_VERSIONS the oldest goes.
 */
export const saveVersion = (s: Parties, note: string, at: number): Done => withParty(s, s.open, (p) => {
  const last = p.versions.at(-1);
  if (last && JSON.stringify([last.scene, last.scenes]) === JSON.stringify([p.scene, p.scenes])) return "Nothing has changed since the last version";
  const v: Version = { n: (last?.n ?? 0) + 1, at: Math.floor(at), note: note.trim().slice(0, 80), scene: p.scene, scenes: structuredClone(p.scenes) };
  return { ...p, versions: [...p.versions, v].slice(-MAX_VERSIONS) };
});

/** Bring back version `n`'s scenes. The versions stay as they were, so going back can be undone by bringing a later one back. */
export const restore = (s: Parties, n: number): Done => withParty(s, s.open, (p) => {
  const v = p.versions.find((x) => x.n === n);
  if (!v) return "No version by that number";
  return { ...p, scene: v.scene, scenes: structuredClone(v.scenes) };
});

/** A party's time, in words: "Open now", or the day and time it starts. */
export function whenWords(when: number | null, locale?: string): string {
  if (when === null) return "Open now";
  return new Date(when).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ---- on the owner's eqosys account (#5932): the Worker keeps one store per signed-in person (src/party-store.ts) ----
/** Who owns a store, as its join links name them: a hash of their eqosys id, never the id itself. */
export const OWNER = /^[0-9a-f]{24}$/;
/** The Qollab room the live party is: the same room for everyone who has its join link, on any device. */
export const partyRoom = (owner: string, id: string) => `party-${owner}-${id}`.slice(0, 64);
/** GET or PUT /parties?token=: your store on your account, and the owner key your join links carry. */
export const PartiesReply = obj({ owner: str(24, { re: OWNER }), store: Parties });
export type PartiesReply = Of<typeof PartiesReply>;
/** GET /party/<owner>: the live party as anyone with its link sees it (no versions, only the scene on stage). */
export const LiveParty = obj({ name: str(60, { min: 1 }), when: nul(int(0, 2 ** 53)), room: str(64), performer: str(40, { min: 1 }), studio: Studio });
export type LiveParty = Of<typeof LiveParty>;
/** The live party of `owner`'s store, or null when none is live. */
export function liveParty(s: Parties, owner: string): LiveParty | null {
  const p = s.parties.find((x) => x.id === s.live);
  if (!p) return null;
  const on = sceneOf(p);
  return { name: p.name, when: p.when, room: partyRoom(owner, p.id), performer: on.performer, studio: on.studio };
}

// ---- the join page follows the live party (#5963): the owner's scene switch reaches everyone already in its room ----
/** The owner key a join link carries (`&party=`), or null: not a party's link. */
export function partyFrom(search: string): string | null {
  const o = new URLSearchParams(search).get("party");
  return o && OWNER.test(o) ? o : null;
}
/** How often a join page asks the owner's store what is on stage. */
export const FOLLOW_MS = 4_000;
/**
 * Where a join page goes when the owner's live party changed: the same link with the scene on stage now (and the new
 * party's room when another one went live), so everyone walks into the next performer's setup. Null: stay (it is
 * the one standing here, or nothing is live now, so the room people are in keeps going).
 */
export function partyFollow(href: string, live: LiveParty | null, standing: StudioDef): string | null {
  if (!live) return null;
  const u = new URL(href);
  if (u.searchParams.get("room") === live.room && JSON.stringify(live.studio) === JSON.stringify(standing)) return null;
  u.searchParams.set("room", live.room);
  u.searchParams.set("studio", "yours");
  u.searchParams.set("built", JSON.stringify(live.studio));
  u.searchParams.set("name", live.name);
  return u.href;
}
/** The join page's invite line: the party, who is on, and when it starts if it hasn't yet. */
export function invitedWords(live: LiveParty, now: number, locale?: string): string {
  const starts = live.when !== null && live.when > now ? ` It starts ${whenWords(live.when, locale)}.` : "";
  return `You're invited to ${live.name}. ${live.performer} is on.${starts}`;
}
