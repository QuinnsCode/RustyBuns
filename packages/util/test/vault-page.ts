// The page vault.test.ts loads: a game's eqosys client against the stand-in eqosys named by ?eq=, started on load
// the way a game starts it (`finishSignIn` first).
import { eqosys } from "../src/eqosys.ts";
import { keptOf } from "../src/vault.ts";

// The stand-in eqosys, as a local eqosys is named (`<prefix>.eqosys`), so it outlives the trip to /login and back.
const named = new URLSearchParams(location.search).get("eq");
if (named) localStorage.setItem("g.eqosys", named);
const eq = eqosys({ app: "game", url: "https://eqosys.invalid", from: [location.origin], prefix: "g" });
const back = eq.finishSignIn();

/** What IndexedDB holds for this game, as plain facts a test can read. */
const kept = () => new Promise<unknown>((ok, no) => {
  const r = indexedDB.open("eqosys", 1);
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const q = r.result.transaction("kept", "readonly").objectStore("kept").get("g");
    q.onerror = () => no(q.error);
    q.onsuccess = () => { const k = keptOf(q.result); ok({ login: k.login, extractable: k.key?.privateKey.extractable ?? null }); };
  };
});

Object.assign(window, { t: { eq, back, kept, stored: () => JSON.stringify({ ...localStorage }) } });
