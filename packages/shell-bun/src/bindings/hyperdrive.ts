// Hyperdrive off the edge. On Cloudflare the binding is a pooled route to the
// app's Postgres; on the desktop and box there is no pool to go through, so it
// is the origin's own URL in the binding's shape. `pg`, `postgres` and Drizzle
// read connectionString (or host/port/user/password/database) and never notice.

/** The fields of Cloudflare's Hyperdrive binding that a Postgres client reads. */
export interface LocalHyperdrive {
  readonly connectionString: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/**
 * `url` is postgres://user:password@host:port/database. Unset or empty, the
 * binding is left out (undefined) and the host says so once, so an app that
 * only touches Postgres on some routes still starts.
 */
export function hyperdrive(url: string | undefined, name = "HYPERDRIVE"): LocalHyperdrive | undefined {
  if (!url) {
    console.warn(`[${name}] no Postgres URL set, so the Hyperdrive binding is left out; set it to postgres://user:password@host:port/database`);
    return undefined;
  }
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`${name}: not a URL; Hyperdrive needs postgres://user:password@host:port/database`); }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:")
    throw new Error(`${name}: ${u.protocol}// isn't Postgres; Hyperdrive needs postgres://user:password@host:port/database`);
  return {
    connectionString: url,
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
  };
}
