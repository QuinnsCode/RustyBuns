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
  /** A native app's own URL schemes (its bundle id, as RFC 8252 asks): a return like `com.quinnscode.parkhideseek:/eqosys`.
   * Any app could claim a scheme, so the PKCE verifier, which never leaves the app, is what proves it. */
  schemes?: string[];
}

export const APPS: QApp[] = [
  { id: "park-hide-seek", name: "Park Hide & Seek", kind: "game", origins: ["https://park-hide-seek.notryanquinn.workers.dev"], starts: ["play"], schemes: ["com.quinnscode.parkhideseek"] },
  { id: "skate-tech-park", name: "Skate Tech Park", kind: "game", origins: ["https://skate-tech-park.notryanquinn.workers.dev"], starts: ["play"] },
  { id: "geoboxq", name: "GeoBoxQ", kind: "game", origins: ["https://geoboxq.qntbr.com"], starts: ["play"] },
  { id: "alien-disc-golf", name: "Alien Disc Golf", kind: "game", origins: ["https://alien-disc-golf.notryanquinn.workers.dev"], starts: ["play"] },
  { id: "delayed-reaction", name: "Delayed Reaction", kind: "game", origins: ["https://delayed-reaction.notryanquinn.workers.dev"], starts: ["play"] },
  { id: "qcrm", name: "qCRM", kind: "suite", origins: ["https://qcrm.qntbr.com"], starts: ["member"] },
  // The QNTBR site (the qbear3 repo): its Better Auth signs people in with eqosys as an OpenID provider (oauth.ts).
  { id: "qntbr", name: "QNTBR", kind: "suite", origins: ["https://qntbr.com"], starts: ["member"] },
];

/** The source tag of someone who signed up here rather than through an app. */
export const HOME = "eqosys";

export const appOf = (id: unknown) => APPS.find((a) => a.id === id);

/** An app's page running on this machine: http on localhost, 127.0.0.1 or [::1], any port. */
export const isLoopback = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

/** `url` when it is a URL on one of the app's origins or schemes (or on loopback, with `loopback` on), else null. */
export function returnTo(app: QApp, url: unknown, loopback = false): URL | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return app.origins.includes(u.origin) || (loopback && isLoopback(u.origin)) || !!app.schemes?.includes(u.protocol.slice(0, -1)) ? u : null;
  } catch { return null; }
}
