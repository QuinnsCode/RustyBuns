// #644: the guards of live/floorguard.ts (built to server/rb-floorguard.js), in the handler every agent-to-agent
// path lands in: the MCP tools, the office-workers command and a bare curl to the hook port.

/** server/hooks/office-workers.js: people-only actions, forced send-homes that keep work, and tell_worker marked as from its worker. */
export function floorGuardHooks(js: string) {
  const rel = "hooks/office-workers.js";
  const refused = "        return send(res, 405, { error: 'GET /office/workers, or POST to /office/workers, /office/workers/home, /office/workers/tell or /office/workers/pr' });\n";
  js = once(js, rel, refused, refused + "    const __rbLocked = __rbGuard.peopleOnly(action);\n    if (__rbLocked)\n        return send(res, 403, { error: __rbLocked });\n");
  js = once(js, rel, "            const { note, error } = await floor.sendHome(w.id, ask.cleanup);\n",
    "            const __rbHeld = await __rbGuard.forcedHome(floor, w, ask.cleanup, __rbDescribeWork);\n" +
    "            if (__rbHeld)\n                ctx.toastFloor(floor, __rbHeld, 'warn');\n" +
    "            const { note, error } = await floor.sendHome(w.id, __rbHeld ? undefined : ask.cleanup);\n");
  js = once(js, rel, "            results.push({ worker: w.name, id: w.id, went: true, ...(note ? { note } : {}), ...(error ? { error } : {}) });\n",
    "            results.push({ worker: w.name, id: w.id, went: true, ...(__rbHeld ? { held: __rbHeld } : {}), ...(note ? { note } : {}), ...(error ? { error } : {}) });\n");
  js = once(js, rel, "        let err = floor.workers.prompt(w.id, text, who);\n",
    "        const __rbText = __rbGuard.fromWorker(who, text);\n        let err = floor.workers.prompt(w.id, __rbText, who);\n");
  js = once(js, rel, "            err = floor.workers.resume(w.id, text);\n", "            err = floor.workers.resume(w.id, __rbText);\n");
  js = once(js, rel, "            return send(res, 400, { error: err });\n        return send(res, 200, { ok: true, worker: row(w.id) });\n",
    "            return send(res, 400, { error: err });\n" +
    "        const __rbInfo = floor.workers.get(w.id);\n        if (__rbInfo)\n            __rbInfo.lastInput = { by: who, at: Date.now() };\n" +
    "        ctx.toastFloor(floor, __rbGuard.toldToast(who, w.name, text));\n" +
    "        return send(res, 200, { ok: true, worker: row(w.id) });\n");
  return "import * as __rbGuard from '../rb-floorguard.js';\nimport { describeWork as __rbDescribeWork } from '../worktrees.js';\n" + js;
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
