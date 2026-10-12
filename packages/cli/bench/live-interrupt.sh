#!/bin/zsh
# zsh packages/cli/bench/live-interrupt.sh <app dir>: #931, bench/lifecycle.ts against the real
# Alchemy and Cloudflare. On a throwaway stage (STAGE, default interrupt_test) it:
#   1. deploys, and SIGTERMs rustybuns a few seconds into alchemy (an agent's timeout)
#   2. plans, to see the state still reads
#   3. deploys to the end and fetches the Worker
#   4. destroys, and Ctrl-Cs it partway (SIGINT to the process group)
#   5. destroys to the end (also on any failure or exit, so nothing is left running)
# and prints, for each stop: exit code, seconds to exit, alchemy left running, lock left.
# Run it yourself: varlock asks for Touch ID, and the Cloudflare token comes from your wrangler.
set -u
APP=${1:?usage: live-interrupt.sh <app dir>}; STAGE=${STAGE:-interrupt_test}; DELAY=${DELAY:-4}
ROOT=${0:A:h:h:h:h}; CLI="$ROOT/packages/cli/src/index.ts"
cd "$APP" || exit 1
NAME=$(bun -e 'console.log((await import(process.cwd() + "/rustybuns.config.ts")).default.name)')
LOG="$PWD/.rustybuns/live-interrupt.log"; mkdir -p .rustybuns; : > "$LOG"
LOCK="$(git rev-parse --path-format=absolute --git-common-dir)/rustybuns/alchemy/$(git rev-parse --show-prefix | sed 's|/$||')/lock"
export PATH="/opt/homebrew/bin:$PATH" RUSTYBUNS_NO_UPDATE_CHECK=1   # op, for varlock

# Cloudflare: wrangler's login as a token (Alchemy's own OAuth link doesn't work here).
export CLOUDFLARE_API_TOKEN=$(./node_modules/.bin/wrangler auth token 2>/dev/null | tail -1 | tr -d '[:space:]')
[[ -n $CLOUDFLARE_API_TOKEN ]] || { echo "wrangler isn't logged in: run ./node_modules/.bin/wrangler login in $APP, then this again"; exit 1; }
if [[ -z ${CLOUDFLARE_ACCOUNT_ID:-} ]]; then
  accounts=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts \
    | bun -e 'const r = await Bun.stdin.json(); for (const a of r.result ?? []) console.log(a.id, a.name)')
  mine=$(print -r -- "$accounts" | grep -i notryanquinn)
  [[ $(print -r -- "$mine" | grep -c .) == 1 ]] || { echo "pick the account: CLOUDFLARE_ACCOUNT_ID=<id> zsh $0 $APP"; print -r -- "$accounts"; exit 1; }
  export CLOUDFLARE_ACCOUNT_ID=${mine%% *}
fi
echo "app $NAME, stage $STAGE, account ${CLOUDFLARE_ACCOUNT_ID[1,8]}…, log $LOG"

# `rustybuns <sub>` on the stage, to the log. --yes for deploy/destroy (no prompt, no plan stamp).
rb() { local yes=(--yes); [[ $1 == plan ]] && yes=(); echo "\n\$ rustybuns $*" >> "$LOG"; bun "$CLI" "$@" --stage "$STAGE" $yes </dev/null >> "$LOG" 2>&1; }
# Any alchemy still running against this stage.
running() { pgrep -f "alchemy.run.ts.*$STAGE|$STAGE.*alchemy.run.ts" | tr '\n' ' '; }
deployed=0
cleanup() { (( deployed )) && { echo "cleanup: destroy $STAGE"; rb destroy; }; }
trap cleanup EXIT
ROWS=()

# Start `rustybuns <sub>`, wait until alchemy is running (its pid in the lock), DELAY more
# seconds, then send <signal> to rustybuns (pid) or to its process group (group, as Ctrl-C).
interrupt() {
  local sub=$1 sig=$2 to=$3
  setopt local_options monitor   # a background job gets its own process group
  echo "\n\$ rustybuns $sub (then $sig to the $to)" >> "$LOG"
  bun "$CLI" "$sub" --stage "$STAGE" --yes </dev/null >> "$LOG" 2>&1 &
  local pid=$! t=0
  until grep -q '"child"' "$LOCK" 2>/dev/null || (( t > 600 )) || ! kill -0 $pid 2>/dev/null; do sleep 0.5; (( t++ )); done
  local child=$(grep -o '"child":[0-9]*' "$LOCK" 2>/dev/null | cut -d: -f2)
  [[ -z $child ]] && { wait $pid; ROWS+=("$sub/$sig: alchemy never started (exit $?), see the log"); return; }
  (( deployed = 1 ))
  sleep $DELAY
  local start=$SECONDS
  if [[ $to == group ]]; then kill -$sig -- -$pid; else kill -$sig $pid; fi
  wait $pid; local code=$? secs=$(( SECONDS - start ))
  sleep 1
  local left=$(running); kill -0 $child 2>/dev/null && left="$left$child(varlock/alchemy)"
  ROWS+=("$sub stopped by $sig to the $to: exit $code after ${secs}s; still running: ${left:-nothing}; lock left: $([[ -e $LOCK ]] && echo YES || echo no)")
  # Let anything still running finish before the next step, as a person would.
  while [[ -n $(running) ]]; do sleep 1; done
}

interrupt deploy TERM pid
rb plan && ROWS+=("plan after the stopped deploy: state reads (exit 0)") || ROWS+=("plan after the stopped deploy: FAILED (exit $?), see the log")
if rb deploy; then
  url=$(grep -oE "https://[a-z0-9.-]+\.workers\.dev" "$LOG" | tail -1)
  ROWS+=("full deploy: ok, ${url:-no workers.dev URL in the output} -> $([[ -n $url ]] && curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url")")
else ROWS+=("full deploy: FAILED (exit $?), see the log"); fi
interrupt destroy INT group
rb destroy && { ROWS+=("destroy to the end: ok"); deployed=0; } || ROWS+=("destroy to the end: FAILED (exit $?): the trap tries once more")

echo "\nresults (full output in $LOG):"; for r in $ROWS; do echo "  - $r"; done
