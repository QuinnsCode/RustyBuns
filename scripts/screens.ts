// The words on the first 20 screens a new person is likely to see, on one local page: `bun run screens` opens
// http://localhost:4706 with each screen's picture (a computer and a phone) beside a box for every line on it.
// Save writes the app's own JSON (`apps/<app>/content/first-screen.json`, or the file the app already keeps its
// words in), and the app shows it on its next load; "Take new pictures" starts that app headless and looks again.
// The list (SCREENS) runs in about the order a newcomer meets them: eqosys's front door and sign-in, the games it
// opens, then the tools. A new first screen gets a row here and its words in a content file (see
// packages/util/src/copy.ts for index.html, or import the JSON where the page's script writes the words).
//
//   bun run screens                  the editor (pictures in ~/.rustybuns/screens/)
//   bun run screens --shots          take every screen's pictures first (a few minutes), then open the editor
//   bun run screens --shots --only eqosys   just the screens whose id has "eqosys"
//   bun run screens --port 4800
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { screens, type Screen } from "../packages/cms/src/screens.ts";
import { portArg } from "../packages/util/src/ports.ts";
import { launchChrome, load, openTab, startVite } from "./chrome.ts";
import { help } from "./help.ts";

const root = resolve(import.meta.dir, "..");
const own = (app: string, file = "first-screen.json") => join(root, "apps", app, "content", file);

interface Row extends Screen {
  /** Run in the page before the picture, to get from the landing to this screen (`await` works). */
  js?: string;
  /** Not a Vite app: build it with this command in its folder, then serve this folder. */
  built?: { run: string[]; dir: string };
  /** A file the dev server needs that only a one-time step writes, and what to run. */
  needs?: { file: string; say: string };
}

/** New game, the intro cut short, then the Book's opening talk answered until its pick page shows. */
const PICK = "document.getElementById('newGame').click(); await new Promise((r) => setTimeout(r, 2500)); mythicMasters.director.cut();"
  + " for (let i = 0; i < 12 && document.getElementById('starters').hidden; i++) { await new Promise((r) => setTimeout(r, 1200));"
  + " const t = mythicMasters.book.state(); const id = t?.replies?.[0]?.id ?? t?.choices?.[0]?.id; if (id) mythicMasters.book.answer(id); else mythicMasters.book.close(); }";

export const SCREENS: Row[] = [
  { id: "eqosys-home", app: "eqosys", name: "eqosys: the front door", why: "A stranger follows a link to eqosys. What is this, and can I play something without an account? (The form beside it is screen 2; the game cards are eqosys's src/cards.json.)", file: own("eqosys"), keys: ["home"] },
  { id: "eqosys-login", app: "eqosys", name: "eqosys: make your account", why: "Sent here from a game's Sign in. Fill it and go back to the game.", file: own("eqosys"), keys: ["login"], path: "/login" },
  { id: "mythic-title", app: "mythic-masters", name: "Mythic Masters: the title page", why: "The first game most people open. The Book's cover: New game, Fight a friend, Versus.", file: own("mythic-masters", "landing.json"), keys: ["title"] },
  { id: "mythic-intro", app: "mythic-masters", name: "Mythic Masters: the abduction", why: "Straight after New game: the greys drop the Book on you. Lines with their moment in the scene.", file: own("mythic-masters", "intro.json"), path: "/?scene=abduction&t=8" },
  { id: "mythic-pick", app: "mythic-masters", name: "Mythic Masters: the Book's five", why: "After the intro: the Book offers five cryptids and you take three.", file: own("mythic-masters", "landing.json"), keys: ["starters", "world"], js: PICK },
  { id: "park-hide-seek", app: "park-hide-seek", name: "Park Hide & Seek: the ticket", why: "Your name and PLAY. The model the other landings follow.", file: own("park-hide-seek") },
  { id: "two-fronts", app: "two-fronts", name: "Two Fronts: pick a side", why: "Pick a side, pick a war, play the AI. The how-to card sits under the title.", file: own("two-fronts") },
  { id: "alien-disc-golf", app: "alien-disc-golf", name: "Alien Disc Golf: tee off", why: "The globe, the course and Tee off, with today's wind.", file: own("alien-disc-golf") },
  { id: "skate-tech-park", app: "skate-tech-park", name: "Skate Tech Park: the menu", why: "After the logo intro: pick a park and ride.", file: own("skate-tech-park") },
  { id: "git-recon", app: "git-recon", name: "Git Recon: the mission list", why: "Level 1 open, the rest locked. One line says what the game is.", file: own("git-recon") },
  { id: "delayed-reaction", app: "delayed-reaction", name: "Delayed Reaction: the menu", why: "A rhythm game on a dub delay. Play, or pick a preset.", file: own("delayed-reaction") },
  { id: "hippo-tycoon", app: "hippo-tycoon", name: "Hippo Tycoon: ways to play", why: "Solo big, then Couch, LAN and Online. Options wait underneath.", file: own("hippo-tycoon") },
  { id: "splat-spray", app: "splat-spray", name: "Super Spy Splat Shot: codename", why: "Type a codename, then Quick Play.", file: own("splat-spray") },
  { id: "load-in", app: "load-in", name: "Sound Guy Simulator: the gig poster", why: "Tonight's booking and a big PLAY; home base folds away under it.", file: own("load-in") },
  { id: "excalibrawl", app: "excalibrawl", name: "Excalibrawl: the arena", why: "A drawing fight plays at once, with the next live fight's countdown above it.", file: own("excalibrawl") },
  { id: "fm-daw", app: "fm-daw", name: "FM Groovebox: the start card", why: "Turn the speakers down, then Play the groove.", file: own("fm-daw"), needs: { file: ".rustybuns/vite.ts", say: "Run bun run desktop:dev once in apps/fm-daw, then take the pictures" } },
  { id: "sharesplat", app: "sharesplat", name: "ShareSplat: shoot it", why: "A seller is about to photograph a product all the way round.", file: own("sharesplat") },
  { id: "qcrm", app: "qcrm", name: "qCRM: the front page", why: "The CRM your agents can use: Try the demo, Sign in, Take the tour.", file: own("qcrm") },
  { id: "codesplitter", app: "codesplitter", name: "codeSplitter: the front page", why: "Git, split apart. Sign in or let it show you around.", file: own("codesplitter", "landing.json"), built: { run: ["bun", "build.ts"], dir: "dist/client" } },
  { id: "starter-game", app: "starter-game", name: "Starter Game: the template", why: "Every new game starts from this one, so its first screen is the pattern they copy.", file: own("starter-game") },
];

