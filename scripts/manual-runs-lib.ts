// The manual-run queue: which open MANUAL RUN issues an app's jump-to-state harness can load, and in what order
// the owner meets them. scripts/manual-runs.ts serves it as one page with a Yes / No per issue.
//
// Commands run from this file, never from issue text: an issue body is shown, not executed.
import { arr, int, obj, or, rec, str, type Of } from "../packages/util/src/guard.ts";
import { SCENARIOS } from "../apps/agent-office/demo/scenarios.ts";

/** Where MANUAL RUN issues live: a private repo, so the public board only shows real issues from people. */
export const MANUAL_REPO = "QuinnsCode/rustybuns-manual";

export const Issue = obj({ number: int(1, 1e7), title: str(500), body: str(100_000, { min: 0 }), url: str(500), labels: or(arr(obj({ name: str(100) }), 50), []) });
export type Issue = Of<typeof Issue>;
export const Issues = arr(Issue, 500);

/** An app the window starts on a free port, polled at http://127.0.0.1:<port> until it answers. */
export interface App { name: string; dir: string; cmd: (port: number) => string[] }
const vite = (...extra: string[]) => (port: number) => ["bunx", "vite", ...extra, "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
export const APPS = {
  skate: { name: "Skate Tech Park", dir: "apps/skate-tech-park", cmd: vite() },
  twoFronts: { name: "Two Fronts", dir: "apps/two-fronts", cmd: vite() },
  twoFrontsOnline: { name: "Two Fronts online", dir: "apps/two-fronts", cmd: (port) => ["bun", "run", "edge:dev", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(port + 1)] },
  delayed: { name: "Delayed Reaction", dir: "apps/delayed-reaction", cmd: vite() },
  qcrm: { name: "qCRM", dir: "apps/qcrm", cmd: vite("dev") },
  "mythic-masters": { name: "Mythic Masters", dir: "apps/mythic-masters", cmd: vite() },
  discGolf: { name: "Alien Disc Golf", dir: "apps/alien-disc-golf", cmd: vite() },
  gitRecon: { name: "Git Recon", dir: "apps/git-recon", cmd: vite() },
  loadIn: { name: "Sound Guy Simulator", dir: "apps/load-in", cmd: vite() },
  office: { name: "Agent Office demo", dir: "apps/agent-office", cmd: (port) => ["bun", "run", "demo", "--scenario", "setup-first-run", "--port", String(port)] },
  // the wasm build is the same Rust engine the desktop runs (bit for bit), and `boundary` writes the .rustybuns/vite.ts vite needs
  fmDaw: { name: "FM DAW", dir: "apps/fm-daw", cmd: (port) => ["sh", "-c", `bun scripts/build-native.ts --wasm --optional && bunx rustybuns boundary && ${vite()(port).join(" ")}`] },
  atLens: { name: "AT Lens", dir: "apps/at-lens", cmd: (port) => ["bun", "run", "edge:dev", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(port + 1)] },
} satisfies Record<string, App>;
export type AppId = keyof typeof APPS;

/** A jump link: `path` on the app's url. `phone` opens it in a 390 px window. */
export interface Link { label: string; path: string; phone?: boolean }
export interface Run { app: AppId; links: Link[] }

const dr = (q: string) => `/?level=5${q}`;
const clash = (a: string, b: string, skin: string) => `/?a=${a}&b=${b}&skin=${skin}`;
const office = (n: number): Link[] =>
  Object.entries(SCENARIOS).filter(([, s]) => s.serves.includes(n)).map(([name]) => ({ label: name, path: `/?scenario=${name}` }));

export const RUNS: Record<number, Run> = {
  // Taste roll-ups (one row each, every old issue's links, "(was #N)" in the label)
  12: { app: "mythic-masters", links: [
    { label: "Cornered rally (was #3517)", path: clash("jackalope", "sasquatch", "stadium") },
    { label: "Flyers land (was #3625)", path: clash("mothman", "hodag", "stadium") },
    { label: "Fight HUD (was #3962)", path: "/?a=jackalope&b=hodag&skin=stadium&watch=1&hud=classic" },
    { label: "Crowd takes (was #3319)", path: "/?crowd=arms-up" },
    { label: "Stadium fight (was #3319)", path: clash("jackalope", "hodag", "stadium") },
    { label: "Tatzelwurm, gallery 2 (was #4196)", path: "/?gallery=2" },
    { label: "Tatzelwurm vs Hodag (was #4196)", path: clash("tatzelwurm", "hodag", "stadium") },
    { label: "Krampus and friends (was #4443)", path: "/?gallery=99" },
    ...[0, 1, 2, 3].map((n) => ({ label: `Beasts, gallery ${n} (was #4702)`, path: `/?gallery=${n}` })),
    { label: "The ground, walking camera (was #3413)", path: "/?world=1&a=jackalope" },
    { label: "Heavy slams on a pad (was #2947)", path: clash("hodag", "jackalope", "stadium") },
    { label: "Gamepad orbit (was #2964, #3188)", path: clash("jersey-devil", "sphinx", "stadium") },
    { label: "Squaring up as the Jackalope (was #3331)", path: clash("jackalope", "hodag", "stadium") },
    { label: "Squaring up as the Hodag (was #3331)", path: clash("hodag", "jackalope", "stadium") },
    { label: "Controls on a phone (was #3134)", path: "/?a=jackalope&b=hodag", phone: true },
    { label: "Fight on a phone (was #3813)", path: "/?a=hydra&b=kyubi&skin=stadium&watch=1", phone: true },
    { label: "World, touch (was #2747)", path: "/?world=1", phone: true },
    { label: "World with a pad (was #2747, #3188)", path: "/?world=1" },
  ] },
  11: { app: "mythic-masters", links: [
    { label: "Title and New journey (was #3005, #2974, #3116, #3749)", path: "/" },
    { label: "Title on a phone (was #3005)", path: "/", phone: true },
    { label: "Night, Gary and the lanterns (was #3780, #4487, #4474, #4461)", path: "/?world=1&a=jackalope" },
    { label: "Yule Isle boat and board (was #4416, #4449)", path: "/?world=1&a=hodag" },
    ...["office", "institute", "lamplighters"].map((f) => ({ label: `${f}.1 (was #4309)`, path: `/?faction=${f}.1` })),
    ...[4, 8].flatMap((n) => ["office", "institute", "lamplighters"].map((f) => ({ label: `${f}.${n} (was #4318)`, path: `/?faction=${f}.${n}` }))),
  ] },
  10: { app: "mythic-masters", links: [
    { label: "Team fight (was #4414)", path: "/?a=hodag&with=jackalope&b=mothman&skin=stadium" },
    { label: "Team fight on the phone (was #4414)", path: "/?a=hodag&with=jackalope&b=mothman&skin=stadium", phone: true },
    { label: "Two a side, watched (was #4414)", path: "/?a=hodag&with=jackalope&b=mothman&and=squonk&skin=stadium&watch=1" },
    { label: "Den room, first window (was #4431)", path: "/?world=1&room=TASTE1" },
    { label: "Den room, second window (was #4431)", path: "/?world=1&room=TASTE1" },
  ] },
  9: { app: "fmDaw", links: [
    { label: "Q Amp 3D stage, Q Drive (was #5172, #5068)", path: "/amp.html" },
    { label: "Gear room: split threads, pedal wall (was #5114, #5068)", path: "/studio.html" },
    { label: "The desk: Shape, takes, web plugin (was #4504, #4819, #4930, #5361)", path: "/" },
    { label: "Jam room feel (was #5147)", path: "/jam.html" },
  ] },
  8: { app: "fmDaw", links: [
    { label: "Sesh, first window (was #5376, #5264)", path: "/sesh/taste" },
    { label: "Sesh, second window (was #5376, #5264)", path: "/sesh/taste" },
    { label: "Jam room (was #5025)", path: "/jam.html" },
  ] },
  7: { app: "office", links: [...office(7), { label: "Box first run, phone (was #2568)", path: "/?scenario=box-first-run", phone: true }] },
  3: { app: "delayed", links: [...["snap", "rush", "warren", "chase"].map((name) => ({ label: `${name} (was #3215)`, path: `/?setup=${name}&level=3` })), { label: "warren's drop (was #3215)", path: "/?setup=warren&level=3&beat=128" }, { label: "snap on the phone (was #3215)", path: "/?setup=snap&level=3", phone: true }, { label: "Stab (was #2605)", path: dr("&stem=dub") }, { label: "Growl (was #2605)", path: dr("&stem=bass") }, { label: "Drums (was #2605)", path: dr("&stem=drums") }, { label: "Call and answer (was #2605)", path: dr("&beat=28") }, { label: "Everything (was #2605)", path: dr("") }] },
  111: { app: "office", links: office(111) },
  105: { app: "discGolf", links: [{ label: "Gulf Stream", path: "/?seed=42&swim=36.5,-72" }, { label: "Open Pacific", path: "/?seed=42&swim=-25,-120" }, { label: "Off Portugal", path: "/?seed=42&swim=39.5,-10" }, { label: "Phone, Gulf Stream", path: "/?seed=42&swim=36.5,-72", phone: true }, { label: "A whole round", path: "/?seed=42" }] },
};

/** Left out of the queue, and why (the owner's calls). */
export const PARKED: Record<number, string> = {
  114: "handled when it comes up",
};

/** The owner's own tags per issue number, kept in ~/.rustybuns/manual-tags.json so every checkout shares them. */
export const Tags = rec(arr(str(40), 30, { drop: true }), 2000);
export type Tags = Of<typeof Tags>;

/** One tag as typed: lower case, spaces to dashes, a leading # dropped, at most 40 characters. */
export const cleanTag = (t: string) => t.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);

