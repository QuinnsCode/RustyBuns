// The page half of Shared Sphere. The Worker serves this function's source as /__sphere/client.js, so it must stay
// self-contained: nothing from outside its body. It finds TerraViz's globe through the `window.app` TerraViz sets
// itself (its primary MapLibre map, its current dataset and its own loadDataset), joins the room and then:
//   - shows everyone else's pointer on the globe, in their colour;
//   - lets anyone take the lead; the others' globes follow the lead's camera and dataset;
//   - a follower who drags their own globe stops following, and one click picks the lead back up.

export function sphereClient(wsPath: string) {
  type Peer = { id: string; name: string; color: string };
  type Cam = { c: [number, number]; z: number; b: number; p: number };
  const q = new URLSearchParams(location.search);
  const room = q.get("room") || "lobby";
  const name = q.get("name") || "";
  const w = window as any;
  const findMap = () => w.app?.viewports?.getPrimary?.()?.map ?? null;
  const currentDs = (): string | null => w.app?.appState?.currentDataset?.id ?? null;

  let me: Peer | null = null;
  let lead: string | null = null;
  let following = true;
  let ws: WebSocket | null = null;
  let map: any = null;
  let sentDs: string | null = null;
  let loadingDs: string | null = null;
  let leadCam: Cam | null = null;
  let leadDs: string | null = null;
  const peers = new Map<string, { peer: Peer; c: [number, number] | null; el: HTMLDivElement }>();

  // --- the panel ---
  const panel = document.createElement("div");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Shared globe");
  panel.style.cssText = "position:fixed;left:56px;top:12px;z-index:2147483000;display:flex;gap:8px;align-items:center;" +
    "padding:6px 10px;border-radius:10px;background:rgba(15,23,42,.82);color:#f8fafc;font:13px/1.3 system-ui,sans-serif;" +
    "white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.35);max-width:calc(100vw - 68px)";
  const status = document.createElement("span");
  status.setAttribute("aria-live", "polite");
  status.style.cssText = "overflow:hidden;text-overflow:ellipsis";
  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText = "font:inherit;padding:3px 10px;border-radius:7px;border:1px solid #f97316;background:transparent;" +
    "color:#fdba74;cursor:pointer;min-height:28px";
  panel.append(status, button);

  const nameOf = (id: string | null) => (id && id === me?.id ? "you" : id ? peers.get(id)?.peer.name ?? "someone" : "");
  function render() {
    const here = peers.size + (me ? 1 : 0);
    const where = `${room} · ${here} here`;
    if (!ws || ws.readyState !== WebSocket.OPEN) { status.textContent = `Shared globe · ${room} · connecting`; button.hidden = true; return; }
    button.hidden = false;
    if (lead && lead === me?.id) { status.textContent = `${where} · you lead`; button.textContent = "Stop leading"; }
    else if (lead && following) { status.textContent = `${where} · following ${nameOf(lead)}`; button.textContent = "Stop following"; }
    else if (lead) { status.textContent = `${where} · ${nameOf(lead)} leads`; button.textContent = `Follow ${nameOf(lead)}`; }
    else { status.textContent = `${where} · nobody leads`; button.textContent = "Lead"; }
  }
  button.onclick = () => {
    if (lead && lead === me?.id) send({ t: "unlead" });
    else if (lead && following) following = false;
    else if (lead) { following = true; catchUp(); }
    else send({ t: "lead" });
    render();
  };

  // --- the wire ---
  function send(m: object) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }
  let backoff = 1000;
  function connect() {
    const u = new URL(wsPath, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("room", room);
    if (name) u.searchParams.set("name", name);
    ws = new WebSocket(u);
    ws.onopen = () => { backoff = 1000; render(); };
    ws.onclose = () => {
      for (const p of peers.values()) p.el.remove();
      peers.clear();
      me = null; lead = null; sentDs = null;
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
        me = m.you; lead = m.lead; leadCam = m.cam; leadDs = m.ds;
        for (const p of m.peers) addPeer(p);
        catchUp();
        break;
      case "join": addPeer(m); break;
      case "leave": peers.get(m.id)?.el.remove(); peers.delete(m.id); break;
      case "lead":
        lead = m.id;
        if (!lead) { leadCam = null; leadDs = null; }
        if (lead === me?.id) { sentDs = null; sendCam(); }
        else following = true;
        break;
      case "ptr": { const p = peers.get(m.from); if (p) { p.c = m.c; place(p); } break; }
      case "cam": leadCam = { c: m.c, z: m.z, b: m.b, p: m.p }; if (following) applyCam(leadCam, 150); break;
      case "ds": leadDs = m.id; if (following) applyDs(); break;
    }
    render();
  }

  // --- following ---
  let applying = false;
  function applyCam(c: Cam, duration: number) {
    if (!map || lead === me?.id) return;
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

  // TerraViz builds its globe after boot, and may swap it (a layout change makes a new primary), so look every second.
  const timer = setInterval(() => {
    const next = findMap();
    if (next && next !== map) {
      bind(next);
      if (!ws) { document.body.append(panel); render(); connect(); }
    }
    // the lead's dataset, as TerraViz's own state says it is
    if (lead && lead === me?.id) { const ds = currentDs(); if (ds !== sentDs) { sentDs = ds; send({ t: "ds", id: ds }); } }
  }, 1000);
  // no globe on this page (the publisher portal, the blog): stop looking after a minute
  setTimeout(() => { if (!map) clearInterval(timer); }, 60_000);
}
