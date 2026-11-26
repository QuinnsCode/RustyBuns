// The real connectors (@rustybuns/util/connectors) as they look, at their real size: a socket on a panel and the
// plug on a cable that mates with it. A speakON's round twist-lock with its keyed insert, an XLR's three pins in their
// shell or three holes and the push latch, a combo's XLR holes round a jack hole, powerCON's blue and grey housings, an
// IEC inlet's three blades, an etherCON's latching shell, an EP-6's screw collar.
//
// Both are built in their own frame, in metres: the panel face at z = 0, +z out of it (toward the plug). A socket sits
// on the face and stands a few millimetres proud; a plug's nose is at z = 0 and its body runs out along +z, so a plug
// built here and moved out along +z is the plug pulled out of its socket. gear.ts's `jacks()` turns a socket onto a
// box's face. Sizes are the makers' panel cut-outs (Neutrik's D-size flange is 26 x 31 mm).

import * as THREE from "three";
import type { ConnectorType, Gender } from "@rustybuns/util/connectors";
import { type Piece, R, box, loft } from "./shapes.ts";

/** The slots a connector paints with: gear.ts's `GearSlot`s. */
type Slot = "knob" | "metal" | "chrome" | "cavity" | "rubber" | "plug" | "pcblue" | "pcgrey" | "badge";

const mm = (v: number) => v / 1000;
/** A cylinder along z from z0 to z1, centred at (x, y). */
function cyl(slot: Slot, r: number, z0: number, z1: number, x = 0, y = 0, seg = 12): Piece {
  const m = new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, y, (z0 + z1) / 2));
  return loft(slot, [R((z0 - z1) / 2, r), R((z1 - z0) / 2, r)], { seg, m });
}
/** A box from z0 to z1 (`w` x `h`), centred at (x, y). */
const slab = (slot: Slot, w: number, h: number, z0: number, z1: number, x = 0, y = 0, bevel = 0) =>
  box(slot, [w, h, z1 - z0], [x, y, (z0 + z1) / 2], { bevel });
/** Points round a circle of radius `r`, the first at `a0` (radians from +x). */
const round = (n: number, r: number, a0 = Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(a0 + (i * 2 * Math.PI) / n) * r, Math.sin(a0 + (i * 2 * Math.PI) / n) * r] as const);
/** XLR pin places: 1 and 2 across the top, 3 below, as you look at a female socket's face (mirrored on a male). */
const XLR = (male: boolean) => [[-mm(3.2) * (male ? -1 : 1), mm(2)], [mm(3.2) * (male ? -1 : 1), mm(2)], [0, -mm(3.4)]] as const;

/** Neutrik's D-size flange (26 x 31 mm, 2 mm thick) with its two screws on the diagonal. */
function dFlange(p: Piece[], slot: Slot = "knob", w = mm(26), h = mm(31)) {
  p.push(slab(slot, w, h, 0, mm(2), 0, 0, mm(1)));
  for (const [x, y] of [[-mm(9.5), mm(12)], [mm(9.5), -mm(12)]]) p.push(cyl("chrome", mm(1.6), mm(2), mm(2.6), x, y, 6));
}
/** A speakON chassis socket: a round mouth in a square flange, the keyed insert sunk in it. */
function speakon(p: Piece[], r: number, flange: number) {
  p.push(slab("knob", flange, flange, 0, mm(2), 0, 0, mm(1.5)));
  for (const [x, y] of round(4, flange * 0.62, Math.PI / 4)) p.push(cyl("chrome", mm(1.6), mm(2), mm(2.6), x, y, 6));
  p.push(cyl("knob", r + mm(2), mm(2), mm(4), 0, 0, 14), cyl("cavity", r, mm(4), mm(4.1), 0, 0, 14));
  // the insert, with the key along its top and the contacts' slots down its sides
  p.push(cyl("knob", r * 0.42, mm(2), mm(4.3), 0, 0, 12), slab("knob", mm(2.6), r * 0.36, mm(2), mm(4.3), 0, r * 0.52));
  for (const s of [-1, 1]) p.push(slab("plug", mm(1.2), r * 0.5, mm(4), mm(4.15), s * r * 0.7, 0));
}
/** A latch tab, pushed to let a plug go: on top of the face. */
const latch = (p: Piece[], y: number) => p.push(slab("metal", mm(7), mm(3.5), mm(2), mm(4.5), 0, y, mm(0.8)));

