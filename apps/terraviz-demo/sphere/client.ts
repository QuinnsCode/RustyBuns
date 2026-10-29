// The page half of Shared Sphere. The Worker serves this function's source as /__sphere/client.js, so it must stay
// self-contained: nothing from outside its body. It finds TerraViz's globe through the `window.app` TerraViz sets
// itself (its primary MapLibre map, its current dataset, its own loadDataset and tour engine), joins the room and then:
//   - shows everyone else's pointer on the globe, in their colour;
//   - lets anyone take the lead; the others' globes follow the lead's camera, dataset and tour;
//   - in a taught room (the teacher joined with ?teach=<word>) only the teacher leads, and a student's own tour
//     controls are put away, so a class watches one globe and nobody can steer the teacher's;
//   - a follower who drags their own globe stops following, and one click picks the lead back up;
//   - reads the running tour as slides ("3 of 9 · Arctic sea ice") with the Rust reader served beside it.

export type Jump = { dataset?: string; lon?: number; lat?: number; zoom?: number; bearing?: number; pitch?: number; lead?: boolean; tour?: string };

/** The state a link asks for (?dataset=sea-surface-temperature&lon=139.7&lat=35.7&zoom=3&lead=1&tour=three-places), or null
 *  when it asks for none. Passed into the client rather than imported, since the client's source is all the page gets. */
export function jumpFromSearch(search: string): Jump | null {
  const q = new URLSearchParams(search), j: Jump = {};
  const num = (k: string, lo: number, hi: number) => {
    const v = q.get(k);
    return v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : undefined;
  };
  const ds = q.get("dataset")?.trim();
  if (ds && ds.length <= 80) j.dataset = ds;
  const tour = q.get("tour")?.trim();
  if (tour && tour.length <= 512) j.tour = tour;
  for (const [k, lo, hi] of [["lon", -180, 180], ["lat", -85, 85], ["zoom", 0, 22], ["bearing", -180, 180], ["pitch", 0, 85]] as const) {
    const v = num(k, lo, hi);
    if (v !== undefined) j[k] = v;
  }
  if (["1", "true"].includes(q.get("lead") ?? "")) j.lead = true;
  return Object.keys(j).length ? j : null;
}

export type Paths = { ws: string; glue: string; wasm: string; tours: string };

