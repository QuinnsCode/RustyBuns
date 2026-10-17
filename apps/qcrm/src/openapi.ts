// GET /api/openapi.json: the API as OpenAPI 3.1, for agents outside the browser (Claude Code
// through /api/mcp, or any gateway that turns a spec into tools). Written by hand next to the
// routes: a route that changes shape changes here too (test/mcp.test.ts walks every operation).
// Operations that change who can get in or see what, can't be undone, or hand out the whole org
// carry `x-qcrm-risky: true`, so a client asks a person before calling them. That is advice;
// the server's own checks are what hold.
//
// It imports nothing, so a docs page can load it from any version.

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (description?: string): Schema => ({ type: "string", ...(description && { description }) });
const int = (description?: string): Schema => ({ type: "integer", ...(description && { description }) });
const bool = (description?: string): Schema => ({ type: "boolean", ...(description && { description }) });
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], description?: string): Schema =>
  ({ type: "object", properties, ...(required.length && { required }), ...(description && { description }) });
const loose = (description: string): Schema => ({ type: "object", additionalProperties: true, description });
const en = (values: readonly string[], description?: string): Schema => ({ type: "string", enum: [...values], ...(description && { description }) });

interface Op {
  id: string; summary: string; tag: string; description?: string;
  query?: Record<string, Schema & { required?: boolean }>;
  body?: Schema; ok?: Schema; status?: number;
  /** Needs no sign-in. */
  open?: true;
  /** Changes who can get in or see what, can't be undone, or hands out the whole org. */
  risky?: true;
  /** The least role that may call it, for the docs. */
  role?: string;
}

const ROLE = en(["seasonal", "employee", "manager", "owner", "admin"]);
const STAGE = en(["lead", "qualified", "proposal", "won", "lost"]);
const ACTIVITY = en(["call", "email", "meeting", "note"]);
const org = "/orgs/{org}";
const page = { q: str("search: a case-insensitive prefix of the name or email"), cursor: str("`next` from the page before"), limit: int("1 to 200, default 50") };

/** One entity's five operations. `fields` is what a client sends; the row adds id, org_id and the timestamps. */
function crud(entity: string, one: string, fields: Schema, filters: Record<string, Schema>, required: string[] = []): Record<string, Record<string, Op>> {
  const Row = one[0]!.toUpperCase() + one.slice(1);
  return {
    [`${org}/${entity}`]: {
      get: { id: `list_${entity}`, summary: `List ${entity}, newest change first`, tag: Row, role: "seasonal", query: { ...page, ...filters }, ok: obj({ items: arr(ref(Row)), total: { type: "integer", description: "rows matching the search and filters, across all pages" }, next: { type: ["string", "null"], description: "cursor for the next page" } }) },
      post: { id: `create_${one}`, summary: `Add a ${one}`, tag: Row, role: one === "activity" ? "seasonal" : "employee", body: obj((fields as { properties: Record<string, Schema> }).properties, required), ok: ref(Row), status: 201 },
    },
    ...(entity === "contacts" || entity === "companies" ? { [`${org}/${entity}/import`]: {
      post: { id: `import_${entity}`, summary: `Import ${entity} from a CSV, skipping ones already there`, tag: Row, role: "employee", status: 201,
        description: "Send text/csv, a multipart file field, or this JSON. Headers map by name; map renames the rest. Rows with an email (contacts) or domain (companies) already in the org or earlier in the file are counted as duplicates.",
        body: obj({ csv: str("the file's text, header row first, up to 5000 rows"), map: loose("header to field, e.g. {\"E-mail\": \"email\"}; \"\" skips a column") }, ["csv"]),
        ok: obj({ created: int(), duplicates: int(), failed: int(), errors: arr(obj({ row: int(), error: str() })) }) } } } : {}),
    [`${org}/${entity}/{id}`]: {
      get: { id: `get_${one}`, summary: `One ${one}`, tag: Row, role: "seasonal", ok: ref(Row) },
      put: { id: `update_${one}`, summary: `Change a ${one}: only the fields sent change`, tag: Row, role: "employee", body: fields, ok: ref(Row) },
      delete: { id: `delete_${one}`, summary: `Delete a ${one} (soft: it stays for sync, marked deleted)`, tag: Row, role: "manager", risky: true, ok: obj({ id: str(), deleted_at: int() }) },
    },
  };
}

