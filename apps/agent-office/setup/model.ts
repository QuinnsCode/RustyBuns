// The setup page's data half: what /__rb/connections and /__rb/builder send (checked, not assumed), and the words and
// lights each card shows. No DOM here, so the page's logic is testable without a browser.
import { check } from "@rustybuns/util/guard";
import { BuilderReply, OfficeError, SetupReply, type Connection, type Nightly, type Pending, type Status } from "../connect/types.ts";

export type { Connection, Pending, Status };
export type Setup = SetupReply;
export type Builder = BuilderReply;

export const parseSetup = (v: unknown): Setup =>
  check(SetupReply, v) ?? { connections: [], pending: [], ready: false, error: "The office sent something unexpected" };

export const parseBuilder = (v: unknown): Builder | null => check(BuilderReply, v);

/** The light by a card's name: its colour class, and the words for screen readers and the tooltip. */
export const LIGHT: Record<Status, { tone: "green" | "red" | "grey" | "amber"; words: string }> = {
  ok: { tone: "green", words: "Working" },
  down: { tone: "red", words: "Not answering" },
  unset: { tone: "grey", words: "Not set up" },
  pending: { tone: "amber", words: "Waiting for sign-in" },
};

export const accessWords = (a: Connection["access"]) => (a === "write" ? "write" : "read-only");

export function nightlyLine(n: { at: string; results: Pick<Nightly["results"][number], "app" | "ok">[] } | null): string {
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
  if (!r.ok) throw new Error(check(OfficeError, body)?.error ?? `The office answered ${r.status}`);
  return body;
}

export const loadSetup = async () => parseSetup(await json("/__rb/connections", "GET"));
export const loadBuilder = async () => parseBuilder(await json("/__rb/builder", "GET").catch(() => null));
export const connectGithub = () => json("/__rb/connections?do=github", "POST");
export const act = (what: "test" | "revoke" | "cancel", id: string) => json(`/__rb/connections?${new URLSearchParams({ do: what, id })}`, "POST");
