// A small ink drawing of each weapon for the HUD's list, drawn on a 28 by 14 grid in the
// current text colour, so the list reads at a glance without the word "git" on every row.

import type { WeaponId } from "../sim/weapons.ts";

const ICONS: Record<WeaponId, string> = {
  // Rifle: stock, body, magazine, barrel.
  commit: `<path d="M1 6h4l2-1h11v3H9l-1 3H6l1-3H1z"/><rect x="18" y="6" width="9" height="1.4"/><rect x="11" y="8" width="2" height="3"/>`,
  // Shotgun: long double barrel over a pump.
  add: `<path d="M1 6h5l2-1h4v4H8l-1 2H5l1-2H1z"/><rect x="12" y="5" width="15" height="1.4"/><rect x="12" y="7" width="15" height="1.4"/><rect x="15" y="8.4" width="5" height="1.8"/>`,
  // Machine gun: body, a drum underneath, a heavy barrel.
  fetch: `<path d="M1 5h5l1 1h10v3H8l-1 2H5l1-2H1z"/><circle cx="12" cy="10.5" r="2.5"/><rect x="17" y="6.2" width="10" height="1.8"/>`,
  // Flamethrower: the tank on the back, a nozzle, the fire coming out.
  clean: `<rect x="1" y="3" width="4" height="9" rx="2"/><path d="M5 7h10v2H5z"/><path d="M15 5.5l3 2.5-3 2.5z"/><path d="M19 8c2-3 4-1 5-4 1 2 3 3 3 4s-2 3-4 2c-1 2-3 2-4 1z" fill="#e8590c"/>`,
  // Bazooka: a tube on the shoulder with the rocket's nose at the front.
  push: `<rect x="2" y="5" width="18" height="4" rx="1"/><path d="M20 5.4l6 1.6-6 1.6z"/><rect x="8" y="9" width="2" height="3"/><rect x="12" y="9" width="2" height="2"/>`,
  // Grenade: the round body, its lever and pin.
  merge: `<circle cx="14" cy="8.5" r="4.5"/><rect x="12" y="2.5" width="4" height="2"/><path d="M16 3h3v1.4h-3z"/><circle cx="20.5" cy="4" r="1.3" fill="none" stroke="currentColor" stroke-width="0.9"/>`,
  // Sniper: a long thin barrel with a scope on top.
  rebase: `<path d="M1 7h4l2-1h8v2.4H8l-1 2.6H5l1-2.6H1z"/><rect x="15" y="6.6" width="12" height="1"/><rect x="7" y="3" width="7" height="2" rx="1"/><rect x="9.5" y="5" width="1" height="1"/>`,
  // Cherry-pick: two cherries on one stalk.
  cherry: `<circle cx="10" cy="10" r="3"/><circle cx="17" cy="10" r="3"/><path d="M10 7.5c1-3 3-5 5-6m2 6c-.5-3-1-5-2-6" fill="none" stroke="currentColor" stroke-width="1"/>`,
  // Revert: an arrow turning back on itself.
  revert: `<path d="M9 4h7a5 5 0 0 1 0 10h-5v-2h5a3 3 0 0 0 0-6H9v3L4 5l5-4z"/>`,
  // Stash: a box with its lid line.
  stash: `<rect x="7" y="3" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 6.5h14M12 3v3.5m4-3.5v3.5" stroke="currentColor" stroke-width="1"/>`,
  // Blame: an eye that sees through walls.
  blame: `<path d="M3 7.5c3-5 19-5 22 0-3 5-19 5-22 0z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="14" cy="7.5" r="2.6"/>`,
  // Pistol: a short slide over a grip.
  amend: `<path d="M5 5h17v3.2H12l-1 5H8l.6-5H5z"/><rect x="22" y="5.6" width="3" height="1.4"/>`,
  // Plasma grenade: a ball with a glowing core.
  squash: `<circle cx="14" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="14" cy="8" r="2.4" fill="#e8590c"/><rect x="12.5" y="1.5" width="3" height="2"/>`,
  // Reset --hard: a bomb with a lit fuse.
  reset: `<circle cx="12" cy="9" r="4.5"/><rect x="14.5" y="3.4" width="2.4" height="2" transform="rotate(40 15.7 4.4)"/><path d="M17 3c1-1.5 2.5-1.5 3-.5" fill="none" stroke="currentColor" stroke-width="0.9"/><circle cx="21" cy="2.2" r="1.2" fill="#e8590c"/>`,
};

/** The weapon's drawing as an inline SVG, sized by CSS. */
export const weaponIcon = (id: WeaponId) =>
  `<svg viewBox="0 0 28 14" fill="currentColor" aria-hidden="true">${ICONS[id]}</svg>`;
