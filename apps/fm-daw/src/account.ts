// Qollab Studio signs in through eqosys (the shared client, @rustybuns/util/eqosys, under FM DAW's id). Online, the token
// rides to /ws and the Worker checks it (`whoIs` in @rustybuns/util/token), so the room knows you by your eqosys id and name.
// The page makes the eqosys client (studio/main.ts); the Worker imports only these names. Your character is the one kept on eqosys (GET /me/avatar, #4987); until it answers, the look this browser keeps.
import { Bad, bool, obj, type Guard } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { cleanAvatar, type Avatar } from "@rustybuns/util/avatar";

/** FM DAW's id in eqosys's APPS. */
export const APP = "fm-daw";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to; a local page or the desktop window jams as a guest. */
export const SIGN_IN_FROM = ["https://fm-daw-worker-live-ryanquinn-ugis7btfi5dsu52t.notryanquinn.workers.dev"];

// TODO(#4987): import `AvatarReply` from @rustybuns/util/avatar once it lands; this is the same shape.
const AvatarGuard: Guard<Avatar> = (v) => { const a = cleanAvatar(v); if (!a) throw new Bad("an avatar"); return a; };
/** eqosys's answer to GET /me/avatar: the character, and whether they saved one (false: the default from their name). */
export const AvatarReply = obj({ avatar: AvatarGuard, saved: bool() });

/** The character kept on eqosys for whoever holds `token`, or null (signed out, eqosys down, no endpoint yet). */
export async function eqosysAvatar(base: string, token: string): Promise<Avatar | null> {
  const r = await getJson(`${base.replace(/\/$/, "")}/me/avatar`, AvatarReply, { headers: { authorization: `Bearer ${token}` } });
  return r?.avatar ?? null;
}
