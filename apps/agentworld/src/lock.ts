// Agent Galaxy opens once your world is made: you are signed in, and your AI's write has loaded clean and been saved
// to the server (POST /api/r/<room>/made). Until then the Galaxy tile, Cmd+K and window.agentGalaxy.enter() say why,
// in the same words the server answers a claim with (galaxy.ts).

export const SIGN_IN_FIRST = "Sign in and make your world first", MAKE_FIRST = "Make your world first";

/** Why the galaxy is shut to this page, or null when it is open. */
export const lockLine = (signedIn: boolean, made: boolean): string | null => (!signedIn ? SIGN_IN_FIRST : made ? null : MAKE_FIRST);

/** This page's lock as the doors outside the page's Model read it (Cmd+K, window.agentGalaxy): main.ts sets it on
 *  load, and ProfilePage's MarkMade when the world is made. */
export const galaxyLock: { why: string | null } = { why: SIGN_IN_FIRST };