export function sphereClient(paths: Paths, parseJump: (search: string) => Jump | null) {
  type Peer = { id: string; name: string; color: string; teacher: boolean };
  type Cam = { c: [number, number]; z: number; b: number; p: number };
  type TourState = "playing" | "paused" | "stopped";
  type Tour = { url: string | null; i: number; state: TourState };
  type Slide = { first: number; last: number; title: string; dataset: string | null; lat: number | null; lon: number | null; hold: number | null };
  const q = new URLSearchParams(location.search);
  const room = q.get("room") || "lobby";
  const name = q.get("name") || "";
  const teach = q.get("teach") || "";
  const w = window as any;
  const findMap = () => w.app?.viewports?.getPrimary?.()?.map ?? null;
  const currentDs = (): string | null => w.app?.appState?.currentDataset?.id ?? null;
  const engine = () => w.app?.tourEngine ?? null;

  let me: Peer | null = null;
  let lead: string | null = null;
  let locked = false;
  let following = true;
  let ws: WebSocket | null = null;
  let map: any = null;
  let sentDs: string | null = null;
  let loadingDs: string | null = null;
  let leadCam: Cam | null = null;
  let leadDs: string | null = null;
  let leadTour: Tour | null = null;
  const peers = new Map<string, { peer: Peer; c: [number, number] | null; el: HTMLDivElement }>();

  // --- the panel ---
  const panel = document.createElement("div");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Shared globe");
  // one line on a laptop; on a phone the buttons drop under the words rather than fall off the edge
  panel.style.cssText = "position:fixed;left:56px;top:12px;z-index:2147483000;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;" +
    "padding:6px 10px;border-radius:10px;background:rgba(15,23,42,.82);color:#f8fafc;font:13px/1.3 system-ui,sans-serif;" +
    "box-shadow:0 2px 10px rgba(0,0,0,.35);max-width:calc(100vw - 68px)";
  const status = document.createElement("span");
  status.setAttribute("aria-live", "polite");
  status.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%";
  const slide = document.createElement("span");
  slide.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:#fdba74";
  const BTN = "font:inherit;padding:3px 10px;border-radius:7px;border:1px solid #f97316;background:transparent;color:#fdba74;cursor:pointer;min-height:28px";
  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText = BTN;
  const unlock = document.createElement("button");
  unlock.type = "button";
  unlock.textContent = "Open room";
  unlock.title = "Let anyone lead again";
  unlock.style.cssText = BTN;
  panel.append(status, slide, button, unlock);

  const nameOf = (id: string | null) => {
    if (!id) return "";
    if (id === me?.id) return "you";
    const p = peers.get(id)?.peer;
    return p ? `${p.name}${p.teacher ? " (teacher)" : ""}` : "someone";
  };
  function render() {
    const here = peers.size + (me ? 1 : 0);
    const where = `${room} · ${here} here`;
    if (!ws || ws.readyState !== WebSocket.OPEN || !me) { status.textContent = `Shared globe · ${room} · connecting`; button.hidden = true; unlock.hidden = true; slide.hidden = true; return; }
    const iLead = lead === me.id, student = locked && !me.teacher;
    button.hidden = student && !lead;
    unlock.hidden = !(locked && me.teacher);
    if (iLead) { status.textContent = `${where} · you lead${locked ? " · room locked" : ""}`; button.textContent = "Stop leading"; }
    else if (lead && following) { status.textContent = `${where} · following ${nameOf(lead)}`; button.textContent = student ? "Look around" : "Stop following"; }
    else if (lead) { status.textContent = `${where} · ${nameOf(lead)} leads`; button.textContent = `Follow ${nameOf(lead).split(" ")[0]}`; }
    else { status.textContent = `${where} · nobody leads${student ? " · waiting for the teacher" : ""}`; button.textContent = "Lead"; }
    const s = slideNow();
    slide.hidden = !s;
    slide.textContent = s ? `· slide ${s.n} of ${s.of}${s.title ? ` · ${s.title}` : ""}` : "";
  }
  button.onclick = () => {
    if (lead && lead === me?.id) send({ t: "unlead" });
    else if (lead && following) following = false;
    else if (lead) { following = true; catchUp(); }
    else send({ t: "lead" });
    render();
  };
  unlock.onclick = () => send({ t: "open" });

  // --- the wire ---
  function send(m: object) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }
  let backoff = 1000;
  function connect() {
    const u = new URL(paths.ws, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("room", room);
    if (name) u.searchParams.set("name", name);
    if (teach) u.searchParams.set("teach", teach);
    ws = new WebSocket(u);
    ws.onopen = () => { backoff = 1000; render(); };
    ws.onclose = () => {
      for (const p of peers.values()) p.el.remove();
      peers.clear();
      me = null; lead = null; sentDs = null; sentTour = "";
      render();
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* one bad frame is not the room */ } };
  }

  function addPeer(peer: Peer) {
    if (peer.id === me?.id || peers.has(peer.id)) return;
    const el = document.createElement("div");
    el.title = peer.name;
    el.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;display:none;z-index:5;transform:translate(-50%,-50%);` +
      `font:600 11px system-ui,sans-serif;color:#fff;white-space:nowrap`;
    el.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #fff;` +
      `background:${peer.color};vertical-align:middle"></span> <span style="background:${peer.color};padding:1px 5px;` +
      `border-radius:4px;vertical-align:middle"></span>`;
    (el.lastElementChild as HTMLElement).textContent = peer.name;
    map?.getContainer().append(el);
    peers.set(peer.id, { peer, c: null, el });
  }

  function onMessage(m: any) {
    switch (m.t) {
      case "hello":
        me = m.you; lead = m.lead; leadCam = m.cam; leadDs = m.ds; leadTour = m.tour; locked = !!m.locked;
        for (const p of m.peers) addPeer(p);
        catchUp();
        break;
      case "join": addPeer(m); break;
      case "leave": peers.get(m.id)?.el.remove(); peers.delete(m.id); break;
      case "lead":
        lead = m.id;
        if (!lead) { leadCam = null; leadDs = null; leadTour = null; }
        if (lead === me?.id) { sentDs = null; sentTour = ""; sendCam(); }
        else following = true;
        break;
      case "locked": locked = !!m.locked; break;
      case "ptr": { const p = peers.get(m.from); if (p) { p.c = m.c; place(p); } break; }
      case "cam": leadCam = { c: m.c, z: m.z, b: m.b, p: m.p }; if (following) applyCam(leadCam, 150); break;
      case "ds": leadDs = m.id; if (following) applyDs(); break;
      case "tour": leadTour = m.tour; if (following) applyTour(); break;
    }
    render();
  }

  // --- following ---
  let applying = false;
  function applyCam(c: Cam, duration: number) {
    if (!map || lead === me?.id || engine()) return; // a running tour drives the camera itself
    applying = true;
    map.easeTo({ center: c.c, zoom: c.z, bearing: c.b, pitch: c.p, duration, easing: (t: number) => t });
    applying = false;
  }
  function applyDs() {
    if (!leadDs || lead === me?.id || leadDs === currentDs() || leadDs === loadingDs || !w.app?.loadDataset) return;
    loadingDs = leadDs;
    Promise.resolve(w.app.loadDataset(leadDs, "url")).catch(() => {}).finally(() => { loadingDs = null; });
  }
  function catchUp() {
    if (!lead || lead === me?.id || !following) return;
    if (leadCam) applyCam(leadCam, 0);
    applyDs();
    applyTour();
  }

  // --- tours: TerraViz's own engine on every globe, kept in step with the lead's ---
  let tourUrl: string | null = null;     // the script we started ourselves, for this engine
  let tourEngine: unknown = null;        // the engine tourUrl belongs to
  let starting: string | null = null;    // a playTour in flight
  let sentTour = "";
  let idleTicks = 0, lastIndex = -1;
  /** The running tour's address: a catalog tour's own link, or the one we started it from. */
  function tourUrlNow(): string | null {
    const e = engine();
    if (!e) return null;
    const d = w.app?.appState?.currentDataset;
    if (d?.format === "tour/json") return d.tourJsonUrl ?? d.dataLink ?? null;
    return e === tourEngine ? tourUrl : null;
  }
  function playTour(url: string) {
    if (!w.app?.playTour || starting === url) return;
    starting = url;
    Promise.resolve(w.app.playTour(url)).catch(() => {}).finally(() => { starting = null; tourUrl = url; tourEngine = engine(); });
  }
  function applyTour() {
    if (!lead || lead === me?.id || !following) return;
    const want = leadTour, e = engine();
    if (!want) { if (e && w.app?.stopTour) w.app.stopTour(); return; }
    if (!e || (want.url && tourUrlNow() !== want.url)) { if (want.url) playTour(want.url); return; }
    // the same script: step to the lead's task, one pause at a time, then match play and pause
    const settled = e.state === "paused" || idleTicks >= 2;
    if (e.currentIndex < want.i && settled) { e.next(); if (e.state === "paused") void e.play(); return; }
    if (e.currentIndex > want.i && settled) { e.prev(); if (e.state === "paused") void e.play(); return; }
    if (want.state === "paused" && e.state === "playing") e.pause();
    else if (want.state === "playing" && e.state === "paused" && e.currentIndex === want.i) void e.play();
  }
  // the slides of the running tour, read by the Rust reader (wasm) the Worker serves beside this script
  let outline: ((json: string) => string) | null = null;
  let slides: Slide[] | null = null, slidesFor: string | null = null, issues: string[] = [];
  import(paths.glue).then(async (g) => { await g.default({ module_or_path: paths.wasm }); outline = g.outline; }).catch(() => {});
  async function readSlides(url: string) {
    slidesFor = url; slides = null;
    try {
      const text = await (await fetch(url)).text();
      if (!outline || slidesFor !== url) return;
      const o = JSON.parse(outline(text));
      slides = o.slides; issues = o.issues.map((i: { what: string }) => i.what);
      if (issues.length) console.info(`[sphere] tour ${url}: ${issues.join("; ")}`);
    } catch { slides = null; }
  }
  function slideNow(): { n: number; of: number; title: string } | null {
    const e = engine();
    if (!e || !slides?.length) return null;
    let k = slides.findIndex((s) => e.currentIndex <= s.last);
    if (k < 0) k = slides.length - 1;
    return { n: k + 1, of: slides.length, title: slides[k]!.title };
  }

  // --- leading and pointing ---
  let lastCam = 0, lastPtr = 0;
  function sendCam() {
    if (!map || lead !== me?.id) return;
    const c = map.getCenter();
    send({ t: "cam", c: [c.lng, c.lat], z: map.getZoom(), b: map.getBearing(), p: map.getPitch() });
  }
  const onMove = () => { const now = performance.now(); if (now - lastCam > 100) { lastCam = now; sendCam(); } placeAll(); };
  const onMoveStart = (e: any) => {
    // a follower's own drag or wheel: they want to look around, so let go of the lead
    if (e?.originalEvent && !applying && lead && lead !== me?.id && following) { following = false; render(); }
  };
  const onPointer = (e: any) => {
    const now = performance.now();
    if (now - lastPtr < 50) return;
    lastPtr = now;
    send({ t: "ptr", c: [e.lngLat.lng, e.lngLat.lat] });
  };
  const onOut = () => send({ t: "ptr", c: null });

  // A pointer on the far side of the globe is hidden: further than ~85 degrees from the centre of the view.
  function place(p: { c: [number, number] | null; el: HTMLDivElement }) {
    if (!map || !p.c) { p.el.style.display = "none"; return; }
    const ctr = map.getCenter(), rad = Math.PI / 180;
    const cos = Math.sin(ctr.lat * rad) * Math.sin(p.c[1] * rad) +
      Math.cos(ctr.lat * rad) * Math.cos(p.c[1] * rad) * Math.cos((p.c[0] - ctr.lng) * rad);
    const pt = map.project(p.c);
    const box = map.getContainer().getBoundingClientRect();
    const show = cos > Math.cos(85 * rad) && pt.x >= 0 && pt.y >= 0 && pt.x <= box.width && pt.y <= box.height;
    p.el.style.display = show ? "block" : "none";
    if (show) p.el.style.transform = `translate(${pt.x}px,${pt.y}px) translate(-6px,-6px)`;
  }
  function placeAll() { for (const p of peers.values()) place(p); }

  function bind(next: any) {
    if (map) for (const [ev, f] of HANDLERS) map.off(ev, f);
    map = next;
    for (const [ev, f] of HANDLERS) map.on(ev, f);
    const box = map.getContainer();
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    for (const p of peers.values()) box.append(p.el);
    catchUp();
  }
  const HANDLERS: Array<[string, (e: any) => void]> = [["move", onMove], ["movestart", onMoveStart], ["mousemove", onPointer], ["mouseout", onOut]];

  // --- jump to a state: a link or window.sphere.jump({dataset, lon, lat, zoom, lead, tour}), one setter for both ---
  const tourAddress = (t: string) => (/^(\/|https?:)/.test(t) ? t : `${paths.tours}/${t}.json`);
  function jump(j: Jump | null) {
    if (!j) return false;
    if (j.dataset && w.app?.loadDataset) Promise.resolve(w.app.loadDataset(j.dataset, "url")).catch(() => {});
    if (map && (j.lon !== undefined || j.lat !== undefined || j.zoom !== undefined || j.bearing !== undefined || j.pitch !== undefined)) {
      const c = map.getCenter();
      map.jumpTo({
        center: [j.lon ?? c.lng, j.lat ?? c.lat], zoom: j.zoom ?? map.getZoom(),
        bearing: j.bearing ?? map.getBearing(), pitch: j.pitch ?? map.getPitch(),
      });
    }
    if (j.lead && !(lead && lead === me?.id)) { following = true; send({ t: "lead" }); }
    if (j.tour) playTour(tourAddress(j.tour));
    return true;
  }
  w.sphere = {
    jump,
    /** Play a tour script here (and, when you lead, on every follower's globe): a name from content/, a path or a URL. */
    tour: (t: string) => playTour(tourAddress(t)),
    /** The demo tours the Worker carries: [{ name, title, url }]. */
    tours: () => fetch(`${paths.tours}.json`).then((r) => r.json()),
    /** The running tour as the Rust reader sees it, and what it found wrong. */
    slides: () => ({ url: slidesFor, slides, issues }),
    state: () => {
      const e = engine(), s = slideNow();
      return {
        room, dataset: currentDs(), lead: lead !== null && lead === me?.id, here: peers.size + (me ? 1 : 0),
        locked, teacher: !!me?.teacher, following: !!lead && lead !== me?.id && following,
        tour: e ? { url: tourUrlNow(), i: e.currentIndex, state: e.state, slide: s?.n ?? null, of: s?.of ?? null } : null,
      };
    },
  };
  let pending = parseJump(location.search);

  // TerraViz builds its globe after boot, and may swap it (a layout change makes a new primary), so look every second.
  const timer = setInterval(() => {
    const next = findMap();
    if (next && next !== map) {
      bind(next);
      if (!ws) { document.body.append(panel); render(); connect(); }
    }
    // the link's state lands once, when the globe, TerraViz's loader and the room are all there
    if (pending && map && w.app?.loadDataset && me) { const j = pending; pending = null; jump(j); }
    // the lead's dataset, as TerraViz's own state says it is
    if (lead && lead === me?.id) { const ds = currentDs(); if (ds !== sentDs) { sentDs = ds; send({ t: "ds", id: ds }); } }
  }, 1000);
  // tours move faster than a second: the lead reports the engine, followers keep up, and a student's strip stays away
  const tourTimer = setInterval(() => {
    const e = engine();
    const i = e ? e.currentIndex : -1;
    idleTicks = i === lastIndex ? idleTicks + 1 : 0;
    lastIndex = i;
    const url = tourUrlNow();
    if (url && url !== slidesFor) void readSlides(url);
    if (!e) { slides = null; slidesFor = null; }
    if (me && lead === me.id) {
      const t: Tour = e ? { url, i: e.currentIndex, state: e.state } : { url: null, i: 0, state: "stopped" };
      const s = JSON.stringify(t);
      if (s !== sentTour) { sentTour = s; send({ t: "tour", ...t }); }
    } else if (me && lead && following) applyTour();
    const strip = document.getElementById("tour-controls");
    if (strip) strip.style.visibility = locked && me && !me.teacher ? "hidden" : "";
    if (e || !slide.hidden) render();
  }, 250);
  // no globe on this page (the publisher portal, the blog): stop looking after a minute
  setTimeout(() => { if (!map) { clearInterval(timer); clearInterval(tourTimer); } }, 60_000);
}
