// What a page keeps on your eqosys account, the builder's parties (#5932) and the Stage Builder's builds (#6583): signed
// in, it is read from the Worker and each change goes back a moment later, so the same thing opens on another device.
// Signed out (or offline) it stays in this browser alone. Last write wins: two devices editing at once keep whichever
// saved last.
import { getJson } from "@rustybuns/util/http";
import type { Guard } from "@rustybuns/util/guard";

export interface AccountSync<Reply, Store> {
  /** What your account keeps, or null (signed out, or the Worker didn't answer). */
  pull(): Promise<Reply | null>;
  /** Save `store` to your account a moment from now (later calls replace it). `took`: the account has it now. */
  push(store: Store, took?: () => void): void;
}

/** `url` answers GET with `Reply` and takes the store by PUT. `token` gives a fresh eqosys token, or null while signed
 *  out. `wait`: how long a change sits before it is sent. */
export function accountSync<Reply, Store>(url: string, Reply: Guard<Reply>, token: () => string | null, wait = 800): AccountSync<Reply, Store> {
  const at = (t: string) => `${url}?token=${encodeURIComponent(t)}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  return {
    async pull() {
      const t = token();
      return t ? getJson(at(t), Reply) : null;
    },
    push(store, took) {
      const mine = ++latest;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = token();
        if (t) void fetch(at(t), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(store) })
          // an older save that lands after a newer change says nothing about what the account has now
          .then((r) => { if (r.ok && mine === latest) took?.(); }, () => {});
      }, wait);
    },
  };
}
