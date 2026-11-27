// #4753: the office kept a worker's last prompt only as its 80-character `activity` line (and in `w.prompts`, gone on a
// restart), so a task that had to be handed on left nothing the next worker could read. Each worker now keeps the full
// text of what it was last told, on the worker and not in `info` (which every update broadcasts), saved in workers.json,
// and `office-workers show <name>` (GET /office/workers/prompt?of=<name>) reads it back.
import { once } from "./once.ts";

/** As long as a prompt `office-workers tell` takes. */
export const LAST_PROMPT_MAX = 20_000;

/** server/workers/tasks.js: every new message a worker gets (a hire, a tell, a resume, one typed at its desk) is kept whole. */
export function lastPromptTasks(js: string) {
  return once(js, "workers/tasks.js",
    "            return;\n        w.prompts = [...w.prompts, clean].slice(-TASK_PROMPTS);\n",
    "            return;\n" +
    `        w.lastPrompt = { text: prompt.replace(/\\r\\n?/g, '\\n').trim().slice(0, ${LAST_PROMPT_MAX}), at: Date.now() };\n` +
    "        w.prompts = [...w.prompts, clean].slice(-TASK_PROMPTS);\n");
}

/** server/workers/persist.js: workers.json saves it, and a restart takes it back (an older file's hire prompt stands in). */
export function lastPromptPersist(js: string) {
  const rel = "workers/persist.js";
  js = once(js, rel, "    const saved = [...workers].map(({ ", "    const saved = [...workers].map(({ lastPrompt, ");
  js = once(js, rel, "        task: info.task,\n", "        task: info.task,\n        lastPrompt,\n");
  return once(js, rel, "            if (info.prompt)\n                w.prompts = [info.prompt.replace(/\\s+/g, ' ').trim()];\n",
    "            if (info.prompt)\n                w.prompts = [info.prompt.replace(/\\s+/g, ' ').trim()];\n" +
    "            const lp = s.lastPrompt;\n" +
    `            if (lp && typeof lp.text === 'string' && lp.text && typeof lp.at === 'number')\n                w.lastPrompt = { text: lp.text.slice(0, ${LAST_PROMPT_MAX}), at: lp.at };\n` +
    "            else if (info.prompt)\n                w.lastPrompt = { text: info.prompt, at: info.createdAt };\n");
}

/** server/hooks/office-workers.js: GET /office/workers/prompt?of=<name|id>, one worker's last prompt in full. */
export function lastPromptHooks(js: string) {
  // floorguard.ts adds its own action to the end of this line, so only its start is the anchor
  const anchor = "    if (req.method !== 'POST' || !['', ";
  return once(js, "hooks/office-workers.js", anchor,
    "    if (req.method === 'GET' && action === '/prompt') {\n" +
    "        const w = findWorker(floor.workers.list(), str(url.searchParams.get('of'), 64));\n" +
    "        if (typeof w === 'string')\n            return send(res, 404, { error: w });\n" +
    "        const last = floor.workers.workers?.get(w.id)?.lastPrompt;\n" +
    "        return send(res, 200, { worker: { id: w.id, name: w.name }, prompt: last ?? null });\n" +
    "    }\n" + anchor);
}

/** bin/office-workers.js: `office-workers show <name|id> [--json]`. */
export function lastPromptBin(js: string) {
  const rel = "bin/office-workers.js";
  js = once(js, rel, "  office-workers tell <name|id> <<'EOF'         type a prompt to a worker (or --prompt \"…\")\n",
    "  office-workers tell <name|id> <<'EOF'         type a prompt to a worker (or --prompt \"…\")\n" +
    "  office-workers show <name|id> [--json]        the full text of the last prompt a worker was given,\n" +
    "                                                to hand its task on\n");
  js = once(js, rel, "const PATHS = { list: '',", "const PATHS = { show: '/prompt', list: '',");
  js = once(js, rel, "  if (what === 'list') return { method: 'GET', url: url.href, headers, timeout: TIMEOUT_MS.list };\n",
    "  if (what === 'list') return { method: 'GET', url: url.href, headers, timeout: TIMEOUT_MS.list };\n" +
    "  if (what === 'show') {\n    url.searchParams.set('of', String(body?.worker ?? ''));\n" +
    "    return { method: 'GET', url: url.href, headers, timeout: TIMEOUT_MS.list };\n  }\n");
  js = once(js, rel, "  if (cmd === 'tell') {\n",
    "  if (cmd === 'show') {\n" +
    "    const { opts, words } = options(rest, [], ['--json']);\n" +
    "    if (words.length !== 1) throw new UsageError('show takes one worker, its name or id');\n" +
    "    return { cmd: 'show', worker: words[0], json: opts['--json'] === true };\n  }\n" +
    "  if (cmd === 'tell') {\n");
  return once(js, rel, "    if (cmd.cmd === 'tell') {\n",
    "    if (cmd.cmd === 'show') {\n" +
    "      const answer = await call('show', { worker: cmd.worker }, ctx);\n" +
    "      const name = answer.worker?.name ?? cmd.worker;\n" +
    "      if (cmd.json) out(JSON.stringify(answer, null, 2));\n" +
    "      else if (!answer.prompt) err(`${name} hasn't been given a prompt yet.`);\n" +
    "      else {\n        err(`${name}'s last prompt, ${new Date(answer.prompt.at).toISOString()}:`);\n        out(answer.prompt.text);\n      }\n" +
    "      return 0;\n    }\n" +
    "    if (cmd.cmd === 'tell') {\n");
}
