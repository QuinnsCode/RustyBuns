// #644: the guards of live/floorguard.ts (built to server/rb-floorguard.js), in the handler every agent-to-agent
// path lands in: the MCP tools, the office-workers command and a bare curl to the hook port.
import { commandOf, MUSE_WRITE_HOOK, shellCommand, WRITE_HOOK } from "../askfirst/hook.ts";
import { ASK_MS } from "../live/floorguard.ts";

/** server/hooks/office-workers.js: people-only actions, ask-first ones held for a person (#727), forced send-homes that keep work, tell_worker marked as from its worker, and a told rebuild made its own task (#1235). */
export function floorGuardHooks(js: string) {
  const rel = "hooks/office-workers.js";
  const refused = "        return send(res, 405, { error: 'GET /office/workers, or POST to /office/workers, /office/workers/home, /office/workers/tell or /office/workers/pr' });\n";
  js = once(js, rel, refused, refused + "    const __rbLocked = __rbGuard.peopleOnly(action);\n    if (__rbLocked) {\n        // #2201: a refused send-home is logged too (the body is read here, since the refusal returns before it is parsed)\n        if (action === '/home')\n            __rbGuard.logHome(who, await readBody(req).catch(() => ''), undefined, 'denied', __rbLocked);\n        return send(res, 403, { error: __rbLocked });\n    }\n");
  // ask-first: once upstream's own checks have passed, so a request that would fail anyway never waits on a person
  const ask = (indent: string, body: string) => `${indent}const __rbNo = await __rbGuard.askFirst(action, floor.id, who, ${body}, (m) => ctx.toastFloor(floor, m));\n` +
    `${indent}if (__rbNo)\n${indent}    return send(res, 403, { error: __rbNo });\n`;
  // #2498: a Claude worker's PreToolUse hook (askfirst/hook.ts) asks here before it runs a GitHub write
  js = once(js, rel, "['', '/home', '/tell', '/pr'].includes(action)", "['', '/home', '/tell', '/pr', '/write'].includes(action)");
  js = once(js, rel, "    if (action === '/home') {\n",
    "    if (action === '/write') {\n        const out = await __rbGuard.writeCheck(ctx.cfg.dataDir, floor.def.repo, floor.id, who, { command: __rbCommandOf(body) }, (m) => ctx.toastFloor(floor, m));\n" +
    "        res.writeHead(out.allow ? 200 : 403, { 'content-type': 'text/plain' });\n        return res.end(out.error ?? 'ok');\n    }\n    if (action === '/home') {\n");
  const home = "        // One at a time: git takes a lock on the repository's refs to delete a branch.\n";
  js = once(js, rel, home, "        if (going.length) {\n" +
    "            const __rbNo = await __rbGuard.askFirst(action, floor.id, who, { workers: going.map((g) => g.w.name), cleanup: ask.cleanup }, (m) => ctx.toastFloor(floor, m));\n" +
    "            if (__rbNo) {\n                __rbGuard.logHome(who, going.map((g) => g.w.name), ask.cleanup, __rbNo.startsWith('Nobody') ? 'timed out' : 'denied', __rbNo);\n                return send(res, 403, { error: __rbNo });\n            }\n" +
    "        }\n" + home);
  const pr = "        const err = floor.workers.linkPr(w.id, pr);\n";
  js = once(js, rel, pr, ask("        ", "{ worker: w.id === me.id ? undefined : w.name, pr: pr?.number ?? null }") + pr);
  const hire = "        return send(res, 409, { error: 'Every desk and bean bag is taken: send someone home first' });\n";
  // A hired worker's first prompt is marked as from the agent that hired it, like a tell: hiring isn't a way round the mark.
  // #3119: a task on files an open PR or a queued task is changing is refused (anyway: true starts it, hold: true
  // waits for that work to merge); asked before ask-first, so a person isn't asked about a hire that won't happen
  js = once(js, rel, hire, hire + clash("    ", "body") + ask("    ", "body") + "    ask.prompt = __rbGuard.fromWorker(who, ask.prompt);\n" +
    held("    ", "{ by: who, owner: floor.workers.ownerOf(me.id), prompt: ask.prompt, title: __rbGuard.titleOf(body), issue: ask.issue }"));
  js = once(js, rel, "            const { note, error } = await floor.sendHome(w.id, ask.cleanup);\n",
    "            const __rbHeld = await __rbGuard.forcedHome(floor, w, ask.cleanup, __rbDescribeWork);\n" +
    "            if (__rbHeld)\n                ctx.toastFloor(floor, __rbHeld, 'warn');\n" +
    "            const { note, error } = await floor.sendHome(w.id, __rbHeld ? undefined : ask.cleanup);\n" +
    "            __rbGuard.logHome(who, [w.name], ask.cleanup, 'allowed', error || __rbHeld || note);\n");
  js = once(js, rel, "            results.push({ worker: w.name, id: w.id, went: true, ...(note ? { note } : {}), ...(error ? { error } : {}) });\n",
    "            results.push({ worker: w.name, id: w.id, went: true, ...(__rbHeld ? { held: __rbHeld } : {}), ...(note ? { note } : {}), ...(error ? { error } : {}) });\n");
  js = once(js, rel, "        let err = floor.workers.prompt(w.id, text, who);\n",
    ask("        ", "{ worker: w.name, prompt: text }") +
    // #1235: a rebuild is its own task, not a message that waits behind whatever its worker does next
    // (not when hiring is people-only or ask-first: a told rebuild is a hire, and the tell then goes through as a tell)
    "        const __rbPr = __rbGuard.hireLocked() ? undefined : __rbGuard.rebuildOf(text);\n" +
    "        const __rbTask = __rbPr && await __rbGuard.rebuildAsTask(floor, me, w.name, __rbPr, text, nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id);\n" +
    "        if (__rbTask) {\n            ctx.toastFloor(floor, __rbTask);\n            return send(res, 200, { ok: true, rebuild: __rbTask, worker: row(w.id) });\n        }\n" +
    "        const __rbText = __rbGuard.fromWorker(who, text);\n        let err = floor.workers.prompt(w.id, __rbText, who);\n");
  js = once(js, rel, "            err = floor.workers.resume(w.id, text);\n", "            err = floor.workers.resume(w.id, __rbText);\n");
  js = once(js, rel, "            return send(res, 400, { error: err });\n        return send(res, 200, { ok: true, worker: row(w.id) });\n",
    "            return send(res, 400, { error: err });\n" +
    "        const __rbInfo = floor.workers.get(w.id);\n        if (__rbInfo)\n            __rbInfo.lastInput = { by: who, at: Date.now() };\n" +
    "        ctx.toastFloor(floor, __rbGuard.toldToast(who, w.name, text));\n" +
    "        return send(res, 200, { ok: true, worker: row(w.id) });\n");
  return "import * as __rbGuard from '../rb-floorguard.js';\nimport { commandOf as __rbCommandOf } from '../rb-askfirst.js';\nimport { describeWork as __rbDescribeWork } from '../worktrees.js';\n" + js;
}

