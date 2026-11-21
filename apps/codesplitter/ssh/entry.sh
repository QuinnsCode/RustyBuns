# Container start: run sshd in the foreground with no authorized_keys file. Each key a client offers is looked up in
# codeSplitter by authorized-keys.sh, which answers the one line that lets it in as its owner (#5504).
# The repo lookup's URL and secret go to /etc/gate.env for git-serve.sh, since sshd hands a login none of this env.
set -eu
printf 'LOOKUP_URL=%s\nGATE_SECRET=%s\n' "$(printf '%s' "$LOOKUP_URL" | head -n 1)" "$(printf '%s' "$GATE_SECRET" | head -n 1)" > /etc/gate.env
chown root:git /etc/gate.env
chmod 640 /etc/gate.env
exec /usr/sbin/sshd -D -e -p 2222 -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o PermitRootLogin=no \
  -o AuthorizedKeysFile=none -o 'AuthorizedKeysCommand=/authorized-keys.sh %u %f' -o AuthorizedKeysCommandUser=nobody
