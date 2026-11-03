// Every app that signs people in through eqosys. What its card says is cards.json (cards.ts). An app is let in only by a return URL on one of its
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
  /** Set when the app keeps data per account: eqosys POSTs here with a bearer token (`aud: "erase"`, `sub` the person, 60 seconds
   * of life) when someone deletes their account, and the app answers 200 once it has erased what it holds. Idempotent. */
  erase?: string;
  /** The card shows a screenshot at /cards/<id>.jpg when there is one. */
  shot?: boolean;
  /** The home's row this app sits in (GENRES). */
  genre: Genre;
  /** How finished it is: alpha unless said (MATURITY). */
  maturity?: Maturity;
  /** Also listed in the Featured row at the top of the home. */
  featured?: boolean;
}

export const GENRES = ["Action & Adventure", "Sports & Skate", "Party & Music", "Strategy & Sims", "Work & Tools"] as const;
export type Genre = (typeof GENRES)[number];
export const MATURITY = ["alpha", "beta", "experimental"] as const;
export type Maturity = (typeof MATURITY)[number];

export const APPS: QApp[] = [
  { id: "park-hide-seek", name: "Park Hide Seek", kind: "game", origins: ["https://park-hide-seek.notryanquinn.workers.dev"], starts: ["play"], shot: true, schemes: ["com.quinnscode.parkhideseek"], genre: "Party & Music", featured: true },
  { id: "git-recon", name: "Git Recon", kind: "game", origins: ["https://git-recon.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Action & Adventure", featured: true },
  { id: "skate-tech-park", name: "Skate Tech Park", kind: "game", origins: ["https://skate-tech-park.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Sports & Skate" },
  { id: "alien-disc-golf", name: "Alien Disc Golf", kind: "game", origins: ["https://alien-disc-golf.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Sports & Skate" },
  { id: "delayed-reaction", name: "Delayed Reaction", kind: "game", origins: ["https://delayed-reaction.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Party & Music", maturity: "experimental" },
  { id: "two-fronts", name: "Two Fronts", kind: "game", origins: ["https://two-fronts.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Strategy & Sims" },
  { id: "hippo-tycoon", name: "Hippo Tycoon", kind: "game", origins: ["https://hippo-ty32kk4m44sz57g2i6knvzzb7o-production.up.railway.app"], starts: ["play"], shot: true, genre: "Strategy & Sims" },
  { id: "splat-spray", name: "Super Spy Splat Shot", kind: "game", origins: ["https://splat-spray.notryanquinn.workers.dev", "https://super-splat-spy-shot.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Action & Adventure", maturity: "experimental" },
  { id: "mythic-masters", name: "Mythic Masters", kind: "game", origins: ["https://mythic-masters.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Action & Adventure", maturity: "experimental", featured: true },
  // Splat Rooms already signs in through eqosys (its client returns to https://splat-rooms.notryanquinn.workers.dev): add that origin when it deploys.
  { id: "splat-rooms", name: "Splat Rooms", kind: "game", origins: ["https://splat-rooms.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Action & Adventure", maturity: "experimental" },
  { id: "excalibrawl", name: "Excalibrawl", kind: "game", origins: ["https://excalibrawl.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Party & Music" },
  { id: "what-would-fantano-say", name: "What Would Fantano Say?", kind: "game", origins: ["https://what-would-fantano-say.notryanquinn.workers.dev"], starts: ["play"], shot: true, genre: "Party & Music" },
  { id: "fm-daw", name: "FM DAW", kind: "suite", origins: ["https://fm-daw.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Party & Music" },
  { id: "motion-midi", name: "Motion MIDI", kind: "suite", origins: ["https://motion-midi.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Party & Music", maturity: "experimental" },
  { id: "brianfloresblitzing", name: "One Team in 32", kind: "suite", origins: ["https://brianfloresblitzing.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Sports & Skate" },
  { id: "qcrm", name: "qCRM", kind: "suite", origins: ["https://qcrm.qntbr.com"], starts: ["member"], shot: true, genre: "Work & Tools" },
  // The QNTBR site (the qbear3 repo): its Better Auth signs people in with eqosys as an OpenID provider (oauth.ts).
  { id: "qntbr", name: "QNTBR", kind: "suite", origins: ["https://qntbr.com"], starts: ["member"], shot: true, genre: "Work & Tools" },
  // A packing helper for qCRM, not a game: listed with the suites, at the bottom.
  { id: "geoboxq", name: "GeoBoxQ", kind: "suite", origins: ["https://geoboxq-worker-live-ryanquinn-tjhne4lpmumy6kz5.notryanquinn.workers.dev", "https://geoboxq.qntbr.com"], starts: ["play"], shot: true, genre: "Work & Tools" },
  { id: "codesplitter", name: "codeSplitter", kind: "suite", origins: ["https://codesplitter.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Work & Tools", maturity: "beta", featured: true },
  { id: "playground", name: "Playground", kind: "suite", origins: ["https://rustybuns-playground.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Work & Tools" },
  { id: "hello-world", name: "Hello World", kind: "suite", origins: ["https://hello-world.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Work & Tools" },
  { id: "at-lens", name: "AT Lens", kind: "suite", origins: [], starts: ["member"], shot: true, genre: "Work & Tools", maturity: "experimental" },
  { id: "auto-rig", name: "Auto Rig", kind: "suite", origins: ["https://auto-rig.notryanquinn.workers.dev"], starts: ["member"], shot: true, genre: "Work & Tools" },
  { id: "meshy-studio", name: "Meshy Batch Studio", kind: "suite", origins: [], starts: ["member"], shot: true, genre: "Work & Tools", maturity: "experimental" },
  { id: "sharesplat", name: "ShareSplat", kind: "suite", origins: ["https://sharesplat.notryanquinn.workers.dev"], starts: ["member"], genre: "Work & Tools", maturity: "experimental" },
  { id: "splat-desktop", name: "Splat Desktop", kind: "suite", origins: [], starts: ["member"], genre: "Work & Tools", maturity: "experimental" },
  // Parked until tscircuit updates its own dependencies (its README).
  { id: "tscircuit-desktop", name: "tscircuit Desktop", kind: "suite", origins: [], starts: ["member"], genre: "Work & Tools", maturity: "experimental" },
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
