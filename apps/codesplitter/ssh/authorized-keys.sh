#!/bin/sh
# sshd's AuthorizedKeysCommand (entry.sh), run as nobody for each key a client offers (#5504): asks whose key has
# fingerprint $2 (sshd's %f) and prints the one authorized_keys line it gets back, forced through `git-serve.sh <user>`.
# The container keeps no key list. 192.0.2.1 is a documentation address nothing routes to: the gate's Durable Object
# catches HTTP to it and hands it to the Worker's KeyLookup (worker.ts), which asks codeSplitter. A key nobody added
# gets a 404, so no line and no way in.
set -eu
[ "$1" = git ] || exit 1
fp=$(printf '%s' "$2" | sed -e 's/+/%2B/g' -e 's#/#%2F#g' -e 's/=/%3D/g')
exec curl -sf --max-time 10 "http://192.0.2.1/key?fingerprint=$fp"
