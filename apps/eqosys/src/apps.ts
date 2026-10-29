// Every app that signs people in through eqosys. An app is let in only by a return URL on one of its
// origins, so a handoff code never lands on a page somebody else picked. Add an app here, in a PR.

export interface QApp {
  id: string;
  name: string;
  kind: "game" | "suite";
  /** Where the app lives: its return URL must be on one of these. */
  origins: string[];
  /** What a person may do there from their first sign-in. The super admin adds or takes away more. */
  starts: string[];
}

export const APPS: QApp[] = [
  { id: "park-hide-seek", name: "Park Hide & Seek", kind: "game", origins: ["https://park-hide-seek.notryanquinn.workers.dev"], starts: ["play"] },
  { id: "qcrm", name: "qCRM", kind: "suite", origins: ["https://qcrm.qntbr.com"], starts: ["member"] },
];

/** The source tag of someone who signed up here rather than through an app. */
export const HOME = "eqosys";

export const appOf = (id: unknown) => APPS.find((a) => a.id === id);

/** `url` when it is a URL on one of the app's origins, else null. */
export function returnTo(app: QApp, url: unknown): URL | null {
  if (typeof url !== "string") return null;
  try { const u = new URL(url); return app.origins.includes(u.origin) ? u : null; } catch { return null; }
}
