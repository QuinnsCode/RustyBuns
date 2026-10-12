import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";

// D1 tracks applied migrations by filename, so renaming one makes it run again. These
// pairs already share a number on the live database and stay as they are (#712).
const SHARED = new Set([
  "0025_crew_remote.sql",
  "0025_deploy_key_providers.sql",
  "0035_mirror_branches.sql",
  "0035_oauth.sql",
  "0037_agent_runs.sql",
  "0037_branch_deletes.sql",
  "0038_agent_stop.sql",
  "0038_check_runs.sql",
  "0040_follows.sql",
  "0040_stamps.sql",
  "0040_webhook_github_compat.sql",
  "0041_check_claims.sql",
  "0041_line_events.sql",
  "0052_deps_alerted.sql",
  "0052_repo_search_stale.sql",
  // #749 and #751 landed side by side; either may be live already, so neither is renamed.
  "0056_check_freshness.sql",
  "0056_join_dates_and_ghost.sql",
]);

// The last numbered migration. Two branches that each took the next number merged clean in git
// and clashed here (#935), so every migration after it is named for when it was written,
// YYYYMMDDHHMMSS_name.sql in UTC, which Alchemy (and the desktop's applyD1Migrations) sort
// after every numbered one. 0071 (#992) landed on main before this rule did and may be live,
// so it keeps its name.
const LAST_NUMBERED = "0071";

const files = readdirSync(`${import.meta.dir}/../migrations`).filter(f => f.endsWith(".sql"));
const numbered = files.filter(f => /^\d{4}_/.test(f));
const stamped = files.filter(f => /^\d{14}_/.test(f));

test("every migration is named NNNN_name.sql or YYYYMMDDHHMMSS_name.sql", () => {
  expect(files.filter(f => !/^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
});

test(`no new numbered migration after ${LAST_NUMBERED}: name it for when it was written`, () => {
  expect(numbered.filter(f => f.slice(0, 4) > LAST_NUMBERED)).toEqual([]);
});

test("a timestamped migration's stamp is a real time, not in the future", () => {
  const bad = stamped.filter(f => {
    const [, y, mo, d, h, mi, s] = f.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/)!.map(Number);
    const at = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
    return at.getUTCMonth() !== mo! - 1 || at.getUTCDate() !== d! || at.getUTCHours() !== h! || y! < 2026 || at.getTime() > Date.now() + 86_400_000;
  });
  expect(bad).toEqual([]);
});

test("no new migration shares its number or stamp with another", () => {
  const byNumber = new Map<string, string[]>();
  for (const f of files) {
    const key = f.slice(0, f.indexOf("_"));
    byNumber.set(key, [...(byNumber.get(key) ?? []), f]);
  }
  const clashes = [...byNumber.values()].filter(names => names.length > 1 && names.some(n => !SHARED.has(n)));
  expect(clashes).toEqual([]);
});
