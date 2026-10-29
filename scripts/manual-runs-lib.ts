// The manual-run queue: which open MANUAL RUN issues an app's jump-to-state harness can load, and in what order
// the owner meets them. scripts/manual-runs.ts serves it as one page with a Yes / No per issue.
//
// Commands run from this file, never from issue text: an issue body is shown, not executed.
import { arr, int, obj, str, type Of } from "../packages/util/src/guard.ts";
import { SCENARIOS } from "../apps/agent-office/demo/scenarios.ts";

export const Issue = obj({ number: int(1, 1e7), title: str(500), body: str(100_000, { min: 0 }), url: str(500) });
export type Issue = Of<typeof Issue>;
export const Issues = arr(Issue, 500);

/** An app the window starts on a free port, polled at http://127.0.0.1:<port> until it answers. */
export interface App { name: string; dir: string; cmd: (port: number) => string[] }
const vite = (...extra: string[]) => (port: number) => ["bunx", "vite", ...extra, "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
export const APPS = {
  skate: { name: "Skate Tech Park", dir: "apps/skate-tech-park", cmd: vite() },
  twoFronts: { name: "Two Fronts", dir: "apps/two-fronts", cmd: vite() },
  delayed: { name: "Delayed Reaction", dir: "apps/delayed-reaction", cmd: vite() },
  qcrm: { name: "qCRM", dir: "apps/qcrm", cmd: vite("dev") },
  wildclash: { name: "Wildclash", dir: "apps/wildclash", cmd: vite() },
  discGolf: { name: "Alien Disc Golf", dir: "apps/alien-disc-golf", cmd: vite() },
  office: { name: "Agent Office demo", dir: "apps/agent-office", cmd: (port) => ["bun", "run", "demo", "--scenario", "setup-first-run", "--port", String(port)] },
  atLens: { name: "AT Lens", dir: "apps/at-lens", cmd: (port) => ["bun", "run", "edge:dev", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(port + 1)] },
} satisfies Record<string, App>;
export type AppId = keyof typeof APPS;

/** A jump link: `path` on the app's url. `phone` opens it in a 390 px window. */
export interface Link { label: string; path: string; phone?: boolean }
export interface Run { app: AppId; links: Link[] }

const hp = "/?level=yosemite-falls&spawn=creek%20halfpipe";
const battle = (q: string) => `/?battle=1&${q}`;
const dr = (q: string) => `/?level=5${q}`;
const clash = (a: string, b: string, skin: string) => `/?a=${a}&b=${b}&skin=${skin}`;
const office = (n: number): Link[] =>
  Object.entries(SCENARIOS).filter(([, s]) => s.serves.includes(n)).map(([name]) => ({ label: name, path: `/?scenario=${name}` }));

export const RUNS: Record<number, Run> = {
  2486: { app: "skate", links: [{ label: "Push and ollie", path: "/?level=el-capitan" }, { label: "Halfpipe", path: hp }] },
  2401: { app: "skate", links: [{ label: "Rail", path: "/?level=el-capitan&spawn=rail" }, { label: "Balance", path: "/?level=el-capitan&spawn=balance" }, { label: "Vert", path: hp }] },
  2443: { app: "twoFronts", links: [{ label: "Attack", path: battle("side=attacker&brief=1") }, { label: "Defend", path: battle("side=defender&brief=1") }] },
  2407: { app: "twoFronts", links: [{ label: "Marines, desert", path: battle("side=marines&world=desert") }, { label: "Marines, city", path: battle("side=marines&world=city") }, { label: "Wooka, beach", path: battle("side=wooka&world=beach") }, { label: "Wooka, forest", path: battle("side=wooka&world=forest") }, { label: "Station, Marines attack", path: battle("side=attacker&hero=marines&world=station") }] },
  2267: { app: "twoFronts", links: [{ label: "Station", path: battle("world=station&side=attacker") }, { label: "Station, yards", path: battle("world=station&side=attacker&map=yards") }] },
  2261: { app: "twoFronts", links: ["desert", "city", "beach", "station"].map((w) => ({ label: w, path: battle(`world=${w}`) })) },
  2605: { app: "delayed", links: [{ label: "Stab", path: dr("&stem=dub") }, { label: "Growl", path: dr("&stem=bass") }, { label: "Drums", path: dr("&stem=drums") }, { label: "Call and answer", path: dr("&beat=28") }, { label: "Everything", path: dr("") }] },
  1986: { app: "qcrm", links: [{ label: "Home", path: "/" }, { label: "Demo", path: "/demo" }, { label: "Contacts", path: "/app?scenario=populated" }, { label: "Webhooks", path: "/app?scenario=webhooks" }, { label: "Phone", path: "/app?scenario=populated", phone: true }] },
  2702: { app: "wildclash", links: [{ label: "Skirmisher vs drake", path: clash("volthune", "scoro", "stadium") }, { label: "Drake vs tank", path: clash("scoro", "surmire", "stadium") }, { label: "Drake vs tank, volcano", path: clash("scoro", "surmire", "volcano") }, { label: "Drake vs tank, sky island", path: clash("scoro", "surmire", "sky") }] },
  2738: { app: "discGolf", links: [{ label: "Gulf Stream", path: "/?seed=42&splash=36.5,-72" }, { label: "Open Pacific", path: "/?seed=42&splash=-25,-120" }, { label: "Off Portugal", path: "/?seed=42&splash=39.5,-10" }, { label: "Phone, Gulf Stream", path: "/?seed=42&splash=36.5,-72", phone: true }, { label: "A whole round", path: "/?seed=42" }] },
  2513: { app: "office", links: office(2513) },
  2520: { app: "office", links: [...office(2520), { label: "Phone", path: "/?scenario=writes-ask-pending", phone: true }] },
  2425: { app: "office", links: office(2425) },
  2430: { app: "office", links: office(2430) },
  2666: { app: "atLens", links: [{ label: "Phone", path: "/?q=bsky.app&c=app.bsky.feed.post", phone: true }, { label: "Desktop", path: "/?q=bsky.app&c=app.bsky.feed.post" }] },
};

/** Left out of the queue, and why (the owner's calls). */
export const PARKED: Record<number, string> = {
  609: "roll-up, not a task",
  2333: "needs full Xcode",
  2307: "handled when it comes up",
  2330: "low priority",
  2348: "Delayed Reaction phone checks wait for its UI",
  2356: "Delayed Reaction phone checks wait for its UI",
};

export interface Card extends Issue { app?: AppId; links: Link[] }

/** Loadable issues first, grouped by app in APPS order, then the ones that need the owner's hands, newest first. */
export function queue(issues: Issue[]): { cards: Card[]; parked: { number: number; why: string }[] } {
  const order = Object.keys(APPS);
  const live = issues.filter((i) => !(i.number in PARKED));
  const cards: Card[] = live.map((i) => ({ ...i, ...RUNS[i.number] ?? { links: [] } }));
  const rank = (c: Card) => (c.app ? order.indexOf(c.app) : order.length);
  cards.sort((a, b) => rank(a) - rank(b) || b.number - a.number);
  return { cards, parked: issues.filter((i) => i.number in PARKED).map((i) => ({ number: i.number, why: PARKED[i.number]! })) };
}

/** The gh commands an answer runs: Yes comments and closes, No comments and leaves it open. */
export function answer(number: number, yes: boolean, note: string): string[][] {
  const said = note.trim() ? `\n\n${note.trim()}` : "";
  const n = String(number);
  return yes
    ? [["gh", "issue", "comment", n, "--body", `Yes, checked in the manual-run window (\`bun run manual\`).${said}`], ["gh", "issue", "close", n]]
    : [["gh", "issue", "comment", n, "--body", `No, from the manual-run window (\`bun run manual\`); left open.${said || "\n\n(no note)"}`]];
}
