// Tour the website: a spotlight on one element and a card that says what it is, step by step,
// across pages. The state lives in sessionStorage so a step can send you to /demo or /app and
// pick up there. Start with any [data-tour-start] button or ?tour=1; Escape ends it.

interface Step { at: string; title: string; body: string; go?: string; wait?: number }

const STEPS: Step[] = [
  { at: "#hero .copy", title: "A CRM your agents can use", body: "The wave is a Rust program compiled to wasm, drawing pixels in your browser. The words around it are plain HTML, so search engines read the pitch." },
  { at: "#edge .grid", title: "What a CRM doesn't offer", body: "MCP for agents, a Rust engine for analysis, a free desktop app, office sync, signed webhooks, hashed orgs. Each card is a thing that ships today." },
  { at: "#mcp", title: "Two lines to connect Claude", body: "An owner mints a key, pastes one command, and every API operation is a tool. Risky ones say so." },
  { at: "#cta-demo", title: "Now the real thing", body: "The demo is the site inside the site: a throwaway org with 2,000 contacts. Let's go.", go: "/demo" },
  { at: "#demo-frame", title: "The site, inside the site", body: "That banner is honest: this frame is a real qCRM org on a throwaway account. The frame is loading your demo; give it a moment, then open it full-screen for the rest of the tour.", go: "/app?demo=1&tour=1", wait: 2500 },
  { at: "[data-tour=search]", title: "Snappy, on purpose", body: "Type a name. Each page is one keyset query on D1 with the org id in the WHERE; the ms counter next to the box is the round trip to the edge." },
  { at: "[data-tour=nav-engine]", title: "The Rust engine", body: "Dedupe, forecast and stale-deal sweeps run in wasm in this tab. Rows come down, analysis stays here." },
  { at: "[data-tour=nav-settings]", title: "Settings: members, agents, webhooks, your data", body: "Roles that match a real place, API keys for MCP, signed webhooks, export every row, delete everything. That's the tour. Thanks for riding it." },
];

const KEY = "qcrm-tour";
const read = (): { i: number } | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; } };
const save = (s: { i: number } | null) => { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch {} };

let dim: HTMLDivElement | undefined, hole: HTMLDivElement | undefined, card: HTMLDivElement | undefined, keep: MutationObserver | undefined;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

function end() {
  save(null);
  keep?.disconnect(); keep = undefined;
  dim?.remove(); card?.remove();
  dim = hole = card = undefined;
  document.removeEventListener("keydown", onKey);
}
const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); };

function step(d: number) {
  const s = read(); if (!s) return;
  const i = s.i + d;
  if (i < 0) return;
  if (i >= STEPS.length) return end();
  save({ i });
  const cur = STEPS[s.i]!;
  if (d > 0 && cur.go && !location.pathname.startsWith(cur.go.split("?")[0]!)) { location.href = cur.go; return; }
  show();
}

function show(tries = 0) {
  const s = read(); if (!s) return;
  const st = STEPS[s.i]!;
  const target = document.querySelector<HTMLElement>(st.at);
  // Under 760 px the rail items are hidden behind the menu button: spotlight the button instead of a 0x0 box.
  const el = target && !target.getClientRects().length ? document.querySelector<HTMLElement>(".rail .menu-btn") ?? target : target;
  // Pages render in steps (the demo frame signs in first); wait for the target up to ~8 s.
  if (!el) { if (tries < 40) setTimeout(() => show(tries + 1), 200); return; }
  if (!dim) {
    const d = make("div", { className: "tour-dim" }), h = make("div", { className: "hole" }), c = make("div", { className: "tour-card", role: "dialog" });
    // appendChild, not append: Bun's HTMLRewriter types shadow the DOM's Element.append under "types": ["bun"].
    d.appendChild(h);
    document.body.appendChild(d);
    document.body.appendChild(c);
    dim = d; hole = h; card = c;
    document.addEventListener("keydown", onKey);
    addEventListener("resize", () => place(), { passive: true });
    // Hydration and dev-server HMR can strip nodes appended to body; put the tour back while it is running.
    keep = new MutationObserver(() => {
      if (!read()) return;
      if (dim && !dim.isConnected) document.body.appendChild(dim);
      if (card && !card.isConnected) document.body.appendChild(card);
    });
    keep.observe(document.body, { childList: true });
  }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  card!.innerHTML = "";
  const tag = make("span", { className: "tag", textContent: `Tour · ${s.i + 1} of ${STEPS.length}` });
  const h = make("h3", { textContent: st.title });
  const p = make("p", { textContent: st.body });
  const row = make("div", { className: "row" });
  const back = make("button", { type: "button", textContent: "Back", disabled: s.i === 0, onclick: () => step(-1) });
  const skip = make("button", { type: "button", textContent: "End tour", onclick: end });
  const next = make("button", { type: "button", className: "primary", textContent: s.i === STEPS.length - 1 ? "Done" : st.go ? "Go" : "Next", onclick: () => step(1) });
  for (const b of [back, skip, next]) row.appendChild(b);
  for (const n of [tag, h, p, row]) card!.appendChild(n);
  const place = () => {
    const r = el.getBoundingClientRect();
    Object.assign(hole!.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    // A rail item sits beside the table: put the card to its right, not over the rows under it.
    if (el.closest(".rail") && r.right + 12 + card!.offsetWidth < innerWidth) {
      Object.assign(card!.style, { top: `${Math.min(Math.max(12, r.top), innerHeight - card!.offsetHeight - 12)}px`, left: `${r.right + 12}px` });
      return;
    }
    const below = r.bottom + 12 + card!.offsetHeight < innerHeight;
    Object.assign(card!.style, { top: `${below ? r.bottom + 12 : Math.max(12, r.top - card!.offsetHeight - 12)}px`, left: `${Math.min(Math.max(16, r.left), innerWidth - card!.offsetWidth - 16)}px` });
  };
  setTimeout(place, 350);
  place();
  if (st.wait) setTimeout(() => { if (read()?.i === s.i) place(); }, st.wait);
}

export function mountTour() {
  if (typeof document === "undefined") return;
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest?.("[data-tour-start]")) { save({ i: 0 }); show(); }
  });
  const q = new URLSearchParams(location.search);
  if (q.get("tour") === "1" && !read()) save({ i: location.pathname.startsWith("/app") ? 5 : 0 });
  if (read()) show();
  // A bfcache restore or a late reload brings the page back without running this module again.
  addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted && read() && !dim?.isConnected) { dim = hole = card = undefined; show(); } });
}
