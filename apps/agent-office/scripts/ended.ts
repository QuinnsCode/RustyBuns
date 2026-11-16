// #4663: a worker whose agent process died with no exit heard stayed `done` at its desk, and a prompt typed to it was
// written into a terminal nobody reads. The worker manager now checks the process (live/ended.ts, built to
// server/rb-ended.js) before it types, on a keystroke, and every 10 s: a gone one ends its session as an exit would.
// A prompt then wakes it with that prompt, from a desk as from `office-workers tell`, instead of being lost.
import { once } from "./once.ts";

const NOT_RUNNING = "        if (!w.pty)\n            return 'Worker is not running';\n";

/** server/workers/manager.js: `__rbReap(w)`, called before a prompt or a key is typed and on the 10 s scan. */
export function endedManager(js: string) {
  const rel = "workers/manager.js";
  js = once(js, rel, NOT_RUNNING, "        this.__rbReap(w);\n" + NOT_RUNNING);
  js = once(js, rel, "        if (!w.pty)\n            return;\n        w.pty.write(data);\n",
    "        this.__rbReap(w);\n        if (!w.pty)\n            return;\n        w.pty.write(data);\n");
  js = once(js, rel, "                this.scanUsage(w);\n                this.worktrees.watchFolder(w);\n",
    "                this.scanUsage(w);\n                this.worktrees.watchFolder(w);\n                this.__rbReap(w);\n");
  js = once(js, rel, "    startFailed(w, message) {\n",
    "    /** Its process is gone but no exit was heard (#4663): the session ends here as an exit ends it. True when it did. */\n" +
    "    __rbReap(w) {\n" +
    "        const proc = w.pty;\n" +
    "        if (!proc || !__rbGone(proc.pid))\n            return false;\n" +
    "        w.pty = undefined;\n" +
    "        try {\n            proc.kill();\n        }\n        catch {\n            // already gone\n        }\n" +
    "        const { info } = w;\n" +
    "        info.exitCode = -1;\n" +
    "        clockWork(info, 'exited');\n" +
    "        info.status = 'exited';\n" +
    "        info.activity = 'Session ended';\n" +
    "        const hint = info.kind === 'shell' ? ' — press R to restart' : info.sessionId ? ' — press R to resume, or send it a prompt' : '';\n" +
    "        const msg = `\\r\\n\\x1b[2m[${info.name}'s session ended${hint}]\\x1b[0m\\r\\n`;\n" +
    "        w.term?.write(msg);\n" +
    "        if (w.viewers.size)\n            this.events.data(info.id, msg, [...w.viewers.keys()]);\n" +
    "        w.screenDirty = true;\n        w.unsaved = true;\n" +
    "        this.events.toast(`${info.name}'s session had ended`, 'warn');\n" +
    "        this.emitUpdate(w);\n        this.persist();\n" +
    "        return true;\n    }\n    startFailed(w, message) {\n");
  return "import { gone as __rbGone } from '../rb-ended.js';\n" + js;
}

/** server/ws/handlers/workers.js: a prompt typed at a desk whose agent isn't running wakes it with that prompt, as a told one does. */
export function endedClicks(js: string) {
  return once(js, "ws/handlers/workers.js",
    "        const err = w ? w.floor.workers.prompt(w.wid, str(msg.prompt, 20000), who) : 'No such worker';\n",
    "        let err = w ? w.floor.workers.prompt(w.wid, str(msg.prompt, 20000), who) : 'No such worker';\n" +
    "        // #4663: asleep, or its session ended: it wakes up with this as its next message, never drops it\n" +
    "        const __rbText = str(msg.prompt, 20000).replace(/\\r\\n?/g, '\\n').trim();\n" +
    "        if (err === 'Worker is not running' && w.info.kind === 'agent' && __rbText) {\n" +
    "            err = w.floor.workers.resume(w.wid, __rbText);\n" +
    "            if (!err) {\n" +
    "                w.info.lastInput = { by: who, at: Date.now() };\n" +
    "                ctx.sendTo(c, { t: 'toast', text: `${w.info.name} wasn't running: it is starting again with your prompt`, level: 'info' });\n" +
    "            }\n        }\n");
}
