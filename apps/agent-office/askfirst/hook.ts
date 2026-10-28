// The shell command of a Claude worker's second PreToolUse hook on Bash (#2498), put in its settings by scripts/floorguard.ts.
// Claude Code gives it the tool call as JSON on stdin. A command that doesn't mention gh or git goes ahead at once. Any
// other is posted to the office (/office/workers/write), which says whether it makes a write, and if so waits for a person.
// 200 lets it run; anything else, an office that doesn't answer included, stops it: exit 2 shows the reason to the agent.
// The first PreToolUse hook (upstream's) stays as it is; it only tells the office what happened and can't block.
export const WRITE_HOOK = [
  'if [ -z "$AGENT_OFFICE_WORKER_ID" ] || [ -z "$AGENT_OFFICE_HOOK_URL" ]; then exit 0; fi',
  'in=$(cat)',
  'case "$in" in *gh*|*git*) ;; *) exit 0;; esac',
  'command -v curl >/dev/null 2>&1 || { echo "curl is missing, so this GitHub command was held" >&2; exit 2; }',
  `out=$(printf '%s' "$in" | curl -sS -m 130 -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" -w '\\n%{http_code}' --data-binary @- "$AGENT_OFFICE_HOOK_URL/office/workers/write?worker=$AGENT_OFFICE_WORKER_ID" 2>/dev/null)`,
  `code=$(printf '%s' "$out" | tail -n 1)`,
  '[ "$code" = 200 ] && exit 0',
  `msg=$(printf '%s' "$out" | sed '$d')`,
  'echo "${msg:-The office did not answer, so this GitHub command was held}" >&2',
  'exit 2',
].join("\n");
