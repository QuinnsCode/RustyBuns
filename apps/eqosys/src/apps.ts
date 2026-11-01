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
  /** One line on what it is, for its card. */
  blurb: string;
  /** Set when the app keeps data per account: eqosys POSTs here with a bearer token (`aud: "erase"`, `sub` the person, 60 seconds
   * of life) when someone deletes their account, and the app answers 200 once it has erased what it holds. Idempotent. */
  erase?: string;
  /** The card shows a screenshot at /cards/<id>.jpg when there is one. */
  shot?: boolean;
}

export const APPS: QApp[] = [
  { id: "park-hide-seek", name: "Park Hide & Seek", kind: "game", origins: ["https://park-hide-seek.notryanquinn.workers.dev"], starts: ["play"], blurb: "Hide among the park, or hunt for who is.", schemes: ["com.quinnscode.parkhideseek"] },
  { id: "skate-tech-park", name: "Skate Tech Park", kind: "game", origins: ["https://skate-tech-park.notryanquinn.workers.dev"], starts: ["play"], blurb: "Ride a giant riderless fingerboard across real park terrain.", shot: true },
  { id: "geoboxq", name: "GeoBoxQ", kind: "game", origins: ["https://geoboxq.qntbr.com"], starts: ["play"], blurb: "Boxes, maps and a world to find them in." },
  { id: "alien-disc-golf", name: "Alien Disc Golf", kind: "game", origins: ["https://alien-disc-golf.notryanquinn.workers.dev"], starts: ["play"], blurb: "Throw a disc across the whole planet, wind and ocean currents included.", shot: true },
  { id: "delayed-reaction", name: "Delayed Reaction", kind: "game", origins: ["https://delayed-reaction.notryanquinn.workers.dev"], starts: ["play"], blurb: "A neon tunnel calls a note; answer a bar later.", shot: true },
  { id: "two-fronts", name: "Two Fronts", kind: "game", origins: ["https://two-fronts.notryanquinn.workers.dev"], starts: ["play"], blurb: "Two armies, one war: lead a squad or let the AI finish it.", shot: true },
  { id: "git-recon", name: "Git Recon", kind: "game", origins: ["https://git-recon.notryanquinn.workers.dev"], starts: ["play"], blurb: "Scout your repo like a battlefield." },
  { id: "splat-rooms", name: "Splat Rooms", kind: "game", origins: ["https://splat-rooms.notryanquinn.workers.dev"], starts: ["play"], blurb: "Walk through captured rooms in 3D." },
  { id: "hippo-tycoon", name: "Hippo Tycoon", kind: "game", origins: ["https://hippo-tycoon.notryanquinn.workers.dev"], starts: ["play"], blurb: "Run a very busy hippo park." },
  { id: "splat-spray", name: "Splat Spray", kind: "game", origins: ["https://splat-spray.notryanquinn.workers.dev"], starts: ["play"], blurb: "Spray paint on a 3D splat." },
  { id: "mythic-masters", name: "Mythic Masters", kind: "game", origins: [], starts: ["play"], blurb: "Bind folklore beasts and fight them in a 1v1 arena." },
  { id: "qcrm", name: "qCRM", kind: "suite", origins: ["https://qcrm.qntbr.com"], starts: ["member"], blurb: "Contacts, deals and webhooks in one quick workspace.", shot: true },
  // The QNTBR site (the qbear3 repo): its Better Auth signs people in with eqosys as an OpenID provider (oauth.ts).
  { id: "qntbr", name: "QNTBR", kind: "suite", origins: ["https://qntbr.com"], starts: ["member"], blurb: "The QNTBR site, signed in with eqosys." },
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
