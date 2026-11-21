# The forced command for every ssh login (see entry.sh). git asks for `git-upload-pack '/owner/repo.git'` (fetch,
# clone, ls-remote) or `git-receive-pack '...'` (push); anything else is refused. The path must be owner/repo with
# plain characters, and maps to /srv/git/owner/repo.git. A push to a repo that isn't there yet makes it.
set -eu
cmd=${SSH_ORIGINAL_COMMAND:-}
verb=${cmd%% *}
arg=${cmd#* }
case "$verb" in git-upload-pack|git-receive-pack) ;; *) echo "codeSplitter ssh: only git fetch and push" >&2; exit 1 ;; esac
path=$(printf '%s' "$arg" | sed -e "s/^'//" -e "s/'\$//" -e 's#^/##' -e 's#\.git$##')
if ! printf '%s' "$path" | grep -Eq '^[A-Za-z0-9_-][A-Za-z0-9._-]*/[A-Za-z0-9_-][A-Za-z0-9._-]*$'; then
  echo "codeSplitter ssh: the path is owner/repo" >&2; exit 1
fi
repo=/srv/git/$path.git
if [ ! -d "$repo" ]; then
  [ "$verb" = git-receive-pack ] || { echo "codeSplitter ssh: no repo $path" >&2; exit 1; }
  git init -q --bare -b main "$repo"
fi
exec "$verb" "$repo"
