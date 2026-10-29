// A new EQOSYS_SIGNING_KEY: prints one EC P-256 private JWK. Paste it straight into 1Password
// (op://eqosys/signing-key/password) and deploy; apps pick the new kid up from /.well-known/jwks.json.
import { newKey } from "../src/token.ts";

console.log(await newKey());
