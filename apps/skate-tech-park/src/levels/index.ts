// Every level the picker offers: the training plaza, then the parks on real ground.
import { loadZone } from "@rustybuns/terrain";
import type { Level } from "../level.ts";
import { showFront } from "../front/menu.ts";
import { plaza } from "./plaza.ts";
import { elCapitan } from "./el-capitan.ts";
import { grandCanyon } from "./grand-canyon.ts";
import { glacierPoint } from "./glacier-point.ts";
import { grandPrismatic } from "./grand-prismatic.ts";
import { halfDome } from "./half-dome.ts";
import { mariposaGrove } from "./mariposa-grove.ts";
import { oldFaithful } from "./old-faithful.ts";
import { yosemiteFalls } from "./yosemite-falls.ts";
import { zion } from "./zion.ts";
import { arches } from "./arches.ts";
import { bryceCanyon } from "./bryce-canyon.ts";
import { rockyMountain } from "./rocky-mountain.ts";
import { grandTeton } from "./grand-teton.ts";
import { glacier } from "./glacier.ts";
import { olympic } from "./olympic.ts";
import { joshuaTree } from "./joshua-tree.ts";
import { deathValley } from "./death-valley.ts";
import { craterLake } from "./crater-lake.ts";
import { acadia } from "./acadia.ts";
import { badlands } from "./badlands.ts";
import { bigBend } from "./big-bend.ts";
import { blackCanyon } from "./black-canyon.ts";
import { canyonlands } from "./canyonlands.ts";
import { capitolReef } from "./capitol-reef.ts";
import { carlsbadCaverns } from "./carlsbad-caverns.ts";
import { greatSandDunes } from "./great-sand-dunes.ts";
import { greatSmokyMountains } from "./great-smoky-mountains.ts";
import { haleakala } from "./haleakala.ts";
import { hawaiiVolcanoes } from "./hawaii-volcanoes.ts";
import { mountRainier } from "./mount-rainier.ts";
import { lassenVolcanic } from "./lassen-volcanic.ts";
import { sequoia } from "./sequoia.ts";
import { redwood } from "./redwood.ts";
import { americanSamoa } from "./american-samoa.ts";
import { biscayne } from "./biscayne.ts";
import { channelIslands } from "./channel-islands.ts";
import { congaree } from "./congaree.ts";
import { cuyahogaValley } from "./cuyahoga-valley.ts";
import { denali } from "./denali.ts";
import { dryTortugas } from "./dry-tortugas.ts";
import { everglades } from "./everglades.ts";
import { gatesOfTheArctic } from "./gates-of-the-arctic.ts";
import { gatewayArch } from "./gateway-arch.ts";
import { glacierBay } from "./glacier-bay.ts";
import { greatBasin } from "./great-basin.ts";
import { guadalupeMountains } from "./guadalupe-mountains.ts";
import { hotSprings } from "./hot-springs.ts";
import { indianaDunes } from "./indiana-dunes.ts";
import { isleRoyale } from "./isle-royale.ts";
import { katmai } from "./katmai.ts";
import { kenaiFjords } from "./kenai-fjords.ts";
import { kingsCanyon } from "./kings-canyon.ts";
import { kobukValley } from "./kobuk-valley.ts";
import { lakeClark } from "./lake-clark.ts";
import { mammothCave } from "./mammoth-cave.ts";
import { mesaVerde } from "./mesa-verde.ts";
import { newRiverGorge } from "./new-river-gorge.ts";
import { northCascades } from "./north-cascades.ts";
import { petrifiedForest } from "./petrified-forest.ts";
import { pinnacles } from "./pinnacles.ts";
import { saguaro } from "./saguaro.ts";
import { shenandoah } from "./shenandoah.ts";
import { theodoreRoosevelt } from "./theodore-roosevelt.ts";
import { virginIslands } from "./virgin-islands.ts";
import { voyageurs } from "./voyageurs.ts";
import { whiteSands } from "./white-sands.ts";
import { windCave } from "./wind-cave.ts";
import { wrangellStElias } from "./wrangell-st-elias.ts";
import { type ParkLevel, parkLevel } from "./park.ts";
import { PARKS, regionOf, type Region } from "./parks.ts";

