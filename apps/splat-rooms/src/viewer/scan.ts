// Loads a room's splats into PlayCanvas, thinned to SPLAT_BUDGET first so a
// 1M+ splat scan doesn't sort and draw every splat each frame.
import * as pc from "playcanvas";
import { decimatePly } from "./decimate.ts";

export const SPLAT_BUDGET = 500_000;

export async function loadScan(app: pc.AppBase, plyUrl: string): Promise<{ asset: pc.Asset; entity: pc.Entity }> {
  const res = await fetch(plyUrl);
  if (!res.ok) throw new Error(`${plyUrl}: ${res.status}`);
  const bytes = decimatePly(new Uint8Array(await res.arrayBuffer()), SPLAT_BUDGET);
  // A blob url has no extension, so the filename is what makes PlayCanvas pick its PLY parser.
  const blobUrl = URL.createObjectURL(new Blob([bytes]));
  const asset = new pc.Asset(plyUrl, "gsplat", { url: blobUrl, filename: "scan.ply" });
  app.assets.add(asset);
  await new Promise<void>((resolve, reject) => {
    asset.once("load", () => resolve());
    asset.once("error", (err: string) => reject(new Error(String(err))));
    app.assets.load(asset);
  }).finally(() => URL.revokeObjectURL(blobUrl));
  const entity = new pc.Entity("splats");
  entity.addComponent("gsplat", { asset });
  return { asset, entity };
}
