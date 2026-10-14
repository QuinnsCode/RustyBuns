// What a worker inherits from the office: its environment, less the secrets (#643).
//
// Agent Office's childEnv() hands every worker, shell and office-run `claude`/`gh` the office's whole environment,
// minus a few nested-session vars. Whatever the shell that started the office exported (a CLOUDFLARE_API_TOKEN, a
// GH_TOKEN, an OP_SERVICE_ACCOUNT_TOKEN, someone's LLM key) would reach every agent. Agents never hold secret values
// here: deploys resolve them through varlock at run time, behind Touch ID. So names that look like a secret are
// dropped: ..._TOKEN, ..._SECRET, ..._KEY, ..._PAT, ..._PASS, ..._AUTH, ..._DSN, ..._URL-shaped logins (and their plurals),
// anything with PASSWORD, PASSWD, SECRET, CREDENTIAL or WEBHOOK in it, 1Password's OP_..., and the handful of cloud
// and database names that end in something innocent (AWS_ACCESS_KEY_ID, DATABASE_URL, SSH_AUTH_SOCK: with the agent
// socket a worker pushes with your ssh keys). The agents' own sign-ins stay (AGENT_AUTH), and AGENT_OFFICE_ENV_PASS, comma separated, lets
// any other name through, e.g. AGENT_OFFICE_ENV_PASS=GH_TOKEN for a machine whose gh has no other login.

const SECRET = [
  /(^|_)(TOKEN|SECRET|KEY|APIKEY|PAT|PASS|PWD|PASSPHRASE|CREDENTIALS?|AUTH|JWT|BEARER|COOKIE|SESSION|DSN|URI|WEBHOOK(_URL)?|CONNECTION_STRING)S?$/i,
  /^TOKEN_|PASSWORD|PASSWD|SECRET|CREDENTIAL|PASSPHRASE|WEBHOOK|_AUTH_?TOKEN|AUTHTOKEN/i, /^OP_/i,
  // cloud and database logins under names that end in something innocent, and the sockets and files that hold a login
  /^(AWS_ACCESS_KEY_ID|GOOGLE_APPLICATION_CREDENTIALS|DATABASE_URL|REDIS_URL|MONGODB_URI|SSH_AUTH_SOCK|KUBECONFIG|DOCKER_CONFIG|NETRC|RB_JOIN|GPG_PASSPHRASE)$/i,
];

/** The coding agents' own auth: a worker can't start without it, and the office's sign-ins swap it per person. */
export const AGENT_AUTH = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "OPENAI_API_KEY", "CODEX_API_KEY", "CURSOR_API_KEY", "XAI_API_KEY",
];

/** Whether `name` looks like it holds a secret. */
// (the shell's own PWD and OLDPWD are paths, not passwords)
export const secretName = (name: string) => !/^(OLD)?PWD$/i.test(name) && SECRET.some((re) => re.test(name));

/** `env` without its secrets (changed in place, and returned), and the names it dropped. */
export function dropSecrets(env: Record<string, string | undefined>, from: Record<string, string | undefined> = process.env) {
  const pass = new Set([...AGENT_AUTH, ...(from.AGENT_OFFICE_ENV_PASS ?? "").split(",").map((n) => n.trim()).filter(Boolean)]);
  const dropped: string[] = [];
  for (const k of Object.keys(env)) {
    if (pass.has(k) || !secretName(k)) continue;
    delete env[k];
    dropped.push(k);
  }
  return { env, dropped };
}

let told = false;

/** For childEnv(): drops the secrets, and says once, in the office's log, which names it kept from the workers. */
export function workerEnv<T extends Record<string, string | undefined>>(env: T): T {
  const { dropped } = dropSecrets(env);
  if (dropped.length && !told) {
    told = true;
    console.log(`[env] kept from the workers: ${dropped.sort().join(", ")} (AGENT_OFFICE_ENV_PASS=NAME,... lets one through)`);
  }
  return env;
}