export type Entry = { id: string; name: string; blurb: string; region?: Region; load: (real?: boolean) => Promise<Level | ParkLevel> };

const regionFor = (id: string) => { const row = PARKS.find((p) => p.id === id || p.places?.includes(id)); return row && regionOf(row.state); };
const park = (spec: Parameters<typeof parkLevel>[0]): Entry => ({ id: spec.id, name: spec.name, blurb: spec.blurb, region: regionFor(spec.id), load: async (real) => parkLevel(spec, await loadZone(spec.zone), real) });

export const LEVELS: Entry[] = [
  { id: "plaza", name: "Training Plaza", blurb: "An 80 m walled plaza to learn on: a kicker, a funbox, a rail and a gap.", load: async () => plaza },
  park(elCapitan),
  park(glacierPoint),
  park(oldFaithful),
  park(mariposaGrove),
  park(halfDome),
  park(yosemiteFalls),
  park(grandPrismatic),
  park(grandCanyon),
  park(zion),
  park(arches),
  park(bryceCanyon),
  park(rockyMountain),
  park(grandTeton),
  park(glacier),
  park(olympic),
  park(joshuaTree),
  park(deathValley),
  park(craterLake),
  park(acadia),
  park(badlands),
  park(bigBend),
  park(blackCanyon),
  park(canyonlands),
  park(capitolReef),
  park(carlsbadCaverns),
  park(greatSandDunes),
  park(greatSmokyMountains),
  park(haleakala),
  park(hawaiiVolcanoes),
  park(mountRainier),
  park(lassenVolcanic),
  park(sequoia),
  park(redwood),
  park(americanSamoa),
  park(biscayne),
  park(channelIslands),
  park(congaree),
  park(cuyahogaValley),
  park(denali),
  park(dryTortugas),
  park(everglades),
  park(gatesOfTheArctic),
  park(gatewayArch),
  park(glacierBay),
  park(greatBasin),
  park(guadalupeMountains),
  park(hotSprings),
  park(indianaDunes),
  park(isleRoyale),
  park(katmai),
  park(kenaiFjords),
  park(kingsCanyon),
  park(kobukValley),
  park(lakeClark),
  park(mammothCave),
  park(mesaVerde),
  park(newRiverGorge),
  park(northCascades),
  park(petrifiedForest),
  park(pinnacles),
  park(saguaro),
  park(shenandoah),
  park(theodoreRoosevelt),
  park(virginIslands),
  park(voyageurs),
  park(whiteSands),
  park(windCave),
  park(wrangellStElias),
];

/** The level a query string asks for (`?level=el-capitan`), else El Capitan Meadow: the game starts in a national park. */
export const pick = (search: string): Entry => LEVELS.find((l) => l.id === new URLSearchParams(search).get("level")) ?? LEVELS.find((l) => l.id === "el-capitan")!;

/** The start screen shows when the page was opened without choosing a level (or asking for the showroom); the title screen comes first on a bare address. */
export const needsStartScreen = (search: string) => touring(search) && !showFront(search);

/** The home page, title screen and park picker alike, has no rider: a camera flies over a park behind them. */
export const touring = (search: string) => {
  const q = new URLSearchParams(search);
  return !q.has("level") && !q.has("showroom");
};

/** `?real` rides the terrain at its true height instead of squashed vertically. */
export const wantsReal = (search: string) => new URLSearchParams(search).has("real");

/** The park the home page flies over: `?tour=half-dome`, else one at random, so each visit shows a different one. */
export const tourPick = (search: string, rand = Math.random): Entry => {
  const parks = LEVELS.filter((l) => l.id !== "plaza");
  return parks.find((l) => l.id === new URLSearchParams(search).get("tour")) ?? parks[Math.floor(rand() * parks.length)]!;
};
