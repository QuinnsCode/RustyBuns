// The shell command of a Claude worker's second PreToolUse hook on Bash (#2498), put in its settings by scripts/floorguard.ts.
// Claude Code gives it the tool call as JSON on stdin. A command that doesn't mention gh or git goes ahead at once. Any
// other is posted to the office (/office/workers/write), which says whether it makes a write, and if so waits for a person.
// 200 lets it run; any other reply stops it: exit 2 shows the reason to the agent. When the office doesn't answer at all
// (it is restarting while workers keep running), only a command that looks like a write is held, by the crude pattern
// below; git status, gh pr view and the rest go ahead. The first PreToolUse hook (upstream's) stays as it is; it only tells
// the office what happened and can't block.
const WRITES = "git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push|gh[[:space:]]+(pr|issue)[[:space:]]+(create|merge|close|reopen|edit|comment|review|ready|lock|unlock|delete|transfer|develop|pin|unpin)|gh[[:space:]]+api.*(-X|--method)[[:space:]=]*(POST|PATCH|PUT|DELETE)";

/**
 * Muse (#2526) gives the same payload but stops a call by a JSON answer on stdout, not exit 2, and runs hooks in a cleared
 * environment that may drop the office's AGENT_OFFICE_* variables. Its hook lives only in the office's own Muse settings,
 * so missing variables mean the office can't be asked, not that this isn't a worker: a write is held, never let through.
 */
function writeHook(muse: boolean) {
  const no = muse
    ? `no() { r=$(printf '%s' "$1" | tr '\\n\\r\\t' '   ' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'); printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$r"; exit 0; }`
    : `no() { echo "$1" >&2; exit 2; }`;
  const reach = '[ -n "$AGENT_OFFICE_WORKER_ID" ] && [ -n "$AGENT_OFFICE_HOOK_URL" ]';
  return [
    ...(muse ? [] : [`if ! { ${reach}; }; then exit 0; fi`]),
    no,
    'in=$(cat)',
    'case "$in" in *gh*|*git*) ;; *) exit 0;; esac',
    'out=; code=000',
    `if ${reach} && command -v curl >/dev/null 2>&1; then out=$(printf '%s' "$in" | curl -sS -m 130 -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" -w '\\n%{http_code}' --data-binary @- "$AGENT_OFFICE_HOOK_URL/office/workers/write?worker=$AGENT_OFFICE_WORKER_ID" 2>/dev/null); code=$(printf '%s' "$out" | tail -n 1); fi`,
    '[ "$code" = 200 ] && exit 0',
    `if [ "$code" = 000 ] || [ -z "$code" ]; then`,
    `  if printf '%s' "$in" | grep -Eq "${WRITES}"; then`,
    `    ${reach} || no "This hook can't reach the office, so this GitHub write was held: ask your person to run it"`,
    '    no "The office did not answer, so this GitHub write was held: try again in a moment"',
    '  fi',
    '  exit 0',
    'fi',
    `msg=$(printf '%s' "$out" | sed '$d')`,
    'no "${msg:-The office answered no, so this GitHub command was held}"',
  ].join("\n");
}

export const WRITE_HOOK = writeHook(false);
export const MUSE_WRITE_HOOK = writeHook(true);

/**
 * The shell command in a worker's tool call, whichever agent sent it: Claude Code, Codex and Cursor say
 * `tool_input.command`, Grok `toolInput.command`, Cursor's shell hook a bare `command`, and Muse's exec tool may say
 * `tool_input.cmd` (its schema reads like Codex's exec_command; not yet seen on a live Muse, #2526).
 */
export function commandOf(call: unknown): string | undefined {
  const field = (o: unknown, k: string) => (typeof o === "object" && o !== null && k in o ? (o as Record<string, unknown>)[k] : undefined);
  for (const c of [field(field(call, "tool_input"), "command"), field(field(call, "tool_input"), "cmd"), field(field(call, "toolInput"), "command"), field(call, "command")])
    if (typeof c === "string") return c;
  return undefined;
}

/** `script` as a command line any agent's hooks can run, with `args` as its $1, $2, ... (its $0 is `name`). */
export function shellCommand(script: string, name: string, ...args: string[]) {
  const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  return ["sh -c", ...[script, name, ...args].map(q)].join(" ");
}
