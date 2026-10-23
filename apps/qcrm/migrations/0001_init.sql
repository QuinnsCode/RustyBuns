-- Better Auth's tables (its getMigrations for sqlite/D1, v1.7.7), as in codeSplitter's 0005_auth.sql.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Orgs and who is in them. An org's id is a hash of its owner's account id (src/orgs.ts),
-- so a URL carries nothing that walks back to a person. Times are ms since the epoch.
CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_user_id TEXT NOT NULL, created_at INTEGER NOT NULL, plan TEXT NOT NULL DEFAULT 'free');
CREATE INDEX orgs_owner ON orgs (owner_user_id);
CREATE TABLE memberships (org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (org_id, user_id));
CREATE INDEX memberships_user ON memberships (user_id);

-- The CRM. Every row carries its org and is soft-deleted (deleted_at), so sync can replay the delete.
CREATE TABLE companies (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT, industry TEXT, size TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX companies_org_updated ON companies (org_id, updated_at);
CREATE TABLE contacts (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, title TEXT,
  company_id TEXT, owner_user_id TEXT, tags TEXT NOT NULL DEFAULT '[]', notes TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX contacts_org_updated ON contacts (org_id, updated_at);
CREATE INDEX contacts_org_email ON contacts (org_id, email);
CREATE INDEX contacts_org_company ON contacts (org_id, company_id);
CREATE TABLE deals (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, contact_id TEXT, company_id TEXT,
  stage TEXT NOT NULL DEFAULT 'lead', amount_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', close_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX deals_org_updated ON deals (org_id, updated_at);
CREATE INDEX deals_org_stage ON deals (org_id, stage);
CREATE TABLE activities (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, contact_id TEXT, deal_id TEXT, body TEXT,
  at INTEGER NOT NULL, actor_user_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX activities_org_updated ON activities (org_id, updated_at);
CREATE INDEX activities_org_at ON activities (org_id, at);

-- The change log: every write appends one row, and a client syncs by asking for what came after its last seq.
CREATE TABLE changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  op TEXT NOT NULL, actor_user_id TEXT, at INTEGER NOT NULL, data TEXT);
CREATE INDEX changes_org_seq ON changes (org_id, seq);
CREATE INDEX changes_org_entity ON changes (org_id, entity, entity_id);

-- Outgoing webhooks and the log of every try (src/webhooks.ts).
CREATE TABLE webhooks (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, secret TEXT NOT NULL,
  created_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX webhooks_org ON webhooks (org_id);
CREATE TABLE webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, org_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER, last_code INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries (webhook_id, created_at);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_at);

-- API keys (qk_…): only the hash is kept; the prefix is for telling them apart in a list.
CREATE TABLE api_keys (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER);
CREATE INDEX api_keys_org ON api_keys (org_id);

-- Who did what to the org itself (members, keys, webhooks, exports, seeds).
CREATE TABLE audit (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, target TEXT, at INTEGER NOT NULL, detail TEXT);
CREATE INDEX audit_org_at ON audit (org_id, at);
