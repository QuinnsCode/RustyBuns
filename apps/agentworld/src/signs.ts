// Signs in the galaxy, the page's side (sign.ts has the rules): ask for your signature before your first visit and on
// "Sign again", stand each nearby plot's sign in the scene, and give every other person's sign a "Hide this" button.
// Hiding is for you only and this browser keeps it. Every sign read goes through the SignReply guard.
import { arr, check, str } from "@rustybuns/util/guard";
import { getJson, parseJson } from "@rustybuns/util/http";
import { bearer } from "./account.ts";
import type { Plot } from "./galaxy.ts";
import type { Scene3d } from "./land3d.ts";
import { type Point, SignReply } from "./sign.ts";
import { signPad } from "./signPad.ts";

const HIDDEN = "agentworld:hidden-signs";
const Hidden = arr(str(32), 2000, { drop: true });
const readHidden = (): Set<string> => {
  try { return new Set(check(Hidden, parseJson(localStorage.getItem(HIDDEN) ?? "[]"))); } catch { return new Set(); }
};

/** Signs already read, by plot id and version: kept while the page is open. */
const read = new Map<string, Promise<Point[][] | null>>();
const signOf = (id: string, version: number) => {
  const k = `${id}:${version}`;
  const had = read.get(k);
  if (had) return had;
  const next = getJson(`/api/galaxy/sign/${id}`, SignReply).then((r) => {
    // No answer: ask again next time.
    if (!r) read.delete(k);
    return r?.strokes ?? null;
  });
  read.set(k, next);
  return next;
};

type Standing = { x: number; y: number; id: string; mine: boolean; button: HTMLButtonElement | null };

/** One visit's signs, in the galaxy's layer. */
export function gallerySigns(layer: HTMLElement) {
  const hidden = readHidden(), standing = new Map<string, Standing>(), wanted = new Map<string, string>();
  let scene: Scene3d | null = null, me: string | null = null, own: Point[][] | null = null;
  let closePad: (() => void) | null = null, settle: ((signed: boolean) => void) | null = null;

  const take = (k: string) => {
    const had = standing.get(k);
    if (!had) return;
    had.button?.remove();
    standing.delete(k);
    scene?.setSign(had.x, had.y, null);
  };

  const hide = (k: string, id: string) => {
    hidden.add(id);
    try { localStorage.setItem(HIDDEN, JSON.stringify([...hidden].slice(-2000))); } catch { /* private window: this visit only */ }
    wanted.delete(k);
    take(k);
  };

  const stand = (k: string, p: Plot, id: string, strokes: Point[][]) => {
    take(k);
    const mine = id === me;
    let button: HTMLButtonElement | null = null;
    if (!mine) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "sign-hide";
      button.textContent = "Hide this";
      button.setAttribute("aria-label", "Hide this sign");
      button.dataset.plot = k;
      button.hidden = true;
      button.addEventListener("click", () => hide(k, id));
      layer.append(button);
    }
    standing.set(k, { x: p.x, y: p.y, id, mine, button });
    scene?.setSign(p.x, p.y, strokes);
  };

  /** The pad, until a signature is saved (true) or it is put away (false). */
  const sign = (again: boolean): Promise<boolean> => {
    if (closePad) return Promise.resolve(false);
    return new Promise((done) => {
      settle = (signed) => { closePad?.(); closePad = null; settle = null; done(signed); };
      closePad = signPad(layer, async (strokes) => {
        const res = await fetch("/api/galaxy/sign", { method: "POST", headers: { ...await bearer(), "content-type": "application/json" }, body: JSON.stringify({ strokes }) }).catch(() => null);
        if (!res?.ok) return res?.status === 429 ? "Signing too often: wait a moment, then press Done." : "That didn't save: try Done again.";
        own = strokes;
        const mine = [...standing.entries()].find(([, s]) => s.mine);
        if (mine) scene?.setSign(mine[1].x, mine[1].y, strokes);
        settle?.(true);
        return null;
      }, again ? () => settle?.(false) : undefined);
    });
  };

  return {
    sign,
    /** The pad is up. */
    signing: () => closePad !== null,
    /** Whether you have signed already; false when you haven't, null when the server didn't say. */
    async signed(): Promise<boolean | null> {
      const got = await getJson("/api/galaxy/sign", SignReply, { headers: await bearer() });
      own = got?.strokes ?? null;
      return got ? got.strokes !== null : null;
    },
    /** The scene is up and this is your plot. */
    start(s: Scene3d, plot: string) {
      scene = s;
      me = plot;
      const again = document.createElement("button");
      again.type = "button";
      again.className = "sign-again";
      again.textContent = "Sign again";
      again.addEventListener("click", () => { again.blur(); void sign(true); });
      layer.append(again);
    },
    /** A plot was shown: stand its sign, if it has one you haven't hidden and it is next to you (`near`). */
    plot(p: Plot, near: boolean) {
      const k = `${p.x},${p.y}`, id = p.id;
      const mine = id !== null && id === me;
      if (!near || !id || p.city || (!mine && (p.signed === 0 || hidden.has(id)))) { wanted.delete(k); take(k); return; }
      const version = `${id}:${p.signed}`;
      if (wanted.get(k) === version) return;
      wanted.set(k, version);
      void (mine && own ? Promise.resolve(own) : signOf(id, p.signed)).then((strokes) => {
        if (wanted.get(k) !== version) return;
        if (strokes) stand(k, p, id, strokes); else wanted.delete(k);
      });
    },
    /** Each frame: keep every "Hide this" button under its sign. */
    place() {
      for (const s of standing.values()) {
        if (!s.button) continue;
        const at = scene?.signSpot(s.x, s.y) ?? null;
        s.button.hidden = !at || closePad !== null;
        if (at) s.button.style.transform = `translate(${at.x.toFixed(0)}px, ${at.y.toFixed(0)}px) translateX(-50%)`;
      }
    },
    state: () => Object.fromEntries([...standing].map(([k, s]) => [k, { mine: s.mine }])),
    close() { settle?.(false); },
  };
}
export type GallerySigns = ReturnType<typeof gallerySigns>;
