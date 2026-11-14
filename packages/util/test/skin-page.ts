// The page skin.test.ts and scripts/skin-shots.ts load (served by skin-server.ts): a game's eqosys client with a skin (the
// house look with ?house, a real game's with ?game=<app>, over that game's own stylesheet), signed in, with its account chip,
// report form, an achievement toast, a party lobby and the spaces panel mounted, the last two on stand-in clients that answer
// the way a live party and a space do (two members and the rules; three spaces, one open on its chat).
import { celebrate, eqosys, type PartyMember, type SpaceHandlers } from "../src/eqosys.ts";
import { lobbyPanel } from "../src/lobby.ts";
import { defaultRules, type PartyRules } from "../src/party-rules.ts";
import { spacesPanel } from "../src/spaces.ts";
import { ICONS, type Skin } from "../src/skin.ts";
import { SKIN as twoFronts } from "../../../apps/two-fronts/src/eqosys.ts";
import { SKIN as mythic } from "../../../apps/mythic-masters/src/account.ts";
import { SKIN as skate } from "../../../apps/skate-tech-park/src/eqosys.ts";

// The games' modules each wear their skin as they load, so the house look is asked for outright (an empty skin).
const house = location.search.includes("house");
const games: Record<string, Skin | undefined> = { "two-fronts": twoFronts, "mythic-masters": mythic, "skate-tech-park": skate };
const game = games[new URLSearchParams(location.search).get("game") ?? ""];
localStorage.setItem("t.eqosys", location.origin);
localStorage.setItem("t.login", JSON.stringify({ name: "Ada", email: "ada@example.com", token: "x" }));
const client = eqosys({ app: "t", url: location.origin, from: [], prefix: "t", ...(house ? { skin: {} } : game ? { skin: game } : { skin: { theme: { "--ui-bg": "rgb(28, 33, 40)", "--ui-line": "rgb(156, 122, 42)", "--ui-radius": "1px", "--ui-radius-sm": "1px", "--ui-font": "Courier" }, css: ".eq-who{text-transform:uppercase}" } }) });
const column = Object.assign(document.createElement("main"), { style: "position:relative;display:grid;gap:12px;align-content:start;max-width:440px;padding:120px 12px 12px;max-height:100dvh;overflow:auto;box-sizing:border-box" });
document.body.append(column);
column.append(client.accountChip(document.createElement("div")));
client.reportButton();
if (!location.search.includes("closed")) document.querySelector<HTMLButtonElement>(".rb-report > .eq-btn")!.click();
celebrate({ id: "played", name: "First muster", blurb: "Played a battle", secret: false, at: 1 }, 0);

const noop = () => {};
const on = <T,>() => { let f: (v: T) => void = noop; return { set: (g: (v: T) => void) => { f = g; }, fire: (v: T) => f(v) }; };
const members = on<PartyMember[]>();
const rules = on<{ rules: PartyRules; invite?: string }>();
// Voice: Join voice asks for a ticket, and the party hands one straight back; the "call" lists who is talking.
const ticket = on<{ url: string; ticket: string }>(), voiceSaid: string[] = [];
const party = { talk: () => ticket.fire({ url: "https://qlave.test", ticket: "t" }), inVoice: (on: boolean) => voiceSaid.push(on ? "in" : "out"), onTicket: ticket.set, join: noop, leave: noop, ready: noop, start: noop, rules: noop, hide: noop, mute: noop, report: noop, makeHost: noop, kick: noop, block: noop, relink: noop,
  hidden: () => new Set<string>(), onMembers: members.set, onRules: rules.set, onRefused: noop, onGone: noop, onStart: noop } as unknown as Parameters<typeof lobbyPanel>[0]["party"];
const call = { selfMuted: false, left: false };
const joinVoice = async () => ({
  onSpeakers: (f: (l: { sub: string; name: string; talking: boolean; muted: boolean; self: boolean }[]) => void) => f([{ sub: "a", name: "Ada", talking: false, muted: false, self: true }, { sub: "b", name: "Grace", talking: true, muted: false, self: false }]),
  onGone: noop, muteSelf: (on: boolean) => { call.selfMuted = on; }, leave: () => { call.left = true; },
}) as unknown as Awaited<ReturnType<NonNullable<Parameters<typeof lobbyPanel>[0]["join"]>>>;
lobbyPanel({ code: "KRTZ", box: column.appendChild(document.createElement("div")), party, name: () => "Ada", link: () => location.href, onStart: noop, join: joinVoice });
rules.fire({ rules: defaultRules(), invite: "k" });
members.fire([{ id: "a", name: "Ada", host: true, ready: true }, { id: "b", name: "Grace", host: false, ready: true }]);

// The spaces panel asks the game for its icons; these are lucide's, the ones skin.ts lacks drawn here.
const PATHS: Record<string, string> = { "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  "trash-2": '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>' };
const icon = (name: string) => { const i = document.createElement("i"); i.innerHTML = name in ICONS ? ICONS[name as keyof typeof ICONS] : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? PATHS.plus}</svg>`; i.style.display = "contents"; return i; };
const said = [["Grace", "Ready when you are"], ["Ada", "Two more minutes"], ["Grace", "Bring the map this time"]] as const;
const space = {
  mine: async () => [{ id: "s1", name: "Night crew", owner: true }, { id: "s2", name: "Weekend league", owner: false }, { id: "s3", name: "Map makers", owner: false }],
  open: (_id: string, h: SpaceHandlers) => queueMicrotask(() => {
    h.space?.({ name: "Night crew", channels: ["general", "plans"], voice: [{ id: "v1", name: "Lounge" }], owner: true });
    h.online?.([{ id: "a", name: "Ada" }, { id: "b", name: "Grace" }]);
    h.history?.("general", said.map(([name, text], i) => ({ id: i + 1, from: { id: name, name }, text, at: 1_700_000_000_000 + i * 60_000 })), false);
  }),
  history: noop, close: noop, say: noop, leave: noop, inVoice: noop, talk: noop, drop: noop, channel: noop, mute: noop, kick: noop, report: noop, make: noop,
} as unknown as Parameters<typeof spacesPanel>[0]["space"];
spacesPanel({ box: column.appendChild(document.createElement("div")), space, name: () => "Ada", icon, start: "s1" });

// For skin.test.ts: a member's change, as the party would send it.
Object.assign(window, { members: members.fire, call, voiceSaid });
