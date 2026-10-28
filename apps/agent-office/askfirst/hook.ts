// The shell command of a Claude worker's second PreToolUse hook on Bash (#2498), put in its settings by scripts/floorguard.ts.
// Claude Code gives it the tool call as JSON on stdin. A command that doesn't mention gh or git goes ahead at once. Any
// other is posted to the office (/office/workers/write), which says whether it makes a write, and if so waits for a person.
// 200 lets it run; any other reply stops it: exit 2 shows the reason to the agent. When the office doesn't answer at all
// (it is restarting while workers keep running), only a command that looks like a write is held, by the crude pattern
// below; git status, gh pr view and the rest go ahead. The first PreToolUse hook (upstream's) stays as it is; it only tells
// the office what happened and can't block.
const WRITES = "git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push|gh[[:space:]]+(pr|issue)[[:space:]]+(create|merge|close|reopen|edit|comment|review|ready|lock|unlock|delete|transfer|develop|pin|unpin)|gh[[:space:]]+api.*(-X|--method)[[:space:]=]*(POST|PATCH|PUT|DELETE)";

export const WRITE_HOOK = [
  'if [ -z "$AGENT_OFFICE_WORKER_ID" ] || [ -z "$AGENT_OFFICE_HOOK_URL" ]; then exit 0; fi',
  'in=$(cat)',
  'case "$in" in *gh*|*git*) ;; *) exit 0;; esac',
  'out=; code=000',
  `if command -v curl >/dev/null 2>&1; then out=$(printf '%s' "$in" | curl -sS -m 130 -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" -w '\\n%{http_code}' --data-binary @- "$AGENT_OFFICE_HOOK_URL/office/workers/write?worker=$AGENT_OFFICE_WORKER_ID" 2>/dev/null); code=$(printf '%s' "$out" | tail -n 1); fi`,
  '[ "$code" = 200 ] && exit 0',
  `if [ "$code" = 000 ] || [ -z "$code" ]; then`,
  `  if printf '%s' "$in" | grep -Eq "${WRITES}"; then echo "The office did not answer, so this GitHub write was held: try again in a moment" >&2; exit 2; fi`,
  '  exit 0',
  'fi',
  `msg=$(printf '%s' "$out" | sed '$d')`,
  'echo "${msg:-The office answered no, so this GitHub command was held}" >&2',
  'exit 2',
].join("\n");