/** A socket on a panel, in its own frame (face at z = 0, +z out). */
export function socketPieces(type: ConnectorType, gender: Gender): Piece[] {
  const p: Piece[] = [];
  switch (type) {
    case "nl4": speakon(p, mm(10.5), mm(31)); break;
    case "nl8": speakon(p, mm(14), mm(40)); break;
    case "nl2-combo":
      // speakON's mouth with a quarter-inch hole through its insert
      speakon(p, mm(10.5), mm(31));
      p.push(cyl("cavity", mm(3.2), mm(4.3), mm(4.4), 0, 0, 10));
      break;
    case "xlr3":
    case "combo":
    case "ethercon": {
      dFlange(p, type === "ethercon" ? "metal" : "knob");
      p.push(cyl(type === "ethercon" ? "metal" : "knob", mm(11.5), mm(2), mm(4.2), 0, -mm(1), 12));
      if (type === "ethercon") { p.push(slab("cavity", mm(12), mm(10.5), mm(4.2), mm(4.3), 0, -mm(1))); latch(p, mm(12)); break; }
      if (gender === "male") {
        // a male socket: the pins standing in a recessed shell, its key slot at the top
        p.push(cyl("cavity", mm(9.6), mm(4.2), mm(4.3), 0, -mm(1), 14), slab("knob", mm(2.5), mm(2), mm(4.2), mm(4.4), 0, mm(8.4)));
        for (const [x, y] of XLR(true)) p.push(cyl("plug", mm(0.8), mm(4.3), mm(6.3), x, y - mm(1), 6));
      } else {
        for (const [x, y] of XLR(false)) p.push(cyl("cavity", mm(1.3), mm(4.2), mm(4.3), x, y - mm(1), 6));
        if (type === "combo") p.push(cyl("metal", mm(4.4), mm(4.2), mm(4.35), 0, -mm(1), 12), cyl("cavity", mm(3.2), mm(4.35), mm(4.45), 0, -mm(1), 12));
        latch(p, mm(12));
      }
      break;
    }
    case "trs":
    case "ts":
      // a panel jack: a hex nut round the hole
      p.push(cyl("metal", mm(7), 0, mm(2.4), 0, 0, 6), cyl("chrome", mm(4.8), mm(2.4), mm(3.2), 0, 0, 16), cyl("cavity", mm(3.2), mm(3.2), mm(3.3), 0, 0, 14));
      break;
    case "trs-mini":
      p.push(cyl("metal", mm(3.6), 0, mm(1.6), 0, 0, 6), cyl("cavity", mm(1.8), mm(1.6), mm(1.7), 0, 0, 10));
      break;
    case "rca":
    case "coax":
      p.push(cyl("chrome", mm(4.2), 0, mm(8), 0, 0, 16), cyl("cavity", mm(1.6), mm(8), mm(8.1), 0, 0, 10), cyl(type === "coax" ? "pcgrey" : "knob", mm(5.4), 0, mm(1.2), 0, 0, 16));
      break;
    case "powercon-blue":
    case "powercon-grey":
    case "powercon-true1": {
      // the housing in its colour round the mouth, the keyed insert in it (TRUE1 is black, with a grey locking ring)
      const shell: Slot = type === "powercon-blue" ? "pcblue" : type === "powercon-grey" ? "pcgrey" : "knob";
      p.push(slab("knob", mm(31), mm(35), 0, mm(2), 0, 0, mm(1.5)));
      for (const [x, y] of [[-mm(11), mm(13.5)], [mm(11), -mm(13.5)]]) p.push(cyl("chrome", mm(1.6), mm(2), mm(2.6), x, y, 6));
      p.push(cyl(shell, mm(12.5), mm(2), mm(5.5), 0, 0, 14), cyl("cavity", mm(10), mm(5.5), mm(5.6), 0, 0, 14));
      if (type === "powercon-true1") p.push(cyl("pcgrey", mm(13), mm(4), mm(5.2), 0, 0, 14));
      p.push(cyl(shell, mm(4.2), mm(2), mm(5.4), 0, 0, 10), slab(shell, mm(3), mm(4), mm(2), mm(5.4), 0, mm(5.5)));
      break;
    }
    case "iec":
      // a C14 inlet: a flange with its two screws, the moulded shroud, three blades
      p.push(slab("knob", mm(48), mm(23), 0, mm(2.5), 0, 0, mm(1)));
      for (const s of [-1, 1]) p.push(cyl("chrome", mm(1.8), mm(2.5), mm(3.1), s * mm(20), 0, 6));
      p.push(slab("knob", mm(28), mm(20.5), mm(2.5), mm(5), 0, 0, mm(2.5)), slab("cavity", mm(24.5), mm(16.5), mm(5), mm(5.1), 0, -mm(0.5), mm(2)));
      for (const [x, y] of [[-mm(7), -mm(2)], [mm(7), -mm(2)], [0, mm(4)]]) p.push(slab("chrome", mm(1.2), mm(4), mm(5), mm(6.5), x, y));
      if (gender === "male") p.push(slab("pcgrey", mm(5), mm(2), mm(2.5), mm(5.2), 0, -mm(11.5)));
      break;
    case "ep6":
      // a round multipin: a threaded metal barrel and its insert of six holes
      p.push(slab("metal", mm(34), mm(34), 0, mm(2), 0, 0, mm(2)), cyl("chrome", mm(12.5), mm(2), mm(9), 0, 0, 16), cyl("knob", mm(10.5), mm(8), mm(9.2), 0, 0, 16));
      for (const [x, y] of round(6, mm(6))) p.push(cyl("cavity", mm(1.2), mm(9.2), mm(9.3), x, y, 6));
      break;
    case "edison":
      p.push(slab("badge", mm(70), mm(115), 0, mm(3), 0, 0, mm(3)));
      for (const y of [-1, 1]) { for (const s of [-1, 1]) p.push(slab("cavity", mm(2), mm(7), mm(3), mm(3.1), s * mm(6.3), y * mm(19))); p.push(cyl("cavity", mm(2.4), mm(3), mm(3.1), 0, y * mm(19) - mm(9), 8)); }
      break;
    case "spade":
      p.push(cyl("chrome", mm(5), 0, mm(10), 0, 0, 12), cyl("metal", mm(6), mm(6), mm(8), 0, 0, 6));
      break;
    case "multipin":
      p.push(slab("metal", mm(60), mm(60), 0, mm(3), 0, 0, mm(2)), cyl("chrome", mm(24), mm(3), mm(20), 0, 0, 24), cyl("cavity", mm(19), mm(20), mm(20.1), 0, 0, 24));
      break;
  }
  return p;
}