const CONTACT = obj({ first_name: str(), last_name: str(), email: str(), phone: str(), title: str(), company_id: str(), owner_user_id: str(), tags: arr(str()), notes: str("up to 2000 characters") });
const COMPANY = obj({ name: str(), domain: str(), industry: str(), size: str("like 11-50") });
const DEAL = obj({ name: str(), contact_id: str(), company_id: str(), stage: STAGE, amount_cents: int("0 or more"), currency: str("ISO code, default USD"), close_at: int("ms since the epoch") });
const ACTIVITY_BODY = obj({ type: ACTIVITY, contact_id: str(), deal_id: str(), body: str("up to 2000 characters"), at: int("ms; default now") });

/** Every operation, by path and method. Path parameters are in {braces}. */
const OPS: Record<string, Record<string, Op>> = {
  "/me": {
    get: { id: "get_me", summary: "Who you are, your orgs and your role in each", tag: "Account", ok: obj({ user: obj({ id: str(), email: str(), name: str() }), orgs: arr(obj({ id: str(), name: str(), role: ROLE })), superAdmin: bool() }) },
    delete: { id: "delete_me", summary: "Delete your account, the orgs you own and every row of them", tag: "Account", risky: true, query: { confirm: { ...str("your email, to be sure"), required: true } }, ok: obj({ ok: bool(), orgs_deleted: int() }) },
  },
  "/demo": { post: { id: "make_demo", summary: "A throwaway account signed in on the spot, owning Demo Co with 2,000 seeded contacts; gone after a day", tag: "Account", open: true, status: 201, ok: obj({ org: ref("Org"), user: obj({ id: str(), email: str(), name: str() }) }) } },
  "/orgs": {
    get: { id: "list_orgs", summary: "Your orgs with your role in each", tag: "Org", ok: arr(obj({ id: str(), name: str(), plan: str(), role: ROLE })) },
    post: { id: "create_org", summary: "A new org you own", tag: "Org", body: obj({ name: str() }, ["name"]), ok: ref("Org"), status: 201 },
  },
  [org]: {
    get: { id: "get_org", summary: "The org and your role in it", tag: "Org", role: "seasonal", ok: ref("Org") },
    delete: { id: "delete_org", summary: "Delete the org and every row of it", tag: "Org", role: "admin", risky: true, ok: ref("Ok") },
  },
  [`${org}/members`]: {
    get: { id: "list_members", summary: "Who is in the org, with roles", tag: "Members", role: "seasonal", ok: arr(ref("Member")) },
    post: { id: "add_member", summary: "Add someone with an account to the org (seasonal unless a role is given)", tag: "Members", role: "manager", risky: true,
      description: "Managers grant seasonal and employee, owners also manager, admins also owner and admin.", body: obj({ email: str(), role: ROLE }, ["email"]), ok: ref("Member"), status: 201 },
  },
  [`${org}/members/{user_id}`]: {
    put: { id: "set_member_role", summary: "Change a member's role", tag: "Members", role: "manager", risky: true, body: obj({ role: ROLE }, ["role"]), ok: obj({ user_id: str(), role: ROLE }) },
    delete: { id: "remove_member", summary: "Take someone out of the org", tag: "Members", role: "manager", risky: true, ok: ref("Ok") },
  },
  ...crud("contacts", "contact", CONTACT, { company_id: str(), owner_user_id: str() }),
  ...crud("companies", "company", COMPANY, { industry: str() }, ["name"]),
  ...crud("deals", "deal", DEAL, { company_id: str(), contact_id: str(), stage: STAGE }, ["name"]),
  ...crud("activities", "activity", ACTIVITY_BODY, { contact_id: str(), deal_id: str(), type: ACTIVITY }, ["type"]),
  [`${org}/sync`]: {
    get: { id: "pull_changes", summary: "The change log after a seq: what to apply locally", tag: "Sync", role: "seasonal", query: { since: int("the last seq you applied; 0 for everything"), limit: int("1 to 1000, default 200") },
      ok: obj({ changes: arr(ref("Change")), next: int("pass as since next time"), done: bool("false: more follows") }) },
    post: { id: "push_changes", summary: "Apply local edits; last write wins on updated_at", tag: "Sync", role: "seasonal",
      description: "An op whose row changed on the server after baseSeq is a conflict: the server's copy comes back, and the op still lands when its updated_at is newer.",
      body: obj({ ops: arr(obj({ entity: en(["contacts", "companies", "deals", "activities"]), id: str("the client's id for the row (uuid)"), op: en(["upsert", "delete"]), data: loose("the row's fields, with updated_at"), baseSeq: int("the seq the edit was based on") }, ["entity", "id", "op"])) }, ["ops"]),
      ok: obj({ applied: int(), conflicts: arr(obj({ id: str(), server: loose("the server's row") })), rejected: arr(obj({ id: str(), error: str() })) }) },
  },
  [`${org}/webhooks`]: {
    get: { id: "list_webhooks", summary: "The org's webhooks", tag: "Webhooks", role: "owner", risky: true, ok: obj({ events: arr(str()), webhooks: arr(ref("Webhook")) }) },
    post: { id: "create_webhook", summary: "Add a webhook: the secret is shown this once", tag: "Webhooks", role: "owner", risky: true, body: obj({ url: str("https"), events: arr(str("default: all")) }, ["url"]), ok: ref("Webhook"), status: 201 },
  },
  [`${org}/webhooks/{id}`]: {
    put: { id: "update_webhook", summary: "Change a webhook's URL, events or pause it", tag: "Webhooks", role: "owner", risky: true, body: obj({ url: str(), events: arr(str()), disabled: bool() }), ok: ref("Webhook") },
    delete: { id: "delete_webhook", summary: "Remove a webhook and its deliveries", tag: "Webhooks", role: "owner", risky: true, ok: ref("Ok") },
  },
  [`${org}/webhooks/{id}/deliveries`]: { get: { id: "list_deliveries", summary: "A webhook's last 50 deliveries", tag: "Webhooks", role: "owner", risky: true, ok: arr(ref("Delivery")) } },
  [`${org}/keys`]: {
    get: { id: "list_keys", summary: "The org's API keys, by prefix", tag: "Keys", role: "owner", risky: true, ok: arr(ref("Key")) },
    post: { id: "create_key", summary: "A new API key (qk_…): the secret is shown this once", tag: "Keys", role: "owner", risky: true, description: "From a signed-in browser only; a key can't make keys.", body: obj({ name: str() }, ["name"]), ok: ref("Key"), status: 201 },
  },
  [`${org}/keys/{id}`]: { delete: { id: "revoke_key", summary: "Revoke an API key", tag: "Keys", role: "owner", risky: true, ok: ref("Ok") } },
  [`${org}/seed`]: { post: { id: "seed_org", summary: "Fill the org with realistic fake data: n contacts and their companies, deals and activities", tag: "Org", role: "owner", body: obj({ n: int("1 to 100000"), seed: int("same seed, same data") }, ["n"]), ok: obj({ contacts: int(), companies: int(), deals: int(), activities: int() }), status: 201 } },
  [`${org}/insights`]: { get: { id: "get_insights", summary: "Counts, deals per stage, win rate over 90 days, activities per week, top companies by open pipeline", tag: "Org", role: "seasonal", ok: loose("{counts, deals_by_stage, last_90_days, activities_per_week, top_companies_by_open_pipeline}") } },
  [`${org}/export`]: { get: { id: "export_org", summary: "Every row of the org as one JSON", tag: "Org", role: "owner", risky: true, ok: loose("{org, contacts, companies, deals, activities, memberships, webhooks, audit}") } },
  [`${org}/audit`]: { get: { id: "list_audit", summary: "Who did what to the org itself (members, keys, webhooks, exports, seeds)", tag: "Org", role: "manager", query: { limit: int("1 to 500, default 100") }, ok: arr(ref("AuditEntry")) } },
  [`${org}/scripts`]: {
    get: { id: "list_scripts", summary: "The org's scripts", tag: "Scripts", role: "seasonal", ok: arr(ref("Script")) },
    post: { id: "create_script", summary: "Keep a script: JavaScript, the inside of `async ({ input, qcrm, log }) => { … }`", tag: "Scripts", role: "manager",
      description: "qcrm.list(entity, params), get(entity, id), create(entity, data), update(entity, id, data), remove(entity, id) and insights() each make one API call as whoever runs it; log(...) adds a line; what the body returns is the run's result. A run has no network, 200 calls and 10 s.",
      body: obj({ name: str(), body: str("up to 64 KB") }, ["name", "body"]), ok: ref("Script"), status: 201 },
  },
  [`${org}/scripts/examples`]: { post: { id: "install_example_scripts", summary: "Install the three example scripts", tag: "Scripts", role: "manager", ok: arr(ref("Script")), status: 201 } },
  [`${org}/scripts/{id}`]: {
    get: { id: "get_script", summary: "One script with its body", tag: "Scripts", role: "seasonal", ok: ref("Script") },
    put: { id: "update_script", summary: "Change a script's name, body or switch it off", tag: "Scripts", role: "manager", body: obj({ name: str(), body: str(), enabled: bool() }), ok: ref("Script") },
    delete: { id: "delete_script", summary: "Delete a script", tag: "Scripts", role: "owner", risky: true, ok: ref("Ok") },
  },
  [`${org}/scripts/{id}/run`]: { post: { id: "run_script", summary: "Run a script now, as you, and get the run row back (status, log, result, calls)", tag: "Scripts", role: "employee", body: obj({ input: loose("anything JSON, handed to the script as `input`") }), ok: ref("ScriptRun"), status: 201 } },
  [`${org}/scripts/{id}/runs`]: { get: { id: "list_script_runs", summary: "A script's last 50 runs", tag: "Scripts", role: "seasonal", ok: arr(ref("ScriptRun")) } },
  "/admin/orgs": { get: { id: "admin_list_orgs", summary: "Every org (super admin)", tag: "Admin", role: "super_admin", ok: arr(ref("Org")) } },
  "/admin/orgs/{org}/members": { post: { id: "admin_add_member", summary: "Put an account into any org with any role (super admin)", tag: "Admin", role: "super_admin", risky: true, body: obj({ email: str(), role: ROLE }, ["email"]), ok: ref("Member"), status: 201 } },
};

