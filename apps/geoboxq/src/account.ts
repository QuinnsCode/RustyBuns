// Signing in through eqosys, page side: the shared client (@rustybuns/util/eqosys) with this app's id.
// GeoBoxQ keeps everything in the browser and its Worker has no notion of who is asking, so signing in
// only gives the page a name to show; the token is kept for when something server-side needs one.
import { eqosys } from "@rustybuns/util/eqosys";

/** This app's id in eqosys's APPS. */
export const APP = "geoboxq";
export const EQOSYS = "https://eqosys.qntbr.com";
/** The origin eqosys sends people back to. A local page or the desktop build stays signed out. */
export const SIGN_IN_FROM = ["https://geoboxq.qntbr.com"];

export const { signIn, finishSignIn, login, signOut, canSignIn } = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "geoboxq" });

// Lucide log-in / log-out, inline like the rest of the page's icons.
const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const LOG_IN = svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>');
const LOG_OUT = svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Fills `el` with the person's eqosys name and a way out, or a way in where eqosys can send them back. */
export function mountAccount(el: HTMLElement, note = ""): void {
  const who = login();
  const out = (label: string, glyph: string, act: string) => `<button class="icon" data-act="${act}" title="${label}" aria-label="${label}">${glyph}</button>`;
  el.innerHTML = who ? `<span class="who">${esc(who.name)}</span>${out("Sign out", LOG_OUT, "sign-out")}` : canSignIn() ? out("Sign in", LOG_IN, "sign-in") : "";
  if (note) el.insertAdjacentHTML("beforeend", `<small class="err">${esc(note)}</small>`);
  el.querySelector('[data-act="sign-in"]')?.addEventListener("click", () => void signIn());
  el.querySelector('[data-act="sign-out"]')?.addEventListener("click", () => { signOut(); mountAccount(el); });
}
