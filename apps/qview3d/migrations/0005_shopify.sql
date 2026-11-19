-- Shopify (src/shopify.ts). The store connection is a field on the org: its *.myshopify.com domain.
ALTER TABLE orgs ADD COLUMN shopify TEXT;
CREATE INDEX orgs_shopify ON orgs (shopify);

-- A store that installed the app. Its Admin API token is sealed like a webhook's secret (AES-GCM under a key made from
-- UPLOAD_SECRET) and never served. `picks` is a JSON map: a Shopify product's handle to the QView3D product it shows.
-- The row goes when the store uninstalls.
CREATE TABLE shopify_shops (
  shop TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  scope TEXT NOT NULL,
  picks TEXT NOT NULL DEFAULT '{}',
  installed INTEGER NOT NULL
);
