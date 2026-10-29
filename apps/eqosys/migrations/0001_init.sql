-- Better Auth's tables (its getMigrations for sqlite/D1, v1.7.7), as in qCRM's 0001_init.sql.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- One row a person: which app they first came in through ("eqosys" when they signed up here). Times are ms since the epoch.
CREATE TABLE members (user_id TEXT PRIMARY KEY, source TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX members_source ON members (source);

-- Every app a person has signed in to through here, first and last time.
CREATE TABLE links (user_id TEXT NOT NULL, app TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (user_id, app));
CREATE INDEX links_app ON links (app);

-- What a person may do in an app ("play", "member", "beta", "admin"…). The app reads the list and decides.
CREATE TABLE access (user_id TEXT NOT NULL, app TEXT NOT NULL, role TEXT NOT NULL, granted_at INTEGER NOT NULL, granted_by TEXT,
  PRIMARY KEY (user_id, app, role));

-- Handoff codes: one use, a minute long, only the hash is kept, bound to the app and its PKCE challenge.
CREATE TABLE codes (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, app TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL);
