# Container start: let in the one key the Durable Object passed as AUTHORIZED_KEY (its first line only, so it can't
# add a second, unforced line), then run sshd in the foreground.
set -eu
key=$(printf '%s' "$AUTHORIZED_KEY" | head -n 1)
printf 'command="/git-serve.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty %s\n' "$key" \
  > /home/git/.ssh/authorized_keys
chown git:git /home/git/.ssh/authorized_keys
chmod 600 /home/git/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e -p 2222 -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o PermitRootLogin=no
