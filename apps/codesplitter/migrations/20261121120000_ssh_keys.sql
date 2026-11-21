-- SSH public keys for git over ssh:// (src/ssh-keys.ts, #5504). A key is one person's: the fingerprint (sshd's %f,
-- SHA256:base64) is how the ssh gate's lookup finds whose it is. `key` is `type base64`, the comment dropped.
CREATE TABLE ssh_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL
);
CREATE INDEX ssh_keys_user ON ssh_keys (user);
