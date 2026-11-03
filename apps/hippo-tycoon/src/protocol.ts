// The edge's protocol floor (@rustybuns/util/protocol): the online page and a desktop build send `pv` on
// /ws, and a build older than MIN_PROTOCOL is told "Update to keep playing" with STORE_URL instead of a
// bare failure. PROTO_VERSION in engine/wire.ts is the world's own message format, checked after the hello.
// Raise PROTOCOL when the page and Worker change in a way old builds can't follow; raise MIN_PROTOCOL to stop serving them.

/** The protocol this page speaks; it rides as `pv` on /ws. */
export const PROTOCOL = 1;
/** The oldest the Worker still serves. */
export const MIN_PROTOCOL = 1;
/** Where an old build gets a new one: the desktop releases. */
export const STORE_URL = "https://github.com/QuinnsCode/RustyBuns/releases";
