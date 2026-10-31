// The title screen. The intro starts at the top of the redwood and drifts down the trunk like a nature film, into
// the board and its trucks, then "SKATE TECH PARK" is skated in left to right and the menu opens. Any key or click
// skips to the menu; reduced motion goes straight there.
import { createElement, Flag, LogIn, LogOut, PawPrint, Route, Type, User, Users, ArrowLeft } from "lucide";
import "./front.css";
import { boardSvg, logoSvg } from "./logo.ts";
import { canSignIn, login, signIn, signOut } from "../eqosys.ts";
import { joinAddress, launch, type Party, type Play, PLAYS } from "./menu.ts";

const ICONS = { route: Route, paw: PawPrint, flag: Flag, letters: Type };
const icon = (node: Parameters<typeof createElement>[0], size = 20) => createElement(node, { width: size, height: size });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => Object.assign(document.createElement(tag), { className: cls, textContent: text });

const PAN_MS = 8000, HOLD_MS = 900, TITLE_MS = 1700;

export function mountFront(note = ""): void {
  const root = el("div", "front");
  document.body.append(root);

  const menu = () => {
    removeEventListener("keydown", skip);
    root.removeEventListener("pointerdown", skip);
    anims.forEach((a) => a.cancel());
    root.replaceChildren(menuScreen(note));
    root.classList.add("menu-open");
    root.querySelector<HTMLElement>("button")?.focus();
  };
  const anims: Animation[] = [];
  const skip = () => menu();

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return menu();

  // The stage: the logo, as tall as it is, with the camera drifting down it.
  const stage = el("div", "stage");
  stage.innerHTML = `${logoSvg("intro")}<div class="mist m1"></div><div class="mist m2"></div>`;
  const title = el("div", "title");
  const words = el("h1", "words", "SKATE TECH PARK");
  const roller = el("div", "rolls");
  roller.innerHTML = boardSvg();
  title.append(words, roller);
  const hint = el("p", "skip", "Any key to skip");
  root.append(el("div", "rays"), stage, title, hint);

  const view = () => {
    const svg = stage.querySelector("svg")!, h = svg.getBoundingClientRect().height;
    return { from: 0, to: -(h - innerHeight * 0.66) };
  };
  const { to } = view();
  const timing = { fill: "forwards" as const };
  anims.push(stage.animate([{ transform: "translateY(0)" }, { transform: `translateY(${to}px)` }], { duration: PAN_MS, delay: HOLD_MS, easing: "cubic-bezier(.45,.05,.4,1)", ...timing }));
  anims.push(root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900 }));

  // The board rolls in along the foot of the screen, uncovering the title behind it, with one hop at the middle.
  const at = PAN_MS + HOLD_MS - 300;
  anims.push(words.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: TITLE_MS, delay: at, easing: "cubic-bezier(.3,.1,.3,1)", fill: "both" }));
  anims.push(roller.animate([
    { left: "0%", transform: "translate(-100%, 0) rotate(0deg)", offset: 0 },
    { left: "50%", transform: "translate(-50%, 0) rotate(0deg)", offset: 0.45 },
    { left: "58%", transform: "translate(-50%, -34px) rotate(-14deg)", offset: 0.58 },
    { left: "66%", transform: "translate(-50%, 0) rotate(0deg)", offset: 0.72 },
    { left: "100%", transform: "translate(0%, 0) rotate(0deg)", offset: 1 },
  ], { duration: TITLE_MS, delay: at, easing: "cubic-bezier(.3,.1,.3,1)", fill: "both" }));
  anims.at(-1)!.finished.then(() => setTimeout(menu, 900)).catch(() => {});

  addEventListener("keydown", skip);
  root.addEventListener("pointerdown", skip);
}

/** Who is playing, then what. Choosing a play reloads the page on its address and the park picker takes over. */
function menuScreen(note: string): HTMLElement {
  const screen = el("div", "screen");
  const head = el("header", "head");
  head.innerHTML = logoSvg("menu");
  head.append(el("h1", "wordmark", "SKATE TECH PARK"));
  const body = el("div", "choices");
  screen.append(head, body, accountRow(note));

  const card = (label: string, blurb: string, glyph: Parameters<typeof createElement>[0], go: () => void, soon = false) => {
    const b = el("button", "choice");
    b.type = "button";
    b.disabled = soon;
    const text = el("span", "text");
    text.append(el("strong", "", label), el("small", "", soon ? `${blurb} Coming soon.` : blurb));
    b.append(icon(glyph, 26), text);
    b.addEventListener("click", go);
    return b;
  };
  const show = (...nodes: Node[]) => { body.replaceChildren(...nodes); body.querySelector("button")?.focus(); };
  const plays = (party: Party) => {
    const back = el("button", "back");
    back.type = "button";
    back.title = "Back";
    back.setAttribute("aria-label", "Back");
    back.append(icon(ArrowLeft, 18));
    back.addEventListener("click", start);
    const list = (PLAYS[party] as Play[]).map((p) => card(p.label, p.blurb, ICONS[p.icon], () => { location.search = launch(p); }, p.soon));
    const extra: Node[] = [];
    if (party === "multi") extra.push(joinRow());
    show(back, ...list, ...extra);
  };
  const joinRow = () => {
    const row = el("form", "join");
    const code = Object.assign(el("input"), { placeholder: "Room code", maxLength: 8, autocomplete: "off", spellcheck: false });
    const go = el("button", "", "Join");
    go.type = "submit";
    row.append(code, go);
    row.addEventListener("submit", (e) => { e.preventDefault(); const to = joinAddress(code.value); if (to) location.search = to; else code.setCustomValidity("4 to 8 letters or numbers"), code.reportValidity(); });
    code.addEventListener("input", () => code.setCustomValidity(""));
    return row;
  };
  function start() {
    show(card("Single", "Just you and the park.", User, () => plays("single")), card("Multi", "Skate with friends in a room.", Users, () => plays("multi")));
  }
  start();
  return screen;
}

/** Signed in, the rider's eqosys name shows with a way out; otherwise a way in, where eqosys can send them back. */
function accountRow(note: string): HTMLElement {
  const row = el("div", "account");
  const who = login();
  const button = (glyph: Parameters<typeof createElement>[0], label: string, go: () => void) => {
    const b = el("button", "back");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(icon(glyph, 18));
    b.addEventListener("click", go);
    return b;
  };
  if (who) row.append(el("span", "rider", who.name), button(LogOut, "Sign out", () => { signOut(); location.reload(); }));
  else if (canSignIn()) row.append(button(LogIn, "Sign in", () => void signIn()));
  if (note) row.append(el("small", "note", note));
  return row;
}
