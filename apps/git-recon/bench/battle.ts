// bun bench/battle.ts [seconds] -> what one battle tick costs the world that hosts it (the Durable
// Object online, the desktop app on a LAN): El Capitan's battle with 8, 32 and 64 players running,
// turning and firing at random, in both modes. The world steps at 120 Hz, so µs/tick x 120 is the
// share of one core it takes. Profile it with `bun --cpu-prof bench/battle.ts`.
import { LEVELS } from "../src/levels/levels.ts";
import { battleGame } from "../src/net/room.ts";
import type { Input } from "../src/sim/game.ts";

const SECONDS = Number(process.argv[2] ?? 20);
const level = LEVELS[0]!;

for (const mode of ["ffa", "teams"] as const) for (const players of [8, 32, 64]) {
  const g = battleGame({ level: level.id, mode, repo: level.repo });
  const ids = Array.from({ length: players }, (_, i) => g.join(`p${i}`).id);
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const inputs = () => new Map<number, Input>(ids.map((id) => [id, {
    right: rand() * 2 - 1, forward: 1, yaw: rand() * 6, pitch: 0, jump: rand() < 0.02, roll: false, crouch: false,
    fire: rand() < 0.5, aim: { x: rand() * 100 - 50, y: 1.2, z: rand() * 100 - 50 },
  }]));
  for (let i = 0; i < 120; i++) g.step(1 / 60, inputs());
  const t = performance.now();
  for (let i = 0; i < SECONDS * 60; i++) g.step(1 / 60, inputs());
  const ms = performance.now() - t, ticks = SECONDS * 120;
  console.log(`${mode.padEnd(6)} ${String(players).padStart(2)} players: ${(ms * 1000 / ticks).toFixed(0).padStart(5)} µs/tick, ${(ms / SECONDS / 10).toFixed(1).padStart(4)}% of one core`);
}
