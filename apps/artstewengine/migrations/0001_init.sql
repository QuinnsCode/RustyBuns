-- Better Auth's tables (the admin account and its sessions), then the licenses and a per-hour lease tally.
-- Times are ms since the epoch.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- One row per paid license. revoked_at set means bye bye; paid_until null means paid until revoked.
CREATE TABLE licenses (license TEXT PRIMARY KEY, who TEXT NOT NULL, created_at INTEGER NOT NULL, paid_until INTEGER, revoked_at INTEGER,
  last_lease_at INTEGER, leases INTEGER NOT NULL DEFAULT 0, last_host TEXT, last_version TEXT);

-- Lease answers counted per hour (ok = 1 given a key, 0 refused), so a flood of bad guesses is one row an hour, not a row each.
CREATE TABLE lease_hours (hour INTEGER NOT NULL, ok INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (hour, ok));
