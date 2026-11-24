// The Esc menu's rig cards for an open-air room (Desert Gathering): each of @rustybuns/gear's rigs as one stack drawn
// to scale from its boxes' sizes (a horn's mouth in each), its name and how it's built. The leader's to pick, read-only
// for everyone else, as the studio cards are; the pick is the sesh's (the project's `rig`), so everyone hears it.
import { esc } from "@rustybuns/util";
import { coverage, gear, source, SYSTEM_IDS, SYSTEMS, systemSound, type SystemId } from "@rustybuns/gear";
import type { StudioDef } from "./room.ts";
import { rigStacks } from "./pa-room.ts";
import { sideways } from "./picker.ts";

/** One stack as a side-on silhouette, bottom to top, scaled so the tallest rig fills the card. */
export function stackSvg(id: SystemId): string {
  const boxes = SYSTEMS[id].stack.map((b) => gear(b).size), tall = 2.8, px = 40;
  let y = tall, out = "";
  for (const [i, b] of boxes.entries()) {
    y -= b.h;
    const x = 1.2 - b.w / 2, isDolly = SYSTEMS[id].stack[i] === "sand-dolly";
    out += `<rect x="${(x * px).toFixed(1)}" y="${(y * px).toFixed(1)}" width="${(b.w * px).toFixed(1)}" height="${(b.h * px).toFixed(1)}" rx="${isDolly ? 1 : 2}" fill="${isDolly ? "#6b5a44" : "#0d0e10"}" stroke="#3a3e45" stroke-width="1"/>`;
    if (!isDolly) out += `<rect x="${((x + b.w * 0.12) * px).toFixed(1)}" y="${((y + b.h * 0.14) * px).toFixed(1)}" width="${(b.w * 0.76 * px).toFixed(1)}" height="${(b.h * 0.72 * px).toFixed(1)}" rx="3" fill="#1c1e22"/>`;
  }
  return `<svg viewBox="0 0 ${2.4 * px} ${tall * px}" aria-hidden="true">${out}</svg>`;
}

/**
 * The rig's mids and highs over the floor from above, worked out by @rustybuns/gear's coverage map from its top boxes'
 * sheets (pattern, sensitivity) where the room stands its stacks: the wall along the top, the floor running down. Its
 * colours are against the floor's middle, 10 m out (where the PA sets its level, pa-room.ts FLOOR_M): pale gold
 * louder than there, orange within 3 dB of it, teal 9 dB down, deep blue past 15; a small picture, as a data URL.
 */
export function coverageMap(def: StudioDef, id: SystemId, px = 88): string {
  const rig = { ...def, outdoor: { ...def.outdoor!, rig: id } }, stacks = rigStacks(rig), sys = SYSTEMS[id];
  const top = sys.stack.reduce((h, b) => h + gear(b).size.h, 0) - gear(sys.top).size.h / 2;
  const sources = stacks.map((st) => source(sys.top, { x: st.at[0], y: top, z: st.at[1] }, { yaw: st.yaw }));
  const mx = stacks.reduce((t, st) => t + st.at[0], 0) / stacks.length, mz = stacks.reduce((t, st) => t + st.at[1], 0) / stacks.length;
  const area = { x0: mx - 13, x1: mx + 13, z0: mz + 0.5, z1: mz + 26.5, y: 1.6, nx: px, nz: px };
  const grid = coverage(sources, area, "high"), at10 = grid.db[Math.min(px - 1, Math.round(((10 - 0.5) / 26) * px)) * px + Math.round(px / 2)]!;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!, img = g.createImageData(px, px);
  const ramp: [number, [number, number, number]][] = [[-6, [255, 236, 170]], [0, [255, 140, 80]], [3, [230, 90, 70]], [9, [40, 150, 160]], [15, [18, 30, 70]]];
  for (let k = 0; k < grid.db.length; k++) {
    const down = Math.max(-6, Math.min(15, at10 - grid.db[k]!));
    let i = 0;
    while (i < ramp.length - 2 && down > ramp[i + 1]![0]) i++;
    const [d0, c0] = ramp[i]!, [d1, c1] = ramp[i + 1]!, t = Math.max(0, Math.min(1, (down - d0) / (d1 - d0)));
    for (let ch = 0; ch < 3; ch++) img.data[k * 4 + ch] = c0[ch]! + (c1[ch]! - c0[ch]!) * t;
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // the stacks, as white bars along the top edge
  g.fillStyle = "#ffffff";
  for (const st of stacks) g.fillRect(((st.at[0] - area.x0) / (area.x1 - area.x0)) * px - 2, 0, 4, 3);
  return c.toDataURL();
}

/** The rig cards into \`host\`, `current` ringed; `pick` when this person may change it. */
export function rigCards(host: HTMLElement, def: StudioDef, current: SystemId, pick?: (id: SystemId) => void) {
  host.replaceChildren();
  host.setAttribute("role", "radiogroup");
  sideways(host);
  for (const id of SYSTEM_IDS) {
    const b = document.createElement("button"), s = SYSTEMS[id];
    b.type = "button"; b.className = "studio-card rig-card"; b.dataset.rig = id;
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(id === current));
    b.disabled = !pick;
    b.title = s.about;
    // the sheet's numbers: the top's pattern and its loudest, the stack's low end, and what one stack weighs
    const snd = systemSound(s), kg = s.stack.reduce((t, b) => t + gear(b).kg, 0);
    const sheet = `${snd.coverage.h} x ${snd.coverage.v}° · ${snd.maxSpl} dB peak · down to ${snd.lowCut} Hz · ${Math.round(kg)} kg a stack`;
    b.innerHTML = `<span class="rig-pics">${stackSvg(id)}<img src="${coverageMap(def, id)}" alt="" title="Mids and highs over the floor, from above: the wall along the top"></span><b>${esc(s.name)}</b><span class="sheet">${esc(sheet)}</span><span class="keys">${esc(s.about)}</span>`;
    if (pick) b.addEventListener("click", () => pick(id));
    host.append(b);
  }
}