/** server/ws/handlers/workers.js: a person's send-home click lands in the same local log as an agent's request (#2201), and a key from a terminal that lost its attach attaches it again (#4315). */
export function floorGuardClicks(js: string) {
  const rel = "ws/handlers/workers.js";
  js = once(js, rel, "        void done.then(({ note, error }) => {\n",
    "        void done.then(({ note, error }) => {\n            __rbGuard.logHome(who, [info.name], msg.cleanup, 'allowed', error || note);\n");
  // #4315: upstream drops a key from a connection that isn't attached to that terminal, without a word, so the terminal
  // still shows the worker but nothing typed reaches it. Attach it again (what opening the terminal sends), then type;
  // if that can't attach either, say so to the typist, once every few seconds rather than once a key.
  js = once(js, rel, "        if (c.attached.has(msg.workerId))\n            ctx.workerFloor(msg.workerId)?.workers.write(",
    "        if (!c.attached.has(msg.workerId))\n            workerHandlers['worker.attach'](ctx, c, msg);\n" +
    "        if (!c.attached.has(msg.workerId)) {\n            if (Date.now() - (c.__rbDropped ?? 0) > 5000)\n" +
    "                ctx.sendTo(c, { t: 'toast', text: \"What you typed didn't reach that terminal: the office can't find its worker. Close the terminal and open it again.\", level: 'warn' });\n" +
    "            c.__rbDropped = Date.now();\n        }\n" +
    "        else\n            ctx.workerFloor(msg.workerId)?.workers.write(");
  return "import * as __rbGuard from '../../rb-floorguard.js';\n" + js;
}

