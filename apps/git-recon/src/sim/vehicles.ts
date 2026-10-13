// Killstreak vehicles. Down 15 guards in a level and a buggy drops in beside you; 25 and it's
// an attack helicopter. Walk up and press E to get in, E again to get out.
//
//   buggy  W/S throttle, A/D steer. Runs guards over and smashes files it hits at speed.
//          A gun on the roll bar fires where you aim.
//   heli   W/A/S/D fly the way you look, Space climbs, C drops. Click for the chin gun,
//          right click for rockets.
//
// Both soak the hits meant for you while you're in them. When one is wrecked it blows up and
// throws you clear.

import type { WeaponId } from "./weapons.ts";

export type VehicleKind = "buggy" | "heli";

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  hp: number;
  maxHp: number;
  /** Who's in it, by soldier id, or -1. */
  driver: number;
  alive: boolean;
  /** Seconds until the gun, and the rockets, can fire again. */
  cd: number;
  rocketCd: number;
  /** Distance driven, for turning the wheels. */
  odo: number;
}

export interface VehicleSpec {
  hp: number;
  /** Top speed, m/s, and how fast it gets there. */
  top: number;
  accel: number;
  /** Hit by a shot within this far of its middle, which sits this high off its base. */
  radius: number;
  mid: number;
  /** The gun it fires on click, how often, and the rockets on right click (heli only). */
  gun: WeaponId;
  gunCd: number;
  rockets?: WeaponId;
  rocketCd?: number;
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  buggy: { hp: 260, top: 22, accel: 16, radius: 1.6, mid: 0.8, gun: "fetch", gunCd: 0.08 },
  heli: { hp: 420, top: 20, accel: 14, radius: 2.4, mid: 1.6, gun: "fetch", gunCd: 0.06, rockets: "push", rocketCd: 0.55 },
};

/** Kills in a level that earn each vehicle. */
export const STREAKS: { kills: number; kind: VehicleKind }[] = [
  { kills: 15, kind: "buggy" },
  { kills: 25, kind: "heli" },
];

/** How near you have to be to get in; how hard a buggy has to be going to run a guard over. */
export const BOARD_REACH = 3.5, RUN_OVER = 5;
/** How high a helicopter can climb over the ground under it, and how low it hovers. */
export const HELI_CEILING = 35, HELI_FLOOR = 1.5;

export const vehicleName = (k: VehicleKind) => (k === "buggy" ? "buggy" : "attack helicopter");
