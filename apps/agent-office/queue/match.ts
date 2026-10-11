// What the queue's search box matches on. Pure, so it's tested without a DOM.

// the bits of a GitHub issue the office sends its pages (the Issues board's own list)
// (the office trims each body to 4000 characters and sends no comments)
export type Issue = { number: number; title?: string; body?: string; labels?: { name: string }[] };

// one issue's searchable text: its title, body and labels
export function issueText(i: Issue): string {
  return [i.title, i.body, ...(i.labels ?? []).map(l => l.name)].filter(Boolean).join("\n");
}

// the issue number a task's title links to, e.g. https://github.com/o/r/issues/42
export function issueNumber(href: string | null | undefined): number | undefined {
  const m = href?.match(/\/issues\/(\d+)(?:[/?#]|$)/);
  return m ? Number(m[1]) : undefined;
}

// every word of the query shows up somewhere, ignoring case; an empty query matches everything
export function matches(query: string, text: string): boolean {
  const hay = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

// the issues in a socket message the office's own client reads them from: the snapshot on connecting and on
// entering a floor, and every refresh of the board. Only those are parsed, so the terminal frames streaming past
// cost a regex.
const ISSUES_MSG = /^\{"t":"(?:welcome|floor\.enter|gh\.issues)"/;
export function issuesIn(data: unknown): Issue[] | undefined {
  if (typeof data !== "string" || !ISSUES_MSG.test(data)) return;
  try {
    const msg = JSON.parse(data);
    const items = (msg.t === "gh.issues" ? msg.state : msg.issues)?.items;
    return Array.isArray(items) ? items : undefined;
  } catch {
    return;
  }
}