/** The tags list stored for one issue: cleaned, no blanks or repeats, sorted. */
export const cleanTags = (tags: string[]) => [...new Set(tags.map(cleanTag).filter(Boolean))].sort().slice(0, 30);

/** `tags` holds the owner's tags; `labels` holds the issue's GitHub labels, without "manual run". */
export interface Card extends Omit<Issue, "labels"> { app?: AppId; links: Link[]; labels: string[]; tags: string[] }

/** Loadable issues first, grouped by app in APPS order, then the ones that need the owner's hands, newest first. */
export function queue(issues: Issue[], tags: Tags = {}, runs: Record<number, Run> = RUNS, parked: Record<number, string> = PARKED): { cards: Card[]; parked: { number: number; why: string }[] } {
  const order = Object.keys(APPS);
  const live = issues.filter((i) => !(i.number in parked));
  const cards: Card[] = live.map((i) => ({
    ...i, ...runs[i.number] ?? { links: [] },
    labels: i.labels.map((l) => l.name).filter((n) => n !== "manual run"),
    tags: tags[i.number] ?? [],
  }));
  const rank = (c: Card) => (c.app ? order.indexOf(c.app) : order.length);
  cards.sort((a, b) => rank(a) - rank(b) || b.number - a.number);
  return { cards, parked: issues.filter((i) => i.number in parked).map((i) => ({ number: i.number, why: parked[i.number]! })) };
}

/** The gh commands an answer runs: Yes comments and closes, No comments and leaves it open. */
export function answer(number: number, yes: boolean, note: string): string[][] {
  const said = note.trim() ? `\n\n${note.trim()}` : "";
  const n = String(number);
  return yes
    ? [["gh", "issue", "comment", n, "--repo", MANUAL_REPO, "--body", `Yes, checked in the manual-run window (\`bun run manual\`).${said}`], ["gh", "issue", "close", n, "--repo", MANUAL_REPO]]
    : [["gh", "issue", "comment", n, "--repo", MANUAL_REPO, "--body", `No, from the manual-run window (\`bun run manual\`); left open.${said || "\n\n(no note)"}`]];
}