/**
 * server/providers/claude.js: each Claude worker's hook settings get a second PreToolUse hook on Bash (askfirst/hook.ts),
 * which waits for a person's say-so before a GitHub write. The first one stays: it only tells the office what happened.
 * Its timeout (seconds) is longer than the ask's, or Claude Code would kill the hook at 60 s.
 */
export function floorGuardClaude(js: string) {
  const mark = "    // Looking at the office's workers doesn't need anyone's say-so; hiring and sending home still asks.\n";
  return once(js, "providers/claude.js", mark,
    `    hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', timeout: ${ASK_MS / 1000 + 10}, command: ${JSON.stringify(WRITE_HOOK)} }] });\n` + mark);
}

const ASK_TIMEOUT_S = ASK_MS / 1000 + 10;

/**
 * server/codex.js: Codex's PreToolUse hook (a -c override per event) gets the same blocking hook beside the office's own.
 * Both run for every tool call; the blocking one lets anything that isn't a gh or git command straight through.
 */
export function floorGuardCodex(js: string) {
  const from = "const config = `hooks.${event}=[{hooks=[{type=\"command\",command=${JSON.stringify(command)},timeout=3}]}]`;";
  return once(js, "codex.js", from,
    "const ask = event === 'PreToolUse' ? `,{type=\"command\",command=${JSON.stringify(" + JSON.stringify(shellCommand(WRITE_HOOK, "agent-office-write-hook")) + ")},timeout=" + ASK_TIMEOUT_S + "}` : '';\n" +
    "        const config = `hooks.${event}=[{hooks=[{type=\"command\",command=${JSON.stringify(command)},timeout=3}${ask}]}]`;");
}

/** server/grok.js: the office's GROK_HOME hooks file gets the blocking hook as a second PreToolUse command. */
export function floorGuardGrok(js: string) {
  const from = "        hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 3 }] }];\n";
  return once(js, "grok.js", from, from +
    `        if (event === 'PreToolUse')\n            hooks[event].push({ hooks: [{ type: 'command', command: ${JSON.stringify(shellCommand(WRITE_HOOK, "agent-office-write-hook"))}, timeout: ${ASK_TIMEOUT_S} }] });\n`);
}

/** server/muse.js: the office's own Muse settings get Muse's version of the hook (askfirst/hook.ts) as a second PreToolUse command (#2526). */
export function floorGuardMuse(js: string) {
  const from = "        hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 3 }] }];\n";
  return once(js, "muse.js", from, from +
    `        if (event === 'PreToolUse')\n            hooks[event].push({ hooks: [{ type: 'command', command: ${JSON.stringify(shellCommand(MUSE_WRITE_HOOK, "agent-office-write-hook"))}, timeout: ${ASK_TIMEOUT_S} }] });\n`);
}

/**
 * server/cursor.js: the worker's entry in the folder's hooks.json gets a blocking preToolUse beside it. Every worker in
 * a folder shares that file, so the command is the worker's own: it ends with the worker's id, which is how the office
 * finds it again to take it out, and does nothing when another worker runs it.
 */
export function floorGuardCursor(js: string) {
  const from = "        config.hooks[event] = [...entries, { command, timeout: HOOK_TIMEOUT_S }];\n";
  const script = 'if [ "$AGENT_OFFICE_WORKER_ID" != "$1" ]; then exit 0; fi\n' + WRITE_HOOK;
  return once(js, "cursor.js", from, from +
    "        if (event === 'preToolUse')\n" +
    `            config.hooks[event].push({ command: ${JSON.stringify(shellCommand(script, "agent-office-cursor-hook.cjs"))} + ' ' + shellQuote(workerId), timeout: ${ASK_TIMEOUT_S} });\n`);
}

/**
 * server/hooks/office-queue.js: a board agent's queued task is a worker's first prompt, so it gets the same guards
 * as a hire: people-only and ask-first under the word `queue`, and the prompt marked as from that agent.
 */
