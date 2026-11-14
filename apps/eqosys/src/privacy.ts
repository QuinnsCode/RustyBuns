// GDPR for eqosys, on @rustybuns/util/privacy. Three things:
//   - a vault a person (vault.ts): the key their cloud saves are sealed with, a consent ledger and a log of what they asked for,
//     in the EU's jurisdiction for someone who first signed in from Europe;
//   - HOLDERS: every part of eqosys that keeps personal data, what it keeps, why and how long. The privacy page lists them and
//     GET /api/privacy/export hands a person all of it as one JSON file;
//   - erasure: deleting the account shreds the vault, which makes every sealed save unreadable, D1's 30 days of history included.
import { base64, dossier, type Holder } from "@rustybuns/util/privacy";
import { HOME } from "./apps.ts";
import type { Env } from "./env.ts";
import { hubAsk } from "./qollab/hub.ts";
import { get as getSave } from "./qollab/saves.ts";
import { SPACES_OF, spaceOf } from "./qollab/space.ts";
import { vaultFor } from "./vault.ts";

export interface Subject { conf: Env; me: { id: string; name: string } }
const rows = async <T>(conf: Env, sql: string, ...bind: unknown[]) => (await conf.DB.prepare(sql).bind(...bind).all<T>()).results;
const UNTIL = "until you delete your account";

/** Everything eqosys keeps about a person. Add a table or a Durable Object that holds personal data, add it here: the page and the download follow. */
export const HOLDERS: Holder<Subject>[] = [
  {
    id: "account", what: "Your email, the name you chose, and how you sign in (a scrambled password, or a link to Apple, GitHub or Google)",
    why: "So you can sign in, and every Q app knows it is you", basis: "contract", keep: UNTIL,
    export: async ({ conf, me }) => ({
      user: await conf.DB.prepare(`SELECT id, name, email, "emailVerified" AS email_verified, "createdAt" AS created_at FROM "user" WHERE id = ?`).bind(me.id).first(),
      // Never the password's hash or a provider's tokens: what each sign-in is, not the keys to it.
      sign_ins: await rows(conf, `SELECT "providerId" AS provider, "accountId" AS provider_id, "createdAt" AS created_at FROM "account" WHERE "userId" = ?`, me.id),
    }),
  },
  {
    id: "apps", what: "Which Q apps you use, when you first and last opened each, the one you came in through, and what each lets you do",
    why: "To sign you in to them and show them on your home page", basis: "contract", keep: UNTIL,
    export: async ({ conf, me }) => ({
      member: await conf.DB.prepare("SELECT source, region, created_at FROM members WHERE user_id = ?").bind(me.id).first(),
      apps: await rows(conf, "SELECT app, first_at, last_at FROM links WHERE user_id = ?", me.id),
      access: await rows(conf, "SELECT app, role, granted_at, granted_by FROM access WHERE user_id = ?", me.id),
    }),
  },
  {
    id: "sessions", what: "Sign-in sessions, with the device's IP address and browser name",
    why: "To keep you signed in, and so a stolen sign-in can be spotted", basis: "legitimate interest", keep: "until you sign out or it runs out (7 days unused)",
    export: ({ conf, me }) => rows(conf, `SELECT "createdAt" AS created_at, "expiresAt" AS expires_at, "ipAddress" AS ip, "userAgent" AS browser FROM "session" WHERE "userId" = ?`, me.id),
  },
  {
    id: "friends", what: "Your friends, requests and notifications, and which app a friend is in right now",
    why: "So friends can find and join each other", basis: "contract", keep: UNTIL,
    export: async ({ conf, me }) => conf.HUB ? hubAsk(conf.HUB, { id: me.id, name: me.name, app: HOME }, { op: "state" }) : null,
  },
  {
    id: "saves", what: "Game saves you chose to keep in the cloud, sealed with a key only your vault holds",
    why: "So a game carries on where you left it, on any device", basis: "contract", keep: "the last 5 of each slot, until you delete your account",
    export: async ({ conf, me }) => {
      const kept = await rows<{ id: number; app: string; slot: string; at: number; size: number }>(conf, "SELECT id, app, slot, at, size FROM saves WHERE user_id = ? ORDER BY id", me.id);
      return Promise.all(kept.map(async (s) => ({ ...s, base64: (await getSave(conf, me.id, s.app, s.slot, s.id).then((f) => f && base64(f.data))) ?? null })));
    },
  },
  {
    id: "achievements", what: "Achievements you unlocked in each game, and when", why: "To show them to you and your friends", basis: "contract", keep: UNTIL,
    export: ({ conf, me }) => rows(conf, "SELECT app, achievement, at FROM unlocks WHERE user_id = ?", me.id),
  },
  {
    id: "reports", what: "Which game you sent a report from, when, and the GitHub issue it became (the issue itself names you only by an id); for a game from another studio, what you wrote, which its studio reads under the same id",
    why: "To hold reports to a few a day, and to answer you", basis: "legitimate interest", keep: "a year",
    export: ({ conf, me }) => rows(conf, "SELECT app, at, issue, kind, title, body FROM reports WHERE user_id = ?", me.id),
  },
  {
    id: "spaces", what: "Spaces you made or joined (your studios' spaces too), and the messages you sent in them", why: "So your groups and their channels last", basis: "contract",
    keep: "the last 10,000 messages of a channel; a space you own until you delete it or your account",
    export: async ({ conf, me }) => {
      const mine = await rows<{ id: string; name: string; owner: string; at: number }>(conf,
        `SELECT s.id, s.name, s.owner, COALESCE(m.at, sm.at) AS at FROM spaces s LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = ?1
         LEFT JOIN studio_members sm ON sm.studio_id = s.studio_id AND sm.user_id = ?1 WHERE s.id IN (${SPACES_OF})`, me.id);
      return Promise.all(mine.map(async (s) => ({
        id: s.id, name: s.name, owner: s.owner === me.id, joined_at: s.at,
        messages: conf.SPACE ? await spaceOf(conf.SPACE, s.id).fetch(new Request(`https://space/mine?${new URLSearchParams({ id: me.id })}`)).then((r) => r.json(), () => null) : null,
      })));
    },
  },
  {
    id: "studios", what: "The studios you made or were added to, and your role in each", why: "So the people you make apps with can work on them together", basis: "contract", keep: UNTIL,
    export: ({ conf, me }) => rows(conf, "SELECT s.id, s.name, s.kind, m.role, m.at FROM studio_members m JOIN studios s ON s.id = m.studio_id WHERE m.user_id = ?", me.id),
  },
  {
    id: "parties", what: "The party rooms you sat in", why: "So deleting your account can tell each one to forget you", basis: "contract", keep: "24 hours",
    export: ({ conf, me }) => rows(conf, "SELECT code, at FROM party_seats WHERE user_id = ?", me.id),
  },
  {
    id: "privacy", what: "Where your vault is, the consents you gave or took back, and when you downloaded your data",
    why: "To show what you agreed to and that each request was answered", basis: "legal obligation", keep: UNTIL,
    export: async ({ conf, me }) => (await vaultFor(conf, me.id))?.state() ?? null,
  },
];

/** The download: every holder's part, logged in the person's vault as a request answered. */
export async function exportFor(subject: Subject, now = Date.now()) {
  await (await vaultFor(subject.conf, subject.me.id))?.asked("export", now);
  return dossier("eqosys", HOLDERS, subject, now);
}
