// Who may do what in an org. One table, read by every route; nothing else decides.
//
//   seasonal   reads everything, logs calls, emails, meetings and notes (activities)
//   employee   + makes and edits contacts, companies and deals
//   manager    + soft-deletes rows, reads the audit log, manages members below manager
//   owner      + webhooks, API keys, export, seeding; sets managers
//   admin      + deletes the org; sets owners and admins
//   super_admin  the account named by SUPER_ADMIN_EMAIL: admin in every org, never stored as a member
//
// Someone added to an org without a role is seasonal.

export const ROLES = ["seasonal", "employee", "manager", "owner", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];
export const DEFAULT_ROLE: Role = "seasonal";
/** Roles a member can be given; super_admin comes from the environment, not a row. */
export const GRANTABLE = ROLES.slice(0, -1) as Role[];

export const ACTIONS = {
  read: "seasonal",
  "create:activity": "seasonal",
  "create:contact": "employee",
  "create:company": "employee",
  "create:deal": "employee",
  update: "employee",
  delete: "manager",
  members: "manager",
  audit: "manager",
  webhooks: "owner",
  keys: "owner",
  export: "owner",
  seed: "owner",
  "org:delete": "admin",
  "orgs:all": "super_admin",
} as const satisfies Record<string, Role>;
export type Action = keyof typeof ACTIONS;

export const rank = (role: Role) => ROLES.indexOf(role);
export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

/** Whether `role` may do `action`. */
export const can = (role: Role | null, action: Action) => role !== null && rank(role) >= rank(ACTIONS[action]);

/**
 * Whether `actor` may give, change or take away `target` (a role someone has or would get):
 * managers handle roles below manager, owners handle managers too, admins handle owners and admins.
 */
export function canSetRole(actor: Role, target: Role): boolean {
  if (target === "super_admin") return false;
  const need: Role = rank(target) < rank("manager") ? "manager" : target === "manager" ? "owner" : "admin";
  return rank(actor) >= rank(need);
}
