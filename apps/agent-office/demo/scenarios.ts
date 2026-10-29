// The demo stage's scenarios: each is a state of the office the owner would otherwise have to reach by hand (a
// GitHub sign-in, a worker asking to push, Ester halfway through a run). Plain data: stage.ts builds the world from it.
import type { Screen } from "../screens/read.ts";

export type WorkerState = "working" | "idle" | "asking";
export interface DemoWorker { name: string; state: WorkerState; task: string }
export interface Account { login: string; /** false: GitHub no longer accepts its token, so Test turns the light red */ good: boolean; access?: "read" | "write" }
export interface Run { phase: "idle" | "running" | "green" | "red"; /** seconds into the run when the page opens */ age?: number }

export interface Scenario {
  about: string;
  /** The MANUAL RUN issues this state stands in for. */
  serves: number[];
  workers: DemoWorker[];
  /** false: the office has no GitHub client id, so Connect GitHub is off. */
  signIn: boolean;
  accounts: Account[];
  /** A device code is waiting to be typed (the stage's "I typed the code" button does it). */
  waiting?: boolean;
  builder: "ok" | "down";
  grants: { repo: string; kind: string; who: string }[];
  /** The office runs in the box (Settings > You > Box): nothing saved yet (first run), `log` lines in its log, and the
   * box reaching `held`, a host off its allowlist, waits on a Deny / Always / Allow card. Docker is faked. */
  box?: { log: number; held?: string };
  /** A worker's `git push` is held on an Allow / Deny / Always card when the page opens. */
  ask?: { who: string; command: string };
  screens: Screen[];
  each?: boolean;
  keep?: boolean;
  ester: Run;
  mervin: Run;
  /** What the run ends as when someone clicks Ester or Mervin on the wall (they start fresh and take ~25 s). */
  esterEnds: "green" | "red";
}

const crew = (...states: WorkerState[]): DemoWorker[] =>
  [["Gizmo", "Wire the setup page"], ["Byte", "Fix the PR line"], ["Widget", "Draw the skate park"]].map(([name, task], i) => ({ name: name!, task: task!, state: states[i] ?? "idle" }));

const base: Scenario = {
  about: "", serves: [], workers: crew("working", "idle", "working"), signIn: true, accounts: [], builder: "ok", grants: [],
  screens: [], ester: { phase: "idle" }, mervin: { phase: "idle" }, esterEnds: "green",
};
const s = (about: string, serves: number[], over: Partial<Scenario>): Scenario => ({ ...base, about, serves, ...over });

export const SCENARIOS: Record<string, Scenario> = {
  "setup-first-run": s("Signed out: nothing connected, the three first-run steps show, Connect GitHub is on", [2513], {}),
  "setup-no-client-id": s("The office has no GitHub client id: Connect GitHub is off and says why", [2513], { signIn: false }),
  "setup-sign-in-code": s("A sign-in code is waiting; press 'I typed the code' on the stage and the account appears", [2513], { waiting: true }),
  "setup-signed-in": s("Signed in as one account: green light, read-only badge, Test and Revoke work, the build Mac is up", [2513], { accounts: [{ login: "octo-demo", good: true }] }),
  "setup-two-accounts": s("Two accounts side by side", [2513], { accounts: [{ login: "octo-demo", good: true }, { login: "second-demo", good: true }] }),
  "setup-test-red": s("One account whose token GitHub stopped accepting: Test turns it red, Revoke removes it", [2513], { accounts: [{ login: "octo-demo", good: true }, { login: "stale-demo", good: false }] }),
  "setup-builder-down": s("The build Mac does not answer: the card shows its one-line setup", [2513], { accounts: [{ login: "octo-demo", good: true }], builder: "down" }),
  "writes-ask-pending": s("Gizmo's git push is held on an Allow / Deny / Always card; Always lets the next push through and lists the grant", [2520, 2513], { ask: { who: "Gizmo", command: "git push origin office/gizmo-221a" }, workers: crew("asking", "working", "idle") }),
  "writes-grants": s("The GitHub writes card with two grants already allowed; add one with Allow always, then Revoke it", [2520], { grants: [{ repo: "QuinnsCode/RustyBuns", kind: "push", who: "*" }, { repo: "QuinnsCode/RustyBuns", kind: "comment", who: "Byte" }] }),
  "box-first-run": s("The office in the box, first run: the shield opens the set-up page, the scroll the whole log, and the box reaching a host off its list waits on Deny / Always / Allow", [2568], { box: { log: 40, held: "pypi.org" } }),
  "wall-gitpath": s("gitpath with open PRs as cars between open and main; click a car to open its PR", [2425, 2430], { screens: ["gitpath"], mervin: { phase: "green" }, ester: { phase: "green" } }),
  "wall-mervin": s("Mervin finished: conflicts avoided, file tiles, his running tally top right", [2430], { screens: ["gitpath", "mervin", "ester"], keep: true, mervin: { phase: "green" }, ester: { phase: "idle" } }),
  "wall-ester-running": s("Ester mid-run: the clock ticks and the PR blocks pulse (it finishes green after about two minutes)", [2425], { screens: ["gitpath", "mervin", "ester"], mervin: { phase: "green" }, ester: { phase: "running", age: 45 } }),
  "wall-ester-red": s("Ester ran PR by PR and #103 broke: the Cheap fix: Haiku button queues a task (shown on the stage)", [2430], { screens: ["gitpath", "mervin", "ester"], each: true, keep: true, mervin: { phase: "green" }, ester: { phase: "red" }, esterEnds: "red" }),
};

export const names = () => Object.keys(SCENARIOS);
export const isScenario = (n: string) => Object.hasOwn(SCENARIOS, n);

/** Short links for the states a MANUAL RUN lands in: `#setup=github-signin`, `#settings=grants`. */
export const HASHES: Record<string, string> = {
  "setup=github-signin": "setup-sign-in-code",
  "setup=signed-in": "setup-signed-in",
  "settings=grants": "writes-grants",
  "writes=ask": "writes-ask-pending",
  "settings=box": "box-first-run",
};

/** The scenario a link's hash asks for (`#setup=github-signin`, `#scenario=<name>`), or null. */
export function fromHash(hash: string): string | null {
  const h = hash.replace(/^#/, "");
  if (Object.hasOwn(HASHES, h)) return HASHES[h]!;
  const n = h.startsWith("scenario=") ? h.slice(9) : "";
  return isScenario(n) ? n : null;
}
