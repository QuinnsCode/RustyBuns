// The speaker lineup (#5942): every speaker model in gear.ts copies one named real product. The owner's rules
// (2026-11-25):
// - Shape true, no name. Copy the product's proportions, horn geometry, panels, paint, hardware and wear, but leave the
//   maker's logo and name off the model (where the real box has its name embossed, the model has a plain panel). Code
//   comments and issues may name the product.
// - Reference photos stay local, never in this public repo: `~/.cache/rustybuns/gear-refs/` on the office Mac and on
//   Bob, each photo's source linked in the model's issue. A judge reads them from there.
// - One climb per model, judged against that product's photos (not a description), the turntable shot beside them.
//   Target 7/10, scored as other climbs are (the last score plus half a fresh judge's gain).
// - Ids, jacks and grabs stay, so Load In and Qollab Studio keep working. A size changes only to the product's
//   published dimensions: put them in `published` (gear.test.ts holds GEAR_SIZES to them) and say so in the PR.
// The order: Funktion-One, Turbosound, Void, then QSC and JBL. A row with no `product` is still to pick, in its issue.
import type { GearId } from "./gear.ts";

export type Maker = "Funktion-One" | "Turbosound" | "Void" | "QSC" | "JBL";

export type LineupRow = {
  /** The maker it copies, or null while that is the owner's call. */
  maker: Maker | null;
  /** The product's model name, once picked. */
  product?: string;
  /** Its published width x height x depth in metres, once the model is built to them. */
  published?: readonly [number, number, number];
  /** The issue (or climb) where it is picked and copied. */
  issue: number;
};

/** Every speaker in the catalog (each gear id with a `speaker` sheet) and the real product it copies. */
export const LINEUP: Partial<Record<GearId, LineupRow>> = {
  "stack-mid-high": { maker: "Funktion-One", product: "Res2", published: [0.522, 0.92, 0.445], issue: 5948 },
  "horn-sub-21": { maker: "Funktion-One", product: "F221", published: [1.686, 0.582, 0.867], issue: 5948 }, // the horn bass bins the Res2 stacks on
  "horn-sub-18": { maker: "Funktion-One", product: "F218 MkII", published: [1.326, 0.496, 0.723], issue: 5948 },
  "stack-mid-bass": { maker: "Funktion-One", product: "F215 MkII", published: [0.59, 0.845, 0.603], issue: 5957 },
  "tri-amp-top": { maker: "Turbosound", product: "Flashlight TFS-780H", published: [0.574, 0.825, 0.773], issue: 5958 },
  "tri-amp-bass": { maker: "Turbosound", product: "Flashlight TFS-780L", published: [0.574, 0.825, 0.773], issue: 5958 },
  "sculpted-3way": { maker: "Void", product: "Air Motion V2", published: [0.8539, 0.6712, 0.6599], issue: 5959 },
  "arc-sub-18": { maker: "Void", product: "Arcline 118", published: [0.6568, 0.55, 0.6952], issue: 5959 },
  "triple-21-sub": { maker: "Void", product: "Incubus Sub", published: [1.479, 0.696, 1.218], issue: 5959 },
  "top-12-powered": { maker: "QSC", issue: 5960 },
  "fill-8-powered": { maker: "QSC", issue: 5960 },
  "sub-18": { maker: "QSC", issue: 5960 },
  "wedge-12": { maker: "QSC", issue: 5960 },
  "line-array-10": { maker: "QSC", issue: 5960 },
  "top-15-passive": { maker: "JBL", issue: 5960 },
  "wedge-12-passive": { maker: "JBL", issue: 5960 },
  "line-array-box": { maker: "JBL", issue: 5960 },
  "synergy-horn": { maker: null, issue: 5961 },
  "tapped-horn-18": { maker: null, issue: 5961 },
  "cab-4x12": { maker: null, issue: 5961 },
};
