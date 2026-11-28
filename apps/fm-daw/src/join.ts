// The front door's Join (#6551): what a guest was sent, a link or a code, to the page that lands them there. A link is
// a room's (/jam.html?room=, as an event's, a party's or a friend's invite is) or a listen link (/listen/<id>), on this
// site. A code is a room's name as it stands in such a link (fuzzy-black-panda); a party's (party-<owner>-<id>) also
// follows what its host has on stage. Pure: the page is src/front.ts.
import { setFromPath } from "./dj/live-wire.ts";

export type Joined = { ok: true; href: string } | { ok: false; why: string };
const ROOM = /^[a-z0-9-]{1,64}$/;
/** A code has a dash in it, as every room name the app makes does, so a stray word doesn't open an empty room. */
const CODE = /^[a-z0-9]+(-[a-z0-9]+)+$/;

export function joinTarget(entry: string, host: string): Joined {
  const said = entry.trim(), no = (why: string): Joined => ({ ok: false, why });
  if (!said) return no("Type the code, or paste the link you were sent.");
  if (!/[/?]/.test(said)) {
    const code = said.toLowerCase();
    if (!CODE.test(code) || code.length > 64) return no("That isn't a code. A code is words joined by dashes, like fuzzy-black-panda.");
    const owner = /^party-([0-9a-f]{24})-/.exec(code)?.[1];
    return { ok: true, href: `/jam.html?room=${code}${owner ? `&party=${owner}` : ""}` };
  }
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(said) ? said : said.startsWith("/") ? `http://${host}${said}` : `http://${said}`); } catch { return no("That link is broken. Copy all of it and paste it again."); }
  if (u.host !== host) return no("That link is for another site, not this one.");
  if (u.pathname === "/jam.html" && ROOM.test(u.searchParams.get("room") ?? "")) return { ok: true, href: u.pathname + u.search };
  if (setFromPath(u.pathname)) return { ok: true, href: u.pathname };
  return no("That link doesn't open a room or a listen page. Ask your host for the invite link.");
}