const stamps = { id: str(), org_id: str(), created_at: int("ms"), updated_at: int("ms"), deleted_at: { type: ["integer", "null"] } };
const SCHEMAS: Record<string, Schema> = {
  Ok: obj({ ok: bool() }),
  Error: obj({ error: str() }, ["error"]),
  Org: obj({ id: str("org_…: carries nothing about its owner"), name: str(), owner_user_id: str(), created_at: int(), plan: str("free or demo"), role: ROLE }),
  Member: obj({ user_id: str(), name: str(), role: ROLE, created_at: int() }),
  Contact: obj({ ...stamps, ...(CONTACT.properties as Record<string, Schema>) }),
  Company: obj({ ...stamps, ...(COMPANY.properties as Record<string, Schema>) }),
  Deal: obj({ ...stamps, ...(DEAL.properties as Record<string, Schema>) }),
  Activity: obj({ ...stamps, ...(ACTIVITY_BODY.properties as Record<string, Schema>), actor_user_id: str() }),
  Change: obj({ seq: int(), entity: str(), id: str(), op: en(["upsert", "delete", "seed"]), actor_user_id: { type: ["string", "null"] }, at: int(), data: loose("the row after the write; for a delete {id, deleted_at}; for a seed the counts") }),
  Webhook: obj({ id: str(), url: str(), events: arr(str()), secret: str("when made only"), created_at: int(), disabled: bool() }),
  Delivery: obj({ id: str(), event: str(), status: en(["pending", "ok", "dead"]), attempts: int(), next_at: { type: ["integer", "null"] }, last_code: { type: ["integer", "null"] }, created_at: int() }),
  Key: obj({ id: str(), name: str(), prefix: str("the first 8 characters"), secret: str("when made only"), user_id: str(), created_at: int(), last_used_at: { type: ["integer", "null"] } }),
  Script: obj({ id: str(), org_id: str(), name: str(), body: str("in the single-script read only"), lang: str("js"), created_by: str(), created_at: int(), updated_at: int(), enabled: bool() }),
  ScriptRun: obj({ id: str(), script_id: str(), actor_user_id: str(), started_at: int(), finished_at: int(), status: en(["ok", "error", "timeout"]), log: str("lines, 16 KB at most"), result: loose("what the script returned"), calls: int("API calls the run made") }),
  AuditEntry: obj({ id: str(), actor_user_id: { type: ["string", "null"] }, actor_name: { type: ["string", "null"] }, actor_email: { type: ["string", "null"] }, action: str(), target: { type: ["string", "null"] }, target_name: { type: ["string", "null"] }, target_type: str("member, key, webhook, export, seed…"), at: int(), detail: loose("what changed") }),
};

