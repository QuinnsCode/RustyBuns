// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The demo org: what anyone can embed to see QView3D working. A fresh deploy serves it from here when the bucket has
// no orgs/demo/ yet, so a new host shows a live sample with nothing to seed. That built-in demo keeps no files: on a
// public host anyone may embed it, so signing an upload for it is refused (customising and downloading a snapshot
// still work, since they run in the browser). On this machine, `local()` writes a full demo org into the twin instead,
// with an admin key and samples (local.ts).
import type { Org, Product } from "./api.ts";

export const DEMO_ORG = "demo";

/** The built-in demo: any page may embed it; no admins, no samples, no uploads. */
export const BUILT_IN_DEMO: Org = { origins: ["*"], admins: [], samples: 0 };

export const DEMO_PRODUCTS: Record<string, Product> = {
  "field-cap": { name: "Field Cap", model: "cap", colors: ["#1f2937", "#f5f5f4", "#b91c1c", "#1d4ed8", "#166534", "#e7d7b9"] },
  "cuff-beanie": { name: "Cuff Beanie", model: "beanie", colors: ["#d97706", "#1f2937", "#7c3aed", "#f5f5f4"] },
  "bucket-hat": { name: "Bucket Hat", model: "bucket", colors: ["#e7d7b9", "#166534", "#1f2937", "#f5f5f4"] },
};
