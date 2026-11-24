// Qollab Studio signs in through eqosys (the shared client, @rustybuns/util/eqosys, under FM DAW's id). Online, the token
// rides to /ws and the Worker checks it (`whoIs` in @rustybuns/util/token), so the room knows you by your eqosys id and name.
// The page makes the eqosys client (studio/main.ts); the Worker imports only these names. Your character is the one kept on eqosys (GET /me/avatar, #4987); until it answers, the look this browser keeps.
import { getJson } from "@rustybuns/util/http";
import { AvatarReply, type Avatar } from "@rustybuns/util/avatar";
import type { Of } from "@rustybuns/util/guard";

/** FM DAW's id in eqosys's APPS. */
export const APP = "fm-daw";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends players back to; a local page or the desktop window jams as a guest. */
export const SIGN_IN_FROM = ["https://fm-daw.notryanquinn.workers.dev"];

/** The character kept on eqosys for whoever holds `token`, or null (signed out, eqosys down, no endpoint yet). */
export async function eqosysAvatar(base: string, token: string): Promise<Avatar | null> {
  return (await eqosysKept(base, token))?.avatar ?? null;
}

/** The character kept on eqosys with whether it is saved (false: made from their name), or null. The dialog's `load`. */
export function eqosysKept(base: string, token: string): Promise<Of<typeof AvatarReply> | null> {
  return getJson(`${base.replace(/\/$/, "")}/me/avatar`, AvatarReply, { headers: { authorization: `Bearer ${token}` } });
}

/** Saves `avatar` as the character kept on eqosys for whoever holds `token` (PUT /me/avatar): eqosys's reply, or null when it didn't take. */
export function saveEqosysAvatar(base: string, token: string, avatar: Avatar): Promise<Of<typeof AvatarReply> | null> {
  return getJson(`${base.replace(/\/$/, "")}/me/avatar`, AvatarReply, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(avatar),
  });
}
