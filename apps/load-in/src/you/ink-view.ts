// The Ink scrap on the menu: what you have earned on tour, and your own tattoo (a picture from your device, kept in
// this browser only, never sent anywhere). It paints both forearms each time something changes.
import * as THREE from "three";
import { FLASH, earned, plainLook, readLook, type Look } from "./ink.ts";
import { inkSheet } from "./ink-draw.ts";

const KEY = "load-in.look", MAX_PX = 512;
type Nights = readonly { level: string; pass: 0 | 1 }[];
type Arms = { setTattoo(right: THREE.Texture | null, left?: THREE.Texture | null): void };

function loadLook(): Look {
  try { const s = localStorage.getItem(KEY); return s ? readLook(JSON.parse(s)) : plainLook(); } catch { return plainLook(); }
}
function saveLook(l: Look) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* the look lasts this visit */ }
}

/** A picked picture, scaled down to a data URL small enough to keep. */
function shrink(file: File): Promise<string> {
  return new Promise((done, fail) => {
    const r = new FileReader();
    r.onerror = () => fail(new Error("could not read that file"));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => fail(new Error("that file is not a picture"));
      img.onload = () => {
        const k = Math.min(1, MAX_PX / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        const g = c.getContext("2d")!;
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}

export function mountInk(host: HTMLElement, arms: Arms, nights: () => Nights) {
  let look = loadLook(), own: HTMLImageElement | null = null, sheets: THREE.CanvasTexture[] = [];
  host.innerHTML = `<div class="paper ink">
    <b>Ink</b>
    <p id="ink-earned"></p>
    <label class="ink-pick">Your own tattoo <input id="ink-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <div class="ink-row">
      <label>Arm <select id="ink-arm"><option value="left">Left</option><option value="right">Right</option></select></label>
      <label>Wrist to elbow <input id="ink-at" type="range" min="0.1" max="0.9" step="0.02"></label>
      <label>Size <input id="ink-size" type="range" min="0.15" max="0.7" step="0.02"></label>
      <button id="ink-off" type="button">Take it off</button>
    </div>
    <p id="ink-note" class="warn"></p>
  </div>`;
  const el = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const file = el<HTMLInputElement>("ink-file"), arm = el<HTMLSelectElement>("ink-arm"), at = el<HTMLInputElement>("ink-at"), size = el<HTMLInputElement>("ink-size");

  function paint() {
    const got = earned(nights()), all = Object.keys(FLASH).length;
    el("ink-earned").textContent = got.length ? `${got.length} of ${all} earned on tour. Next: pass a new rung.` : `Pass a gig to earn your first. ${all} to collect.`;
    arm.value = look.arm; at.value = String(look.at); size.value = String(look.size);
    el<HTMLElement>("ink-off").hidden = !look.own;
    for (const s of sheets) s.dispose();
    sheets = (["right", "left"] as const).map((side) => {
      const t = new THREE.CanvasTexture(inkSheet(side, got, look, own));
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    arms.setTattoo(sheets[0]!, sheets[1]!);
  }
  function setOwn(url: string | undefined) {
    look = { ...look, own: url };
    own = null;
    if (!url) return paint();
    const img = new Image();
    img.onload = () => { own = img; paint(); };
    img.src = url;
  }
  const change = (next: Partial<Look>) => { look = readLook({ ...look, ...next }); saveLook(look); paint(); };

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try { setOwn(await shrink(f)); saveLook(look); el("ink-note").textContent = ""; }
    catch (e) { el("ink-note").textContent = e instanceof Error ? `${e.message}. Pick a PNG, JPEG or WebP.` : "Pick a PNG, JPEG or WebP."; }
  });
  arm.addEventListener("change", () => change({ arm: arm.value === "right" ? "right" : "left" }));
  at.addEventListener("input", () => change({ at: Number(at.value) }));
  size.addEventListener("input", () => change({ size: Number(size.value) }));
  el("ink-off").addEventListener("click", () => { file.value = ""; setOwn(undefined); saveLook(look); });

  setOwn(look.own);
  return {
    /** Paint again: the tour moved on. */
    refresh: paint,
    /** Put a picture on (a data URL) or take it off, and place it: what the harness calls. */
    ink(url: string | null, where: Partial<Pick<Look, "arm" | "at" | "size">> = {}) { look = readLook({ ...look, ...where }); setOwn(url ?? undefined); saveLook(look); },
    state: () => ({ earned: earned(nights()), own: !!look.own, arm: look.arm, at: look.at, size: look.size }),
  };
}
