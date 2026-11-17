const f = "src/sim.ts";
let s = await Bun.file(f).text();
s = s.replace(`  /** The friends in the room with you (none when you play alone). */
  crew: Mate[];
}`, `  /** The friends in the room with you (none when you play alone). */
  crew: Mate[];
  /** What the cable in your hands weighs on you now, kg: a roll you carry, and laid cable you drag (cables.ts sets it). */
  cableKg?: number;
}`);
s = s.replace(`  const kg = i ? gearOf(i).kg + (w.held?.riders ?? []).reduce((s, r) => s + gear(w.items.find((o) => o.key === r.key)!.gear).kg, 0) : 0;`,
`  const kg = i ? gearOf(i).kg + (w.held?.riders ?? []).reduce((s, r) => s + gear(w.items.find((o) => o.key === r.key)!.gear).kg, 0) : w.cableKg ?? 0;`);
await Bun.write(f, s);
