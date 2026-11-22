// The starter game (apps/starter-game in Rusty Buns): a new game's first files, under its own name. Both makers of a
// new game use it: `bun run new-game <id>` (scripts/new-game.ts) copies the folder into apps/, and POST
// /api/github/starter digs the folder up from GitHub into a codeSplitter repo. Each renames the same four words.
// Plain functions, no imports: the Worker and the script both run it.

/** Where the starter lives on GitHub, and the folder in it. */
export const STARTER = { repo: "QuinnsCode/RustyBuns", folder: "apps/starter-game" };

/** The starter's own id, window handle, title and page-command prefix (`starter_game_how_to_play`), as they appear in its files. */
const FROM = { id: "starter-game", handle: "starterGame", title: "Starter Game", prefix: "starter_game" } as const;

export interface StarterNames { id: string; handle: string; title: string; prefix: string }

/** A game id: lowercase letters and digits, single dashes between, 3 to 40 long (eqosys's listing id, and a repo name). */
export const GAME_ID = /^(?=.{3,40}$)[a-z0-9]+(-[a-z0-9]+)*$/;

/** `rocket-golf` as its window handle (`rocketGolf`), its page-command prefix (`rocket_golf`) and, with no title given, its title (`Rocket Golf`). Null for a bad id. */
export function starterNames(id: string, title?: string): StarterNames | null {
  if (!GAME_ID.test(id)) return null;
  const words = id.split("-");
  const up = (w: string) => w[0]!.toUpperCase() + w.slice(1);
  const camel = words[0] + words.slice(1).map(up).join("");
  // A handle is a name on `window` (and a prefix starts a tool name), so one that would start with a digit (3d-golf) gets a word in front.
  const lead = /^\d/.test(id) ? "game" : "";
  return { id, handle: lead ? `${lead}${camel}` : camel, title: title?.trim().slice(0, 60) || words.map(up).join(" "), prefix: (lead ? `${lead}_` : "") + words.join("_") };
}

/** The files a rename reads: text ones, by extension. Everything else is copied as it is. */
const TEXT = /\.(ts|tsx|js|json|jsonc|html|css|md|txt)$/;

/** One starter file's text under the new game's names; a file that isn't text comes back as it was. */
export function renameStarter(path: string, text: string, n: StarterNames): string {
  if (!TEXT.test(path)) return text;
  return text.replaceAll(FROM.title, n.title).replaceAll(FROM.handle, n.handle).replaceAll(FROM.id, n.id).replaceAll(FROM.prefix, n.prefix);
}

/** Whether a starter file is renamed at all (text), so a copier knows to decode it. */
export const isStarterText = (path: string) => TEXT.test(path);
