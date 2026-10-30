// The ground the iOS app draws: GET /api/zone?id= answers with a zone's height samples and the props Zone scatters on it.
import { SCALE, ZONES, loadZoneData, zoneById, zoneLoaded } from "../zones/zone.ts";
import type { ZoneReply } from "../api.ts";

const round = (v: number) => Math.round(v * 100) / 100;

/** The zone's ground, or null for an id that isn't a zone. */
export async function zoneReply(id: string): Promise<ZoneReply | null> {
  if (!ZONES.some((z) => z.id === id)) return null;
  await loadZoneData(id);
  if (!zoneLoaded(id)) return null;
  const z = zoneById(id);
  return {
    id, name: z.data.name, trees: z.data.trees, radius: z.R, n: z.n,
    heights: z.data.heights, lowest: z.lowest, scale: SCALE,
    props: z.props.map((p) => ({ kind: p.kind, x: round(p.x), y: round(p.y), r: round(p.r), tall: round(p.tall), rot: round(p.rot), size: round(p.size), label: p.label ?? "" })),
    station: { x: round(z.station.x), y: round(z.station.y), yaw: round(z.station.yaw) },
  };
}
