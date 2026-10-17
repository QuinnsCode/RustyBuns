// Everything a person can do in the app is a command here: the Ctrl/Cmd-K menu lists them, and so
// can a script, an agent or an end-to-end test through `window.crmCommands`. One registry, no
// second code path for automation. The registry knows nothing about React.

export interface Command {
  id: string;
  title: string;
  icon?: string;
  /** Extra words the menu matches on. */
  keywords?: string;
  /** False when this person may not do it right now (role, view); it is then neither listed nor runnable. */
  enabled?: boolean;
  /** False for commands that need arguments, so they run from code but are not offered in the menu. */
  menu?: boolean;
  run(args?: Record<string, unknown>): void | Promise<void>;
}

const registry = new Map<string, Command>();

/** Add commands; the returned function takes exactly those back out. */
export function register(commands: Command[]): () => void {
  for (const c of commands) registry.set(c.id, c);
  return () => { for (const c of commands) if (registry.get(c.id) === c) registry.delete(c.id); };
}

export const list = (): Pick<Command, "id" | "title" | "keywords">[] =>
  [...registry.values()].filter((c) => c.enabled !== false).map(({ id, title, keywords }) => ({ id, title, keywords }));

export async function run(id: string, args?: Record<string, unknown>) {
  const c = registry.get(id);
  if (!c || c.enabled === false) throw new Error(`no command "${id}" available`);
  await c.run(args);
}

/** Menu entries for a query: every word must appear in the title or keywords; title hits sort first. */
export function match(query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: { c: Command; score: number }[] = [];
  for (const c of registry.values()) {
    if (c.enabled === false || c.menu === false) continue;
    const title = c.title.toLowerCase(), hay = `${title} ${c.keywords ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    out.push({ c, score: words.reduce((n, w) => n + (title.startsWith(w) ? 0 : title.includes(w) ? 1 : 2), 0) });
  }
  return out.sort((a, b) => a.score - b.score).map((o) => o.c);
}

/** Put the registry on the page so automation can drive the app: `await crmCommands.run("deals.new")`. */
export function expose() {
  (globalThis as any).crmCommands = { list, run };
}
