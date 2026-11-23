// The Steam API as a game sees it: a few verbs, safe to call anywhere. Inside the Steam build
// (`rustybuns build steam`) they reach steamworks.js through the window's bridge; on the web
// and in the plain desktop build there is no bridge, so the same calls are a no-op twin and
// those builds don't change.
//
//   import { steam } from "@rustybuns/shell-bun/steam";
//   void steam().achievement("FIRST_HIPPO");
//   void steam().presence("steam_display", "#Status_Building");

export interface SteamInfo {
  /** steamworks.js started: the game runs under the Steam client. */
  available: boolean;
  /** On a Steam Deck (the window is full screen at 1280x800). */
  deck: boolean;
}

export interface Steam {
  info(): Promise<SteamInfo>;
  /** Unlock an achievement by its API name. False off Steam or when Steam refused. */
  achievement(id: string): Promise<boolean>;
  /** Set (or with no value, clear) a rich presence key, like steam_display or steam_player_group. */
  presence(key: string, value?: string): Promise<void>;
  /** Open the overlay's friends list, where Remote Play Together invites start. */
  invite(): Promise<void>;
}

/** What preload.cjs puts on window. */
interface Bridge {
  info(): Promise<SteamInfo | null>;
  achievement(id: string): Promise<boolean | null>;
  presence(key: string, value?: string): Promise<boolean | null>;
  invite(): Promise<boolean | null>;
}

const OFF: SteamInfo = { available: false, deck: false };

/** The twin every non-Steam build gets. */
export const noSteam: Steam = {
  info: async () => OFF,
  achievement: async () => false,
  presence: async () => {},
  invite: async () => {},
};

function isBridge(v: unknown): v is Bridge {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Partial<Record<keyof Bridge, unknown>>;
  return typeof b.info === "function" && typeof b.achievement === "function" && typeof b.presence === "function" && typeof b.invite === "function";
}

/** Wrap a bridge so a missing answer reads as "off" rather than null. */
export function fromBridge(b: Bridge): Steam {
  return {
    info: async () => (await b.info()) ?? OFF,
    achievement: async (id) => (await b.achievement(id)) === true,
    presence: async (key, value) => { await b.presence(key, value); },
    invite: async () => { await b.invite(); },
  };
}

/** The Steam API for this window: the bridge inside the Steam build, else the no-op twin. */
export function steam(scope: unknown = globalThis): Steam {
  const b = typeof scope === "object" && scope !== null ? (scope as { rbSteam?: unknown }).rbSteam : undefined;
  return isBridge(b) ? fromBridge(b) : noSteam;
}
