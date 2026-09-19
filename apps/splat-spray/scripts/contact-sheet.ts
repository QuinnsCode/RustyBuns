// bun scripts/contact-sheet.ts [out.json]
//
// Dumps each object's splats as seen from the front, so a contact sheet can be
// rendered without a GPU. Catches things that don't read as what they're named
// (the first "star" came out as a lump).
import { buildRoom } from "../src/levels/room.ts";

const room = buildRoom({ shuffle: false });
const out = room.objects.map((o) => {
  const pts: number[] = [];
  const cols: number[] = [];
  for (let i = o.first; i < o.first + o.count; i++) {
    pts.push(room.locals[i * 3]!, room.locals[i * 3 + 1]!, room.locals[i * 3 + 2]!);
    cols.push(room.colors[i * 3]!, room.colors[i * 3 + 1]!, room.colors[i * 3 + 2]!);
    if (pts.length > 60_000) break;   // enough to see the shape
  }
  return { name: o.name, radius: o.radius, pts, cols };
});
await Bun.write(process.argv[2] ?? "/tmp/objects.json", JSON.stringify(out));
console.log(`${out.length} objects dumped`);
