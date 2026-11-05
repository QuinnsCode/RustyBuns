// This game's place in eqosys, shared by the page (client/eqosys.ts) and the Worker, which checks a signed-in
// tycoon's token with `whoIs` from @rustybuns/util/token.

/** This game's id in eqosys's APPS. */
export const APP = "hippo-tycoon";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to. The desktop app, a LAN host and local pages stay guests. */
export const SIGN_IN_FROM = ["https://hippo-ty32kk4m44sz57g2i6knvzzb7o-production.up.railway.app"];
