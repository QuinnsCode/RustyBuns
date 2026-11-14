// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The demo org: what anyone can embed to see QView3D working. A fresh deploy's migrations write it into D1
// (migrations/0002_demo.sql, made from this file by `bun scripts/demo-sql.ts`), so a new host shows a live sample with
// nothing to seed by hand. That public demo keeps no files (readOnly): anyone may embed it, so signing an upload for it
// is refused (customising and downloading a snapshot still work, since they run in the browser). On this machine,
// `local()` turns it into a full demo org instead, with an admin key and samples (local.ts).
//
// Changed a product here? Run `bun scripts/demo-sql.ts`. Once a host has run 0002, a change needs a new migration.
import type { Org, Product } from "./api.ts";

export const DEMO_ORG = "demo";

/** The public demo: any page may embed it; no admins, no samples, no uploads. */
export const DEMO_SETTINGS: Org = { origins: ["*"], admins: [], samples: 0, readOnly: true };

export const DEMO_PRODUCTS: Record<string, Product> = {
  "field-cap": { name: "Field Cap", model: "cap", colors: ["#1f2937", "#f5f5f4", "#b91c1c", "#1d4ed8", "#166534", "#e7d7b9"] },
  "cuff-beanie": { name: "Cuff Beanie", model: "beanie", colors: ["#d97706", "#1f2937", "#7c3aed", "#f5f5f4"] },
  "bucket-hat": { name: "Bucket Hat", model: "bucket", colors: ["#e7d7b9", "#166534", "#1f2937", "#f5f5f4"] },
  "crew-tee": { name: "Crew Tee", model: "tee", colors: ["#f5f5f4", "#1f2937", "#b91c1c", "#1d4ed8", "#e7d7b9"] },
  "crew-sweater": { name: "Crew Sweater", model: "sweater", colors: ["#7f1d1d", "#1f2937", "#e7d7b9", "#166534", "#f5f5f4"] },
  "pullover-hoodie": { name: "Pullover Hoodie", model: "hoodie", colors: ["#6b7280", "#1f2937", "#166534", "#7c3aed", "#f5f5f4"] },
  "classic-tank": { name: "Classic Tank", model: "tank", colors: ["#f5f5f4", "#1f2937", "#1d4ed8", "#b91c1c"] },
  "racerback-tank": { name: "Racerback Tank", model: "racerback", colors: ["#f5f5f4", "#1f2937", "#be185d", "#0f766e"] },
};
