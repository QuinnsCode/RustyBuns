// #3167: a fresh worktree gets its `bun install` from the hire step, and the worker starts once it is done.
// #4470: until then the worker has no terminal, so a prompt told to it (`office-workers tell`, or one typed at its
// desk) found it "not running" and resumed it: a second Claude session in the same worktree, and the hire's own
// started on top when the install finished. Now a prompt sent in that window waits, and the one session starts with
// the hire's task and then each told prompt.
import { once } from "./once.ts";

const LAUNCH = "        this.launch(w, seat.station && info.prompt ? `${stationBrief(seat.station, this.prompts)}\\n\\n${info.prompt}` : info.prompt, undefined);\n";
const RESUME = "        if (w.pty || w.dsh)\n            return 'Worker is already running';\n        if (this.worktrees.checkLost(w, true))\n";
const RESUME_DOC = "    /** Starts a worker that isn't running again, carrying on its session, with `prompt` as its next message. */\n";

/** server/workers/manager.js: the hire installs first (`__rbBoot`), and `resume` while it does holds the prompt for it. */
export function installFirst(js: string) {
  const rel = "workers/manager.js";
  js = once(js, rel, LAUNCH,
    "        const __rbFirst = seat.station && info.prompt ? `${stationBrief(seat.station, this.prompts)}\\n\\n${info.prompt}` : info.prompt;\n" +
    "        if (worktree && !repos.length && wt?.path)\n" +
    "            this.__rbBoot(w, __rbFirst, path.join(this.trees.dir, wt.path));\n" +
    "        else\n            this.launch(w, __rbFirst, undefined);\n");
  js = once(js, rel, RESUME,
    "        if (w.pty || w.dsh)\n            return 'Worker is already running';\n" +
    "        // #4470: still installing; the session about to start takes this too\n" +
    "        if (w.__rbBooting) {\n" +
    "            const told = prompt?.trim();\n" +
    "            if (told) {\n                w.__rbBooting.push(told);\n                this.tasks.notePrompt(w, told);\n            }\n" +
    "            return undefined;\n        }\n" +
    "        if (this.worktrees.checkLost(w, true))\n");
  js = once(js, rel, RESUME_DOC,
    "    /** The worktree's bun install first (#3167), then the one session, with `first` and whatever was told meanwhile (#4470). */\n" +
    "    __rbBoot(w, first, dir) {\n" +
    "        w.__rbBooting = [];\n" +
    "        void __rbInstall(dir).then((why) => {\n" +
    "            if (why)\n                this.events.toast(`${w.info.name}'s bun install: ${why}`, 'warn');\n" +
    "            const told = w.__rbBooting ?? [];\n" +
    "            w.__rbBooting = undefined;\n" +
    "            if (this.workers.get(w.info.id) === w)\n" +
    "                this.launch(w, [first, ...told].filter(Boolean).join('\\n\\n') || undefined, undefined);\n" +
    "        });\n    }\n" + RESUME_DOC);
  return "import { installWorktree as __rbInstall } from '../rb-install.js';\n" + js;
}