export function floorGuardQueue(js: string) {
  const rel = "hooks/office-queue.js";
  const add = "    const err = floor.queue.add(str(body?.prompt, 20000), agent.name,";
  js = once(js, rel, add,
    "    const __rbLocked = __rbGuard.peopleOnly('/queue');\n    if (__rbLocked)\n        return send(res, 403, { error: __rbLocked });\n" +
    clash("    ", "body") +
    "    const __rbNo = await __rbGuard.askFirst('/queue', floor.id, agent.name, body, (m) => ctx.toastFloor(floor, m));\n" +
    "    if (__rbNo)\n        return send(res, 403, { error: __rbNo });\n" +
    held("    ", "{ by: agent.name, owner: floor.workers.ownerOf(agent.id), prompt: __rbGuard.fromWorker(agent.name, str(body?.prompt, 20000)), title: __rbGuard.titleOf(body), issue }") +
    "    const err = floor.queue.add(__rbGuard.fromWorker(agent.name, str(body?.prompt, 20000)), agent.name,");
  return "import * as __rbGuard from '../rb-floorguard.js';\n" + js;
}

/** bin/office-workers.js: an ask-first office holds a request for up to ASK_MS, so the command waits that much longer. */
export function floorGuardBin(js: string) {
  const timeouts = "const TIMEOUT_MS = { list: 15_000, tell: 15_000, pr: 45_000, hire: 90_000, home: 300_000 };\n";
  return overlapBin(once(js, "bin/office-workers.js", timeouts,
    timeouts + `if (process.env.AGENT_OFFICE_ASK_FIRST)\n  for (const k of ['tell', 'pr', 'hire', 'home']) TIMEOUT_MS[k] += ${ASK_MS};\n`));
}

/** #3119: what a task collides with (live/overlap.ts), refused with a 409 unless the request says anyway or hold. */
const clash = (indent: string, body: string) =>
  `${indent}const __rbClash = __rbGuard.flagOf(${body}, 'anyway') ? null : await __rbGuard.hireClash(floor, ${body});\n` +
  `${indent}if (__rbClash && !__rbGuard.flagOf(${body}, 'hold'))\n${indent}    return send(res, 409, { error: __rbGuard.clashMessage(__rbClash), clash: __rbClash });\n`;

/** With hold: the task waits on the office (202), and is queued once that work has merged. */
const held = (indent: string, task: string) =>
  `${indent}if (__rbClash) {\n` +
  `${indent}    const __rbHold = __rbGuard.holdTask(floor, __rbClash, ${task}, (m) => ctx.toastFloor(floor, m));\n` +
  `${indent}    ctx.toastFloor(floor, __rbHold.message);\n` +
  `${indent}    return send(res, 202, { ok: true, held: __rbHold });\n${indent}}\n`;

/**
 * bin/office-workers.js: `hire --anyway` and `hire --hold`, and the hire_worker tool's anyway and hold, for a task the
 * office says collides (#3119). A held hire answers with no worker, so both print what the office said instead.
 */
export function overlapBin(js: string) {
  const rel = "bin/office-workers.js";
  js = once(js, rel, "                                                --no-worktree\n",
    "                                                --no-worktree --anyway (start it though open work changes\n" +
    "                                                its files) --hold (queue it once that work has merged)\n");
  js = once(js, rel, "['--no-worktree', '--json']);", "['--no-worktree', '--json', '--anyway', '--hold']);");
  js = once(js, rel, "    if (opts['--no-worktree']) out.worktree = false;\n",
    "    if (opts['--no-worktree']) out.worktree = false;\n    if (opts['--anyway']) out.anyway = true;\n    if (opts['--hold']) out.hold = true;\n" +
    "    if (out.anyway && out.hold) throw new UsageError('Give --anyway or --hold, not both');\n");
  js = once(js, rel, "        issue: { type: 'integer', minimum: 1, description: 'The GitHub issue it works on, assigned when it starts.' },\n",
    "        issue: { type: 'integer', minimum: 1, description: 'The GitHub issue it works on, assigned when it starts.' },\n" +
    "        anyway: { type: 'boolean', description: 'Hire it even though an open pull request or a queued task changes the files it names (the office refuses otherwise and says which).' },\n" +
    "        hold: { type: 'boolean', description: 'When that work collides, hold the task instead: the office queues it once that work has merged.' },\n");
  js = once(js, rel, "    const answer = await call('hire', a, io);\n",
    "    const answer = await call('hire', a, io);\n    if (answer.held) return { text: answer.held.message };\n");
  js = once(js, rel, "    const answer = await call('hire', body, ctx);\n",
    "    const answer = await call('hire', body, ctx);\n    if (answer.held) {\n      err(answer.held.message);\n      return 0;\n    }\n");
  return js;
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
