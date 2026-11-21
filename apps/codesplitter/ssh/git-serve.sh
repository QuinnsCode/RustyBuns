# The forced command for every ssh login (see entry.sh): `git-serve.sh <user>`. git asks for
# `git-upload-pack '/owner/repo.git'` (fetch, clone, ls-remote) or `git-receive-pack '...'` (push); anything else is
# refused. The path must be owner/repo with plain characters.
#
# The container keeps no repos (#5505). It asks codeSplitter's lookup for the repo's smart-HTTP remote (Artifacts) and
# a token for <user>, read for a fetch and write for a push, mirrors that remote into a scratch bare repo for this one
# connection, and serves git from there. A push goes on to the HTTP remote from the scratch repo's pre-receive hook,
# with the client's objects still in quarantine, so the client hears "ok" only once the HTTP push landed, and the
# HTTP side's refusals (a protected branch, a check) come back to it as `remote:` lines.
set -eu
user=${1:-}
cmd=${SSH_ORIGINAL_COMMAND:-}
verb=${cmd%% *}
arg=${cmd#* }
case "$verb" in git-upload-pack|git-receive-pack) ;; *) echo "codeSplitter ssh: only git fetch and push" >&2; exit 1 ;; esac
path=$(printf '%s' "$arg" | sed -e "s/^'//" -e "s/'\$//" -e 's#^/##' -e 's#\.git$##')
if ! printf '%s' "$path" | grep -Eq '^[A-Za-z0-9_-][A-Za-z0-9._-]*/[A-Za-z0-9_-][A-Za-z0-9._-]*$'; then
  echo "codeSplitter ssh: the path is owner/repo" >&2; exit 1
fi
[ -n "$user" ] || { echo "codeSplitter ssh: no user for this key" >&2; exit 1; }

# LOOKUP_URL and GATE_SECRET, written by entry.sh (sshd gives a login none of the container's env).
. /etc/gate.env
mode=read
[ "$verb" = git-receive-pack ] && mode=write
# The lookup answers two lines, the remote and its token, or an error status with the reason as its body.
reply=$(curl -sS --fail-with-body -H "authorization: Bearer $GATE_SECRET" --get \
  --data-urlencode "user=$user" --data-urlencode "repo=$path" --data-urlencode "mode=$mode" "$LOOKUP_URL" 2>/dev/null) \
  || { echo "codeSplitter ssh: $path: $(printf '%s' "${reply:-the lookup is down}" | tail -n 1)" >&2; exit 1; }
remote=$(printf '%s\n' "$reply" | sed -n 1p)
token=$(printf '%s\n' "$reply" | sed -n 2p)
case "$remote" in http://*|https://*) ;; *) echo "codeSplitter ssh: $path: no remote" >&2; exit 1 ;; esac

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git init -q --bare "$scratch"
# The token stays out of argv (ps) and out of the remote URL: git reads it from the scratch repo's config.
git -C "$scratch" config remote.origin.url "$remote"
git -C "$scratch" config http.extraHeader "Authorization: Bearer $token"
# The whole remote (every ref, as is), so the client's haves and wants line up with the real repo. An empty remote
# (a first push) has no refs to fetch, which is fine.
if ! out=$(git -C "$scratch" fetch -q origin '+refs/*:refs/*' 2>&1); then
  echo "codeSplitter ssh: $path: $(printf '%s' "$out" | tail -n 1)" >&2; exit 1
fi
head=$(git -C "$scratch" ls-remote --symref origin HEAD 2>/dev/null | sed -n 's#^ref: \(refs/[^	]*\)	HEAD$#\1#p')
[ -n "$head" ] && git -C "$scratch" symbolic-ref HEAD "$head"

if [ "$verb" = git-receive-pack ]; then
  # Each "old new ref" line goes on to the HTTP remote as one push, leased on the old value so a ref that moved
  # there since the fetch is refused, not overwritten. The client's own fast-forward rule ran before it sent.
  cat > "$scratch/hooks/pre-receive" <<'HOOK'
#!/bin/sh
zero=0000000000000000000000000000000000000000
leases= specs=
while read -r old new ref; do
  if [ "$old" = "$zero" ]; then leases="$leases --force-with-lease=$ref:"; else leases="$leases --force-with-lease=$ref:$old"; fi
  if [ "$new" = "$zero" ]; then specs="$specs :$ref"; else specs="$specs +$new:$ref"; fi
done
# Ref names hold no spaces (git refuses them), so the lists split safely. Its output goes back as `remote:` lines.
# shellcheck disable=SC2086
exec git push -q origin $leases $specs 1>&2
HOOK
  chmod 755 "$scratch/hooks/pre-receive"
fi
"$verb" "$scratch"
