import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";

// D1 tracks applied migrations by filename, so renaming one makes it run again. These
// pairs already share a number on the live database and stay as they are (#712). Every
// new migration takes a number of its own, so the numbers give one order from here on.
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

const files = readdirSync(`${import.meta.dir}/../migrations`).filter(f => f.endsWith(".sql"));

test("every migration is named NNNN_name.sql", () => {
  expect(files.filter(f => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
});

test("no new migration shares its number with another", () => {
  const byNumber = new Map<string, string[]>();
  for (const f of files) byNumber.set(f.slice(0, 4), [...(byNumber.get(f.slice(0, 4)) ?? []), f]);
  const clashes = [...byNumber.values()].filter(names => names.length > 1 && names.some(n => !SHARED.has(n)));
  expect(clashes).toEqual([]);
});
