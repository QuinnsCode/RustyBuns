// The README's app gallery. `docs/readme/apps.json` holds the groups (codeSplitter, games, eqosys, my
// apps, the workshop, everything else), each app's name and what it proves; `docs/readme/<app>.jpg` is its
// thumbnail (`bun scripts/readme-shots.ts` makes them). `bun run docs` writes the gallery between the
// `<!-- apps -->` markers, with a Play link wherever the playground's `apps.json` has one.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arr, bool, obj, opt, str, type Of } from "../packages/util/src/guard.ts";

export const DIR = "docs/readme";
export const DATA = join(DIR, "apps.json");
export const START = "<!-- apps: written by `bun run docs` from docs/readme/apps.json -->";
export const END = "<!-- /apps -->";

const Entry = obj({ app: str(80), name: str(80), line: str(2000), doc: opt(str(200)) });
const Group = obj({ title: str(120), intro: str(1000), apps: arr(Entry, 200) });
export const Groups = arr(Group, 20);
export type Entry = Of<typeof Entry>;
export type Groups = Of<typeof Groups>;

const Plays = arr(obj({ app: opt(str(80)), play: opt(str(300)), soon: opt(bool()) }), 200);

export const readGroups = (): Groups => Groups(JSON.parse(readFileSync(DATA, "utf8")));

/** Each group's apps in eqosys's order (`ids` is its `APPS`, as its home lists them). An app eqosys doesn't list keeps its place, after the ones it does. */
export function inOrder(groups: Groups, ids: string[]): Groups {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const at = (e: Entry) => rank.get(e.app) ?? ids.length;
  return groups.map((g) => ({ ...g, apps: [...g.apps].sort((a, b) => at(a) - at(b)) }));
}

/** Each app's live page from the playground's list, so a play URL lives in one place; null for one marked coming soon (`soon`). */
export function plays(): Map<string, string | null> {
  const list = Plays(JSON.parse(readFileSync("apps/playground/public/apps.json", "utf8")));
  return new Map(list.flatMap((p): [string, string | null][] => (p.app && p.soon ? [[p.app, null]] : p.app && p.play ? [[p.app, p.play]] : [])));
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// The blurbs are written as Markdown for the README; a tooltip wants plain text.
const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "").replace(/\\\|/g, "|");
const docOf = (e: Entry) => e.doc ?? `apps/${e.app}/README.md`;
export const shotOf = (app: string) => join(DIR, `${app}.jpg`);

function cell(e: Entry, play: Map<string, string | null>, width: number): string {
  const tip = attr(plain(e.line));
  const img = existsSync(shotOf(e.app)) ? `<a href="${docOf(e)}"><img src="${shotOf(e.app)}" width="${width}" alt="${attr(e.name)}" title="${tip}"></a><br>` : "";
  const live = play.get(e.app);
  const sub = live ? `<br><sub><a href="${live}">Play</a></sub>` : live === null ? "<br><sub>Coming soon</sub>" : "";
  return `<td align="center" valign="top">${img}<a href="${docOf(e)}" title="${tip}"><b>${e.name}</b></a>${sub}</td>`;
}

function grid(apps: Entry[], play: Map<string, string | null>, cols: number, width: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < apps.length; i += cols) rows.push(`<tr>${apps.slice(i, i + cols).map((e) => cell(e, play, width)).join("")}</tr>`);
  return ["<table>", ...rows, "</table>"];
}

/** The gallery as README Markdown: a heading, a line and a grid per group, and the long blurbs folded away. */
export function render(groups: Groups, play: Map<string, string | null>): string {
  const out: string[] = [];
  for (const [i, g] of groups.entries()) {
    out.push(`### ${g.title}`, "", g.intro, "");
    // The featured app gets one wide picture; photo groups go four across; a group with no pictures packs six.
    // Pictures lead, so a group's title-only cells sit together at the end instead of leaving holes.
    const shot = (e: Entry) => existsSync(shotOf(e.app));
    const pics = g.apps.some(shot);
    const shown = [...g.apps.filter(shot), ...g.apps.filter((e) => !shot(e))];
    out.push(...(i === 0 && g.apps.length === 1 ? grid(shown, play, 1, 720) : pics ? grid(shown, play, 4, 200) : grid(shown, play, 6, 0)), "");
    out.push("<details><summary>What each one proves</summary>", "", ...g.apps.map((e) => `- **[${e.name}](${docOf(e)})**: ${e.line.replace(/\\\|/g, "|")}`), "", "</details>", "");
  }
  return [START, "", ...out, END].join("\n");
}
