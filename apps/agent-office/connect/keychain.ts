// Where the office keeps a GitHub token: the OS's own store (`@rustybuns/util/secrets`). That's the Mac's login keychain
// through `security`, so it doesn't matter how the office was started (gh's own keyring is out of reach from some
// shells, #2498), Credential Manager on Windows and the Secret Service on Linux. A box with no Secret Service keeps
// them in github-tokens.json beside the office's data, only this user can read it, and tokens kept there by an older
// office move into the Secret Service once it answers.
import { fileSecrets as fileStore, osSecrets, type Secrets } from "@rustybuns/util/secrets";

export type { Secrets };

export const SERVICE = "agent-office-github";
const FILE = "github-tokens";

export const fileSecrets = (dir: string): Secrets => fileStore(dir, FILE);

export const secretsFor = (dir: string, platform = process.platform): Secrets =>
  osSecrets(SERVICE, { fallbackDir: dir, fallbackName: FILE, platform });
