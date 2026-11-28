// The Stage Builder's builds and orders on your eqosys account (#6583): signed in, what the account keeps comes here
// and each change goes back (account-sync.ts), so a build made on a laptop opens on a phone. What this browser has that
// the account never got (made signed out or offline) is added to it rather than lost.
import { accountSync } from "./account-sync.ts";
import { mergeStores, shelf, StageReply, type Shelf, type Store } from "./stage-build.ts";

/** Set (to the owner key) while the account has all this browser has. */
export const ON_ACCOUNT = "qollab-studio:stage-builds:on-account";

export function stageAccount(origin: string, token: () => string | null, first: Store, storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, wait?: number) {
  const sync = accountSync<StageReply, Shelf>(`${origin}/stage-builds`, StageReply, token, wait);
  const text = (s: Store) => JSON.stringify(shelf(s));
  let owner: string | null = null;
  let has = text(first);
  // a browser that won't keep things merges every time, which loses nothing
  const mark = (on: string | null) => { try { if (on) storage.setItem(ON_ACCOUNT, on); else storage.removeItem(ON_ACCOUNT); } catch { /* private window */ } };
  const marked = () => { try { return storage.getItem(ON_ACCOUNT); } catch { return null; } };
  const send = (s: Store) => { const who = owner; if (who) sync.push(shelf(s), () => mark(who)); };
  return {
    /** After every change here: opening or closing a build is no change to what is kept. */
    keep(s: Store) {
      const now = text(s);
      if (now === has) return;
      has = now;
      mark(null);
      send(s);
    },
    /** Signed in: the store this browser should have now (`current` is read once the account answers), or null. */
    async follow(current: () => Store): Promise<Store | null> {
      const got = await sync.pull();
      if (!got) return null;
      owner = got.owner;
      const mine = current();
      // the account had everything here: what it keeps now is the truth, thrown-away orders included
      const next = mergeStores(marked() ? { ...mine, builds: [], orders: [] } : mine, got.store);
      has = text(next);
      if (has === JSON.stringify(got.store)) mark(owner);
      else { mark(null); send(next); }
      return next;
    },
  };
}
