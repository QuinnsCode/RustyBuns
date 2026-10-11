-- When each row was made and last changed (#747), for telling what got overwritten when.
-- ALTER TABLE ADD COLUMN can't default to now, so triggers fill them: created_at
-- after an INSERT that left it NULL, updated_at after an UPDATE that changed a setting
-- (not the bookkeeping columns, like a mirror's next sync). INSERT OR REPLACE is a
-- new row, so it starts again. Times are ms, like Date.now(). Rows already here stay NULL.

-- Made, never changed in place (caches included).
ALTER TABLE files ADD COLUMN created_at INTEGER;
CREATE TRIGGER files_created AFTER INSERT ON files WHEN NEW.created_at IS NULL BEGIN
  UPDATE files SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE branch_files ADD COLUMN created_at INTEGER;
CREATE TRIGGER branch_files_created AFTER INSERT ON branch_files WHEN NEW.created_at IS NULL BEGIN
  UPDATE branch_files SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE tracks ADD COLUMN created_at INTEGER;
CREATE TRIGGER tracks_created AFTER INSERT ON tracks WHEN NEW.created_at IS NULL BEGIN
  UPDATE tracks SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE handle_grants ADD COLUMN created_at INTEGER;
CREATE TRIGGER handle_grants_created AFTER INSERT ON handle_grants WHEN NEW.created_at IS NULL BEGIN
  UPDATE handle_grants SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE check_watches ADD COLUMN created_at INTEGER;
CREATE TRIGGER check_watches_created AFTER INSERT ON check_watches WHEN NEW.created_at IS NULL BEGIN
  UPDATE check_watches SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE limit_hits ADD COLUMN created_at INTEGER;
CREATE TRIGGER limit_hits_created AFTER INSERT ON limit_hits WHEN NEW.created_at IS NULL BEGIN
  UPDATE limit_hits SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE levels ADD COLUMN created_at INTEGER;
CREATE TRIGGER levels_created AFTER INSERT ON levels WHEN NEW.created_at IS NULL BEGIN
  UPDATE levels SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE level_parts ADD COLUMN created_at INTEGER;
CREATE TRIGGER level_parts_created AFTER INSERT ON level_parts WHEN NEW.created_at IS NULL BEGIN
  UPDATE level_parts SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE git_pending ADD COLUMN created_at INTEGER;
CREATE TRIGGER git_pending_created AFTER INSERT ON git_pending WHEN NEW.created_at IS NULL BEGIN
  UPDATE git_pending SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE fresh_objects ADD COLUMN created_at INTEGER;
CREATE TRIGGER fresh_objects_created AFTER INSERT ON fresh_objects WHEN NEW.created_at IS NULL BEGIN
  UPDATE fresh_objects SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE watch_state ADD COLUMN created_at INTEGER;
CREATE TRIGGER watch_state_created AFTER INSERT ON watch_state WHEN NEW.created_at IS NULL BEGIN
  UPDATE watch_state SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE blob_lines ADD COLUMN created_at INTEGER;
CREATE TRIGGER blob_lines_created AFTER INSERT ON blob_lines WHEN NEW.created_at IS NULL BEGIN
  UPDATE blob_lines SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE fit_cache ADD COLUMN created_at INTEGER;
CREATE TRIGGER fit_cache_created AFTER INSERT ON fit_cache WHEN NEW.created_at IS NULL BEGIN
  UPDATE fit_cache SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE tree_cache ADD COLUMN created_at INTEGER;
CREATE TRIGGER tree_cache_created AFTER INSERT ON tree_cache WHEN NEW.created_at IS NULL BEGIN
  UPDATE tree_cache SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE walls_cache ADD COLUMN created_at INTEGER;
CREATE TRIGGER walls_cache_created AFTER INSERT ON walls_cache WHEN NEW.created_at IS NULL BEGIN
  UPDATE walls_cache SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;

-- Made, and edited in place.
ALTER TABLE collaborators ADD COLUMN created_at INTEGER;
ALTER TABLE collaborators ADD COLUMN updated_at INTEGER;
CREATE TRIGGER collaborators_created AFTER INSERT ON collaborators WHEN NEW.created_at IS NULL BEGIN
  UPDATE collaborators SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER collaborators_updated AFTER UPDATE ON collaborators WHEN NEW.updated_at IS OLD.updated_at AND (NEW.owner IS NOT OLD.owner OR NEW.repo IS NOT OLD.repo OR NEW.name IS NOT OLD.name) BEGIN
  UPDATE collaborators SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE playlists ADD COLUMN created_at INTEGER;
ALTER TABLE playlists ADD COLUMN updated_at INTEGER;
CREATE TRIGGER playlists_created AFTER INSERT ON playlists WHEN NEW.created_at IS NULL BEGIN
  UPDATE playlists SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER playlists_updated AFTER UPDATE ON playlists WHEN NEW.updated_at IS OLD.updated_at AND (NEW.owner IS NOT OLD.owner OR NEW.title IS NOT OLD.title) BEGIN
  UPDATE playlists SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE deploy_settings ADD COLUMN created_at INTEGER;
ALTER TABLE deploy_settings ADD COLUMN updated_at INTEGER;
CREATE TRIGGER deploy_settings_created AFTER INSERT ON deploy_settings WHEN NEW.created_at IS NULL BEGIN
  UPDATE deploy_settings SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER deploy_settings_updated AFTER UPDATE ON deploy_settings WHEN NEW.updated_at IS OLD.updated_at AND (NEW.stage IS NOT OLD.stage OR NEW.on_commit IS NOT OLD.on_commit OR NEW.production IS NOT OLD.production OR NEW.dir IS NOT OLD.dir) BEGIN
  UPDATE deploy_settings SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE check_settings ADD COLUMN created_at INTEGER;
ALTER TABLE check_settings ADD COLUMN updated_at INTEGER;
CREATE TRIGGER check_settings_created AFTER INSERT ON check_settings WHEN NEW.created_at IS NULL BEGIN
  UPDATE check_settings SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER check_settings_updated AFTER UPDATE ON check_settings WHEN NEW.updated_at IS OLD.updated_at AND (NEW.run_where IS NOT OLD.run_where OR NEW.required IS NOT OLD.required OR NEW.post_statuses IS NOT OLD.post_statuses) BEGIN
  UPDATE check_settings SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE limit_rules ADD COLUMN created_at INTEGER;
ALTER TABLE limit_rules ADD COLUMN updated_at INTEGER;
CREATE TRIGGER limit_rules_created AFTER INSERT ON limit_rules WHEN NEW.created_at IS NULL BEGIN
  UPDATE limit_rules SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER limit_rules_updated AFTER UPDATE ON limit_rules WHEN NEW.updated_at IS OLD.updated_at AND (NEW.max IS NOT OLD.max OR NEW.window_s IS NOT OLD.window_s OR NEW.enabled IS NOT OLD.enabled OR NEW.on_fail IS NOT OLD.on_fail) BEGIN
  UPDATE limit_rules SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE dep_watches ADD COLUMN created_at INTEGER;
ALTER TABLE dep_watches ADD COLUMN updated_at INTEGER;
CREATE TRIGGER dep_watches_created AFTER INSERT ON dep_watches WHEN NEW.created_at IS NULL BEGIN
  UPDATE dep_watches SET created_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER dep_watches_updated AFTER UPDATE ON dep_watches WHEN NEW.updated_at IS OLD.updated_at AND (NEW.enabled IS NOT OLD.enabled OR NEW.every_hours IS NOT OLD.every_hours OR NEW.max_level IS NOT OLD.max_level OR NEW.min_age_days IS NOT OLD.min_age_days OR NEW.ignore IS NOT OLD.ignore OR NEW.run_tests IS NOT OLD.run_tests OR NEW.fix_with IS NOT OLD.fix_with OR NEW.fix_tries IS NOT OLD.fix_tries) BEGIN
  UPDATE dep_watches SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;

-- Already have created_at (set by the code at every INSERT).
ALTER TABLE users ADD COLUMN updated_at INTEGER;
CREATE TRIGGER users_updated AFTER UPDATE ON users WHEN NEW.updated_at IS OLD.updated_at AND (NEW.bio IS NOT OLD.bio OR NEW.theme_html IS NOT OLD.theme_html OR NEW.pulse IS NOT OLD.pulse OR NEW.city_public IS NOT OLD.city_public OR NEW.git_truth IS NOT OLD.git_truth OR NEW.github_account IS NOT OLD.github_account OR NEW.agent_github IS NOT OLD.agent_github) BEGIN
  UPDATE users SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE repos ADD COLUMN updated_at INTEGER;
CREATE TRIGGER repos_updated AFTER UPDATE ON repos WHEN NEW.updated_at IS OLD.updated_at AND (NEW.visibility IS NOT OLD.visibility OR NEW.expires_at IS NOT OLD.expires_at OR NEW.mirror_url IS NOT OLD.mirror_url OR NEW.mirror_primary IS NOT OLD.mirror_primary OR NEW.mirror_push_crew IS NOT OLD.mirror_push_crew) BEGIN
  UPDATE repos SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
ALTER TABLE webhooks ADD COLUMN updated_at INTEGER;
CREATE TRIGGER webhooks_updated AFTER UPDATE ON webhooks WHEN NEW.updated_at IS OLD.updated_at AND (NEW.url IS NOT OLD.url OR NEW.secret IS NOT OLD.secret OR NEW.events IS NOT OLD.events OR NEW.github_compat IS NOT OLD.github_compat) BEGIN
  UPDATE webhooks SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE rowid = NEW.rowid;
END;