/** The plug on a cable that mates with a socket of `type` and `gender`, in its own frame (its nose at z = 0, the body
 * out along +z): a speakON's barrel and twist ring, an XLR's shell and latch, a powerCON's coloured twist ring. */
export function plugPieces(type: ConnectorType, socketGender: Gender): Piece[] {
  const p: Piece[] = [];
  const male = socketGender === "female";
  const boot = (r: number, z0: number, len: number) => p.push(loft("rubber", [R(z0, r), R(z0 + len * 0.7, r * 0.92), R(z0 + len, r * 0.45)], { seg: 20, m: new THREE.Matrix4().makeRotationX(Math.PI / 2) }));
  switch (type) {
    case "nl4":
    case "nl8":
    case "nl2-combo": {
      const r = type === "nl8" ? mm(13.5) : mm(10);
      p.push(cyl("knob", r * 0.98, 0, mm(10), 0, 0, 24), cyl("knob", r + mm(3), mm(10), mm(22), 0, 0, 24));
      for (const [x, y] of round(8, r + mm(3), 0)) p.push(slab("rubber", mm(1.5), mm(1.5), mm(11), mm(21), x, y));
      p.push(slab("metal", mm(3), mm(5), mm(16), mm(21), 0, r + mm(3.5)));
      // its nose: a dark ring round the contact sleeve, the key slot along its top
      p.push(cyl("cavity", r * 0.8, -mm(0.1), 0, 0, 0, 16), cyl("knob", r * 0.45, -mm(0.3), 0, 0, 0, 12), slab("knob", mm(2.6), r * 0.3, -mm(0.3), 0, 0, -r * 0.6));
      for (const sx of [-1, 1]) p.push(slab("plug", mm(1), r * 0.4, -mm(0.4), 0, sx * r * 0.62, 0));
      boot(r + mm(1), mm(22), mm(40));
      break;
    }
    case "xlr3":
    case "combo":
      p.push(cyl("metal", mm(9.4), 0, mm(18), 0, -mm(1), 24));
      if (male) for (const [x, y] of XLR(true)) p.push(cyl("plug", mm(0.8), -mm(6), 0, x, y - mm(1), 8));
      else { for (const [x, y] of XLR(false)) p.push(cyl("cavity", mm(1.2), -mm(0.1), 0, x, y - mm(1), 8)); p.push(slab("metal", mm(3), mm(3), mm(4), mm(12), 0, mm(9))); }
      boot(mm(9), mm(18), mm(38));
      break;
    case "trs":
    case "ts":
      p.push(cyl("chrome", mm(3.15), -mm(30), -mm(4), 0, 0, 14), cyl("plug", mm(3.2), -mm(32), -mm(30), 0, 0, 14), cyl("cavity", mm(3.25), -mm(14), -mm(13), 0, 0, 14));
      if (type === "trs") p.push(cyl("cavity", mm(3.25), -mm(26.5), -mm(25.5), 0, 0, 14));
      p.push(cyl("metal", mm(7.5), -mm(4), mm(24), 0, 0, 16));
      boot(mm(6.5), mm(24), mm(20));
      break;
    case "trs-mini":
      p.push(cyl("chrome", mm(1.75), -mm(14), 0, 0, 0, 10), cyl("rubber", mm(3.5), 0, mm(18), 0, 0, 12));
      break;
    case "rca":
    case "coax":
      p.push(cyl("plug", mm(0.8), -mm(9), 0, 0, 0, 8), cyl("chrome", mm(4.5), -mm(7), mm(4), 0, 0, 16), cyl(type === "coax" ? "pcgrey" : "knob", mm(5), mm(4), mm(28), 0, 0, 16));
      break;
    case "powercon-blue":
    case "powercon-grey":
    case "powercon-true1": {
      const ring: Slot = type === "powercon-blue" ? "pcblue" : type === "powercon-grey" ? "pcgrey" : "knob";
      p.push(cyl("knob", mm(12.3), 0, mm(10), 0, 0, 24), cyl(ring, mm(15.5), mm(4), mm(18), 0, 0, 24));
      for (const [x, y] of round(10, mm(15.5), 0)) p.push(slab(ring, mm(2), mm(2), mm(5), mm(17), x, y));
      boot(mm(13), mm(18), mm(48));
      break;
    }
    case "iec":
      p.push(slab("rubber", mm(24), mm(16), 0, mm(26), 0, -mm(0.5), mm(2.5)), slab("rubber", mm(30), mm(24), mm(10), mm(30), 0, -mm(0.5), mm(4)));
      for (const [x, y] of [[-mm(7), -mm(2)], [mm(7), -mm(2)], [0, mm(4)]]) p.push(slab("cavity", mm(2), mm(5), -mm(0.1), 0, x, y));
      boot(mm(8), mm(30), mm(30));
      break;
    case "ethercon":
      p.push(cyl("metal", mm(11), 0, mm(24), 0, -mm(1), 24), slab("knob", mm(11.5), mm(9), -mm(8), 0, 0, -mm(1)), slab("metal", mm(4), mm(3), mm(4), mm(14), 0, mm(10.5)));
      boot(mm(10), mm(24), mm(30));
      break;
    case "ep6":
      p.push(cyl("chrome", mm(14.5), 0, mm(14), 0, 0, 24), cyl("metal", mm(12), mm(14), mm(40), 0, 0, 20), cyl("knob", mm(10.5), -mm(0.2), 0, 0, 0, 16));
      for (const [x, y] of round(6, mm(6))) p.push(cyl("plug", mm(1), -mm(6), 0, x, y, 6));
      boot(mm(11), mm(40), mm(30));
      break;
    case "edison":
      for (const s of [-1, 1]) p.push(slab("chrome", mm(1.5), mm(6.5), -mm(16), 0, s * mm(6.3), 0));
      p.push(cyl("chrome", mm(2.4), -mm(18), 0, 0, -mm(9), 8), slab("rubber", mm(34), mm(40), 0, mm(22), 0, -mm(3), mm(4)));
      break;
    case "spade":
      p.push(slab("plug", mm(7), mm(14), 0, mm(1), 0, -mm(4)), cyl("rubber", mm(3), mm(1), mm(14), 0, -mm(10), 8));
      break;
    case "multipin":
      p.push(cyl("chrome", mm(25), 0, mm(30), 0, 0, 24), cyl("metal", mm(22), mm(30), mm(80), 0, 0, 24), cyl("knob", mm(19), -mm(0.2), 0, 0, 0, 20));
      for (const [x, y] of [...round(8, mm(13)), ...round(4, mm(6), 0)]) p.push(cyl("plug", mm(1), -mm(5), 0, x, y, 6));
      boot(mm(16), mm(80), mm(50));
      break;
  }
  return p;
}
