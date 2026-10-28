// #644: the guards of live/floorguard.ts (built to server/rb-floorguard.js), in the handler every agent-to-agent
// path lands in: the MCP tools, the office-workers command and a bare curl to the hook port.
import { WRITE_HOOK } from "../askfirst/hook.ts";
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
    "    if (action === '/write') {\n        const out = await __rbGuard.writeCheck(ctx.cfg.dataDir, floor.def.repo, floor.id, who, { command: body?.tool_input?.command }, (m) => ctx.toastFloor(floor, m));\n" +
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
  js = once(js, rel, hire, hire + ask("    ", "body") + "    ask.prompt = __rbGuard.fromWorker(who, ask.prompt);\n");
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
  return "import * as __rbGuard from '../rb-floorguard.js';\nimport { describeWork as __rbDescribeWork } from '../worktrees.js';\n" + js;
}

/** server/ws/handlers/workers.js: a person's send-home click lands in the same local log as an agent's request (#2201). */
export function floorGuardClicks(js: string) {
  const rel = "ws/handlers/workers.js";
  js = once(js, rel, "        void done.then(({ note, error }) => {\n",
    "        void done.then(({ note, error }) => {\n            __rbGuard.logHome(who, [info.name], msg.cleanup, 'allowed', error || note);\n");
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

/**
 * server/hooks/office-queue.js: a board agent's queued task is a worker's first prompt, so it gets the same guards
 * as a hire: people-only and ask-first under the word `queue`, and the prompt marked as from that agent.
 */
export function floorGuardQueue(js: string) {
  const rel = "hooks/office-queue.js";
  const add = "    const err = floor.queue.add(str(body?.prompt, 20000), agent.name,";
  js = once(js, rel, add,
    "    const __rbLocked = __rbGuard.peopleOnly('/queue');\n    if (__rbLocked)\n        return send(res, 403, { error: __rbLocked });\n" +
    "    const __rbNo = await __rbGuard.askFirst('/queue', floor.id, agent.name, body, (m) => ctx.toastFloor(floor, m));\n" +
    "    if (__rbNo)\n        return send(res, 403, { error: __rbNo });\n" +
    "    const err = floor.queue.add(__rbGuard.fromWorker(agent.name, str(body?.prompt, 20000)), agent.name,");
  return "import * as __rbGuard from '../rb-floorguard.js';\n" + js;
}

/** bin/office-workers.js: an ask-first office holds a request for up to ASK_MS, so the command waits that much longer. */
export function floorGuardBin(js: string) {
  const timeouts = "const TIMEOUT_MS = { list: 15_000, tell: 15_000, pr: 45_000, hire: 90_000, home: 300_000 };\n";
  return once(js, "bin/office-workers.js", timeouts,
    timeouts + `if (process.env.AGENT_OFFICE_ASK_FIRST)\n  for (const k of ['tell', 'pr', 'hire', 'home']) TIMEOUT_MS[k] += ${ASK_MS};\n`);
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
