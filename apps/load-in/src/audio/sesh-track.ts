// An FM DAW sesh as a deck's track: FM DAW keeps each sesh's last bounce (a WAV, its tempo in X-Bpm) at
// /sesh/<name>/bounce, open to any page. A DJ types the sesh's name or pastes its link; the deck takes the bounce's
// tempo for its beat, and every page in the crew room fetches the same bounce by name, so they all play one mix.
import { num, check } from "@rustybuns/util/guard";

/** Where FM DAW lives: the live one, or `?fm=<origin>` for a local one. */
export const FM_DAW = "https://fm-daw.notryanquinn.workers.dev";
/** A sesh's name, as FM DAW makes them (fuzzy-black-panda): lowercase letters, digits and dashes. */
export const SESH = /^[a-z0-9-]{1,64}$/;

/** The sesh a DJ means: a bare name, or the sesh's link (…/sesh/<name>, with or without more after it). Null if neither. */
export function seshOf(typed: string): string | null {
  const t = typed.trim().toLowerCase();
  const m = /\/sesh\/([a-z0-9-]{1,64})(?:[/?#]|$)/.exec(t);
  const name = m ? m[1]! : t;
  return SESH.test(name) ? name : null;
}

export const bounceUrl = (sesh: string, base = FM_DAW) => `${base.replace(/\/$/, "")}/sesh/${sesh}/bounce`;

/** A sesh's bounce: its sound as FM DAW wrote it, and the tempo it was made at. */
export type Bounce = { bpm: number; wav: ArrayBuffer };
const Bpm = num(40, 240);

/** Fetched once per sesh per page (the DJ's load and the deck's sound share it); a miss is forgotten so a retry fetches again. */
const got = new Map<string, Promise<Bounce | string>>();

/** The sesh's bounce, or why there is none in words for the booth's card. */
export function fetchBounce(sesh: string, base = FM_DAW, get: typeof fetch = fetch): Promise<Bounce | string> {
  const url = bounceUrl(sesh, base), had = got.get(url);
  if (had) return had;
  const p = (async (): Promise<Bounce | string> => {
    try {
      const r = await get(url);
      if (r.status === 404) return `${sesh} has no bounce yet: bounce it in FM DAW first`;
      if (r.status === 403) return `${sesh} is a private sesh`;
      if (!r.ok) return `FM DAW said ${r.status}`;
      const bpm = check(Bpm, Number(r.headers.get("X-Bpm")));
      if (bpm === null) return `${sesh}'s bounce has no tempo`;
      return { bpm, wav: await r.arrayBuffer() };
    } catch { return "FM DAW is out of reach"; }
  })();
  got.set(url, p);
  void p.then((b) => { if (typeof b === "string") got.delete(url); });
  return p;
}
