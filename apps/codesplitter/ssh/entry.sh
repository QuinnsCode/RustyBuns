# Container start: let in the one key the Durable Object passed as AUTHORIZED_KEY (its first line only, so it can't
# add a second, unforced line) as AUTHORIZED_USER, then run sshd in the foreground. Key lookup per user is #5504.
# The lookup's URL and secret go to /etc/gate.env for git-serve.sh, since sshd hands a login none of this env.
set -eu
key=$(printf '%s' "$AUTHORIZED_KEY" | head -n 1)
user=$(printf '%s' "$AUTHORIZED_USER" | head -n 1)
printf '%s' "$user" | grep -Eq '^[A-Za-z0-9_-]+$' || { echo "AUTHORIZED_USER must be a plain name" >&2; exit 1; }
printf 'command="/git-serve.sh %s",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty %s\n' "$user" "$key" \
  > /home/git/.ssh/authorized_keys
chown git:git /home/git/.ssh/authorized_keys
chmod 600 /home/git/.ssh/authorized_keys
printf 'LOOKUP_URL=%s\nGATE_SECRET=%s\n' "$(printf '%s' "$LOOKUP_URL" | head -n 1)" "$(printf '%s' "$GATE_SECRET" | head -n 1)" > /etc/gate.env
chown root:git /etc/gate.env
chmod 640 /etc/gate.env
exec /usr/sbin/sshd -D -e -p 2222 -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o PermitRootLogin=no
