// The setup page's data half: what /__rb/connections and /__rb/builder send (checked, not assumed), and the words and
// lights each card shows. No DOM here, so the page's logic is testable without a browser.
export type Status = "ok" | "down" | "unset" | "pending";
export type Connection = { id: string; kind: string; account: string; status: Status; access: "read" | "write" };
export type Pending = { id: string; userCode: string; uri: string; expiresAt: number };
export type Setup = { connections: Connection[]; pending: Pending[]; ready: boolean; error?: string };
export type Builder = { connections: Connection[]; setup: string; nightly: { at: string; results: { app: string; ok: boolean }[] } | null };

const STATUS: Status[] = ["ok", "down", "unset", "pending"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function connection(v: unknown): Connection | null {
  if (!isObject(v) || typeof v.id !== "string" || typeof v.kind !== "string" || typeof v.account !== "string") return null;
  const status = STATUS.find((s) => s === v.status);
  return status ? { id: v.id, kind: v.kind, account: v.account, status, access: v.access === "write" ? "write" : "read" } : null;
}

const connectionsOf = (v: unknown) => (Array.isArray(v) ? v : []).flatMap((c) => connection(c) ?? []);

export function parseSetup(v: unknown): Setup {
  if (!isObject(v)) return { connections: [], pending: [], ready: false, error: "The office sent something unexpected" };
  const pending = (Array.isArray(v.pending) ? v.pending : []).flatMap((p): Pending[] =>
    isObject(p) && typeof p.id === "string" && typeof p.userCode === "string" && typeof p.uri === "string" && typeof p.expiresAt === "number"
      ? [{ id: p.id, userCode: p.userCode, uri: p.uri, expiresAt: p.expiresAt }] : []);
  return { connections: connectionsOf(v.connections), pending, ready: v.ready === true, ...(typeof v.error === "string" ? { error: v.error } : {}) };
}

export function parseBuilder(v: unknown): Builder | null {
  if (!isObject(v) || typeof v.setup !== "string") return null;
  const n = v.nightly;
  const nightly = isObject(n) && typeof n.at === "string" && Array.isArray(n.results)
    ? { at: n.at, results: n.results.flatMap((r) => (isObject(r) && typeof r.app === "string" && typeof r.ok === "boolean" ? [{ app: r.app, ok: r.ok }] : [])) } : null;
  return { connections: connectionsOf(v.connections), setup: v.setup, nightly };
}

/** The light by a card's name: its colour class, and the words for screen readers and the tooltip. */
export const LIGHT: Record<Status, { tone: "green" | "red" | "grey" | "amber"; words: string }> = {
  ok: { tone: "green", words: "Working" },
  down: { tone: "red", words: "Not answering" },
  unset: { tone: "grey", words: "Not set up" },
  pending: { tone: "amber", words: "Waiting for sign-in" },
};

export const accessWords = (a: Connection["access"]) => (a === "write" ? "write" : "read-only");

export function nightlyLine(n: Builder["nightly"]): string {
  if (!n) return "No nightly results yet";
  const bad = n.results.filter((r) => !r.ok).map((r) => r.app);
  return `${new Date(n.at).toLocaleString()}: ${n.results.length - bad.length} of ${n.results.length} built${bad.length ? `, failed: ${bad.join(", ")}` : ""}`;
}

/** First run: nothing GitHub-shaped is connected yet and no sign-in is waiting. Steps show until the first account lands. */
export const isFirstRun = (s: Setup) => !s.connections.some((c) => c.kind === "github") && s.pending.length === 0;

export const WALKTHROUGH = [
  "Connect GitHub. You get a short code and a link; enter the code there.",
  "Wait here. The account appears as soon as GitHub says yes.",
  "New connections are read-only. Writes ask first.",
] as const;

// --- the calls ---

async function json(url: string, method: string): Promise<unknown> {
  const r = await fetch(url, { method });
  const body: unknown = await r.json().catch(() => null);
  if (!r.ok) throw new Error(isObject(body) && typeof body.error === "string" ? body.error : `The office answered ${r.status}`);
  return body;
}

export const loadSetup = async () => parseSetup(await json("/__rb/connections", "GET"));
export const loadBuilder = async () => parseBuilder(await json("/__rb/builder", "GET").catch(() => null));
export const connectGithub = () => json("/__rb/connections?do=github", "POST");
export const act = (what: "test" | "revoke" | "cancel", id: string) => json(`/__rb/connections?${new URLSearchParams({ do: what, id })}`, "POST");