const SIZES = { desktop: { w: 1280, h: 720, mobile: false }, phone: { w: 390, h: 844, mobile: true } } as const;

/** A built (non-Vite) app's folder as a static site. */
async function serveBuilt(cwd: string, b: NonNullable<Row["built"]>) {
  const run = Bun.spawn(b.run, { cwd, stdout: "pipe", stderr: "pipe" });
  if ((await run.exited) !== 0) throw new Error((await new Response(run.stderr).text()).trim().split("\n").slice(-4).join("\n"));
  const dir = join(cwd, b.dir);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
    const p = new URL(req.url).pathname;
    const f = Bun.file(join(dir, p.endsWith("/") ? `${p}index.html` : p));
    return (await f.exists()) && !p.includes("..") ? new Response(f) : new Response("Not found", { status: 404 });
  } });
  return { url: `http://127.0.0.1:${server.port}/`, stop: () => server.stop(true) };
}

/** Both pictures of one screen, or why not. One dev server, one headless Chrome, a clean origin each time. */
export async function shoot(s: Row, out: string): Promise<string | null> {
  const cwd = join(root, "apps", s.app);
  if (s.needs && !existsSync(join(cwd, s.needs.file))) return s.needs.say;
  let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined, server: { url: string; stop: () => void } | undefined;
  try {
    [chrome, server] = await Promise.all([launchChrome(), s.built ? serveBuilt(cwd, s.built) : startVite(cwd)]);
    for (const [kind, size] of Object.entries(SIZES)) {
      const tab = await openTab(chrome.cdp, { w: size.w, h: size.h }, size.mobile);
      await tab.call("Storage.clearDataForOrigin", { origin: new URL(server.url).origin, storageTypes: "all" });
      await load(chrome.cdp, tab, new URL(s.path ?? "/", server.url).href, 3000);
      if (s.js) { await tab.eval(`(async () => { ${s.js} })()`); await Bun.sleep(1500); }
      const { data } = await tab.call("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, `${s.id}-${kind}.png`), Buffer.from(data, "base64"));
      await tab.close();
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n")[0]!.slice(0, 200) : String(e);
  } finally {
    chrome?.stop(); server?.stop();
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  help(import.meta.path);
  const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const out = join(homedir(), ".rustybuns", "screens");
  mkdirSync(out, { recursive: true });
  if (argv.includes("--shots")) {
    const only = flag("--only") ?? "";
    for (const s of SCREENS.filter((x) => x.id.includes(only))) {
      const err = await shoot(s, out);
      console.log(`${err ? "no " : ""}pictures: ${s.id}${err ? ` (${err})` : ""}`);
    }
  }
  const port = portArg(flag("--port"), "screens");
  const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 120, fetch: screens({ title: "First screens", screens: SCREENS, shots: out, shoot: (s) => shoot(SCREENS.find((r) => r.id === s.id)!, out) }) });
  console.log(`First screens: http://localhost:${server.port} (pictures in ${out})`);
}
