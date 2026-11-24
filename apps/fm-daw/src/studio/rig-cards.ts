// The Esc menu's rig cards for an open-air room (Desert Gathering): each of @rustybuns/gear's rigs as one stack drawn
// to scale from its boxes' sizes (a horn's mouth in each), its name and how it's built. The leader's to pick, read-only
// for everyone else, as the studio cards are; the pick is the sesh's (the project's `rig`), so everyone hears it.
import { esc } from "@rustybuns/util";
import { gear, SYSTEM_IDS, SYSTEMS, systemSound, type SystemId } from "@rustybuns/gear";
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

/** The rig cards into \`host\`, `current` ringed; `pick` when this person may change it. */
export function rigCards(host: HTMLElement, current: SystemId, pick?: (id: SystemId) => void) {
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
    b.innerHTML = `${stackSvg(id)}<b>${esc(s.name)}</b><span class="sheet">${esc(sheet)}</span><span class="keys">${esc(s.about)}</span>`;
    if (pick) b.addEventListener("click", () => pick(id));
    host.append(b);
  }
}