const params = (path: string, query: Op["query"] = {}) => [
  ...[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: "path", required: true, schema: str() })),
  ...Object.entries(query).map(([name, { required, ...schema }]) => ({ name, in: "query", ...(required && { required }), schema })),
];
const err = (description: string) => ({ description, content: { "application/json": { schema: ref("Error") } } });

/** The spec, with this origin as its server. */
export function openapi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, methods] of Object.entries(OPS)) {
    paths[path] = {};
    for (const [method, o] of Object.entries(methods)) {
      paths[path][method] = {
        operationId: o.id, summary: o.summary, tags: [o.tag], ...(o.description && { description: o.description }),
        parameters: params(path, o.query),
        ...(o.body && { requestBody: { required: true, content: { "application/json": { schema: o.body } } } }),
        security: o.open ? [{}] : [{ key: [] }, { cookie: [] }],
        ...(o.role && { "x-qcrm-role": o.role }),
        ...(o.risky && { "x-qcrm-risky": true }),
        responses: {
          [String(o.status ?? 200)]: { description: "OK", content: { "application/json": { schema: o.ok ?? ref("Ok") } } },
          400: err("bad input"), 401: err("signed out, or a bad key"), 403: err("your role can't do this"),
          404: err("not found, or an org you aren't in"), 409: err("it already exists"), 429: err("over a rate limit"), 503: err("accounts are off"),
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "qCRM", version: "1",
      description: "A small CRM for teams and the agents that work for them. Sign in on the site, or send an org API key (an owner makes one) as `Authorization: Bearer qk_…`: "
        + "it acts as the person who made it, inside that org. Roles: seasonal < employee < manager < owner < admin; each operation says the least role it takes (`x-qcrm-role`). "
        + "Everything under /orgs/{org} answers 404 to anyone who isn't a member, so an id never says whether it exists. "
        + "Sync: pull_changes from your last seq, push_changes with your edits. Operations marked `x-qcrm-risky` change who can get in or see what, can't be undone, or hand out the whole org: ask a person before calling them.",
    },
    servers: [{ url: `${origin}/api` }],
    components: {
      schemas: SCHEMAS,
      securitySchemes: {
        key: { type: "http", scheme: "bearer", description: "an org API key (qk_…)" },
        cookie: { type: "apiKey", in: "cookie", name: "better-auth.session_token", description: "the site's session; writes also need an Origin header of this site" },
      },
    },
    security: [{ key: [] }, { cookie: [] }],
    paths,
  };
}
