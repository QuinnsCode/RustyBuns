// #642: workers.json held every worker's hook token, so any worker could read it and call the hook port as
// another (send_home, tell_worker, link_pr in its name). Now it holds a sha256 of each token. A worker whose
// terminal outlives a restart still has its token in its own env, and the office checks it against that hash
// until the worker is launched again with a fresh env. The token itself only ever lives in the office's memory
// and the worker's env.

/** server/workers/util.js: the hash, and the check authenticate and handleProviderHook make. */
export function hookTokensUtil(js: string) {
  once(js, "workers/util.js", "export function safeEq(a, b) {", "");
  return js +
    "\nimport { createHash as __rbCreateHash } from 'node:crypto';\n" +
    "/** What workers.json keeps of a hook token (#642). */\n" +
    "export const __rbHookHash = (token) => __rbCreateHash('sha256').update(String(token)).digest('hex');\n" +
    "/** A worker's hook token: against its hash while it's a terminal picked back up after a restart. */\n" +
    "export const __rbHookOk = (w, token) => !!token && (w.hookHash ? safeEq(__rbHookHash(token), w.hookHash) : safeEq(token, w.hookToken));\n";
}

/** server/workers/persist.js: save and restore the hash, never the token; an older file's token is hashed on the way in. */
export function hookTokensPersist(js: string) {
  js = once(js, "workers/persist.js", "({ info, owner, tracker, state, hookToken, pty, bootBlocked, interrupted })",
    "({ info, owner, tracker, state, hookToken, hookHash, pty, bootBlocked, interrupted })");
  js = once(js, "workers/persist.js", "        hookToken,\n        pty:", "        hookHash: hookHash ?? __rbHookHash(hookToken),\n        pty:");
  js = once(js, "workers/persist.js",
    "            const w = newWorker(info, tracker, typeof s.hookToken === 'string' && s.hookToken ? s.hookToken : undefined);\n",
    "            const w = newWorker(info, tracker);\n" +
    "            w.hookHash = typeof s.hookHash === 'string' && s.hookHash ? s.hookHash : typeof s.hookToken === 'string' && s.hookToken ? __rbHookHash(s.hookToken) : undefined;\n");
  return "import { __rbHookHash } from './util.js';\n" + js;
}

/** server/workers/manager.js: both token checks go through the hash, and a launch (a fresh env) drops it. */
export function hookTokensManager(js: string) {
  js = once(js, "workers/manager.js", "return (w?.pty || w?.dsh) && token && safeEq(token, w.hookToken) ? w.info : undefined;",
    "return (w?.pty || w?.dsh) && __rbHookOk(w, token) ? w.info : undefined;");
  js = once(js, "workers/manager.js", "!safeEq(token, w.hookToken))", "!__rbHookOk(w, token))");
  js = once(js, "workers/manager.js", "            AGENT_OFFICE_HOOK_TOKEN: w.hookToken,\n        });\n",
    "            AGENT_OFFICE_HOOK_TOKEN: w.hookToken,\n        });\n        w.hookHash = undefined;\n");
  return "import { __rbHookOk } from './util.js';\n" + js;
}

function once(s: string, rel: string, from: string, to: string) {
  if (s.split(from).length !== 2) throw new Error(`Agent Office changed: patch target moved in ${rel}: ${from}`);
  return s.replace(from, () => to);
}
