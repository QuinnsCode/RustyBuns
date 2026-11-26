// The builder's parties on your eqosys account (#5932): signed in, the store comes from the Worker's `/parties` and each
// change goes back a moment later, so the same party opens on another device. Signed out (or offline) it stays in this
// browser alone, as before. Last write wins: two devices editing at once keep whichever saved last.
import { getJson } from "@rustybuns/util/http";
import { PartiesReply, type Parties } from "./party.ts";

export interface PartySync {
  /** Your store on your account and your owner key, or null (signed out, or the Worker didn't answer). */
  pull(): Promise<PartiesReply | null>;
  /** Save `store` to your account a moment from now (later calls replace it). */
  push(store: Parties): void;
}

/** `token` gives a fresh eqosys token, or null while signed out. `wait`: how long a change sits before it is sent. */
export function partySync(origin: string, token: () => string | null, wait = 800): PartySync {
  const at = (t: string) => `${origin}/parties?token=${encodeURIComponent(t)}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    async pull() {
      const t = token();
      return t ? getJson(at(t), PartiesReply) : null;
    },
    push(store) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = token();
        if (t) void fetch(at(t), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(store) }).catch(() => {});
      }, wait);
    },
  };
}
