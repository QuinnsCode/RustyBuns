// The guest list's default panel (./guests.ts): who is in and who brought them, open invites, the block list, the roles and
// what each may do, and the log. Plain DOM under `.eq`, so it wears the game's eqosys skin (./skin.ts) like every other
// surface; `skin` here puts one on for a page that has no eqosys client. Drawing a look of your own instead? Read
// `guestRows`, `powers` and `invitable` from ./guests.ts and send the same `GuestAct`s.
import { ICONS, wearSkin, type Skin } from "./skin.ts";
import { invitable, live, nameOf, powers, guestRows, type Acted, type GuestAct, type GuestList, type Role } from "./guests.ts";

const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
// Lucide: users, link, shield, history, undo-2, plus, trash-2, corner-down-right
const ICON = {
  ...ICONS,
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
  plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  under: svg('<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>'),
} as const;

export const TABS = ["people", "invites", "blocked", "roles", "log"] as const;
export type GuestTab = (typeof TABS)[number];
const TAB_WORD: Record<GuestTab, [keyof typeof ICON, string]> = {
  people: ["users", "Guest list"], invites: ["link", "Invites"], blocked: ["ban", "Blocked"], roles: ["shield", "Roles"], log: ["history", "Log"],
};

export interface GuestPanelOpts {
  /** The person looking: what they may do is read off the list. */
  me: string;
  list: GuestList;
  /** Send one act to whoever keeps the list (a Durable Object, a World); its answer is drawn, a refusal shown in words. */
  send: (a: GuestAct) => Acted | Promise<Acted>;
  /** The link an invite code is handed out as (default: this page with `?invite=<code>`). */
  link?: (code: string) => string;
  title?: string;
  /** The app's own permissions and their words, as the Roles tab offers them (the list's own four are always there). */
  perms?: Record<string, string>;
  /** For a page with no eqosys client: the look to wear (its eqosys skin when it has one). */
  skin?: Skin;
  tab?: GuestTab;
  now?: () => number;
}
export interface GuestPanel {
  /** Draw a list the keeper sent (another mod's change). */
  set(list: GuestList): void;
  /** What the panel is showing, for a harness. */
  state(): { tab: GuestTab; list: GuestList; said: string };
  close(): void;
}

const MOD_WORDS: Record<string, string> = { invite: "Invite people", revoke: "Take people off", block: "Block", roles: "Change roles" };
const ago = (ms: number) => ms < 60_000 ? "just now" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} d ago`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const iconBtn = (icon: keyof typeof ICON, title: string, cls = "") => {
  const b = el("button", `eq-btn icon ${cls}`.trim());
  b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = ICON[icon];
  return b;
};

/** Keep `box` showing the guest list. */
export function guestPanel(box: HTMLElement, o: GuestPanelOpts): GuestPanel {
  wearSkin(o.skin);
  wearCss();
  const now = o.now ?? Date.now;
  const link = o.link ?? ((code: string) => { const u = new URL(location.href); u.search = `?invite=${code}`; u.hash = ""; return u.href; });
  let list = o.list, tab: GuestTab = o.tab ?? "people", said = "";
  const perms = { ...MOD_WORDS, ...o.perms };
  const root = el("section", "eq rb-guests");
  root.setAttribute("aria-label", o.title ?? "Guest list");
  box.append(root);

  const send = async (a: GuestAct) => {
    const r = await o.send(a);
    if (r.ok) { list = r.list; said = ""; } else said = r.why;
    draw();
  };
  const roleName = (id: string) => list.roles.find((r) => r.id === id)?.name ?? id;

  function people(body: HTMLElement) {
    for (const row of guestRows(list)) {
      const line = el("div", "rb-guests-row");
      line.style.setProperty("--depth", String(Math.min(row.depth, 6)));
      line.dataset.id = row.id;
      if (row.depth) line.insertAdjacentHTML("beforeend", `<span class="rb-guests-under">${ICON.under}</span>`);
      const who = el("div", "rb-guests-who");
      who.append(el("b", "", row.name));
      who.append(el("small", "", row.byName && row.depth > 1 ? `via ${row.byName}, ${ago(now() - row.at)}` : row.by ? ago(now() - row.at) : "Owner"));
      line.append(who);
      const p = powers(list, o.me, row.id);
      if (!row.role) line.append(Object.assign(el("span", "rb-guests-tag owner"), { innerHTML: `${ICON.crown}<span>Owner</span>` }));
      else if (p.roles.length) {
        const pick = el("select", "rb-guests-role");
        pick.setAttribute("aria-label", `${row.name}'s role`);
        for (const r of [row.role, ...p.roles.filter((r) => r.id !== row.role!.id)]) pick.append(Object.assign(el("option", "", r.name), { value: r.id, selected: r.id === row.role.id }));
        pick.onchange = () => void send({ t: "role", who: row.id, role: pick.value });
        line.append(pick);
      } else line.append(el("span", "rb-guests-tag", row.role.name));
      const acts = el("div", "rb-guests-acts");
      if (p.revoke) {
        const b = iconBtn("user-x", row.brought ? `Take ${row.name} off (and the ${row.brought} they brought: Shift-click)` : `Take ${row.name} off`);
        b.onclick = (e) => void send({ t: "revoke", who: row.id, ...(e.shiftKey ? { all: true } : {}) });
        acts.append(b);
      }
      if (p.block) { const b = iconBtn("ban", `Block ${row.name}`, "danger"); b.onclick = () => void send({ t: "block", who: row.id }); acts.append(b); }
      line.append(acts);
      body.append(line);
    }
  }

  function invites(body: HTMLElement) {
    const roles = invitable(list, o.me);
    if (roles.length) {
      const make = el("form", "rb-guests-make");
      const role = el("select"); role.setAttribute("aria-label", "Invite as");
      for (const r of roles) role.append(Object.assign(el("option", "", r.name), { value: r.id }));
      role.value = roles[roles.length - 1].id;
      const uses = el("select"); uses.setAttribute("aria-label", "Uses");
      for (const [v, w] of [["1", "1 use"], ["5", "5 uses"], ["25", "25 uses"], ["", "Any number"]]) uses.append(Object.assign(el("option", "", w), { value: v }));
      const hours = el("select"); hours.setAttribute("aria-label", "Lasts");
      for (const [v, w] of [["1", "1 hour"], ["24", "A day"], ["168", "A week"], ["", "No end"]]) hours.append(Object.assign(el("option", "", w), { value: v }));
      hours.value = "24";
      const go = el("button", "eq-btn primary"); go.type = "submit"; go.innerHTML = `${ICON["user-plus"]}<span>Invite</span>`;
      make.append(role, uses, hours, go);
      make.onsubmit = (e) => { e.preventDefault(); void send({ t: "invite", role: role.value, ...(uses.value ? { uses: +uses.value } : {}), ...(hours.value ? { hours: +hours.value } : {}) }); };
      body.append(make);
    }
    if (!list.invites.length) body.append(el("p", "rb-guests-none", "No open invites."));
    for (const inv of [...list.invites].reverse()) {
      const line = el("div", "rb-guests-row");
      line.dataset.code = inv.code;
      const who = el("div", "rb-guests-who");
      who.append(el("b", "", `${roleName(inv.role)} invite`));
      const left = inv.left === undefined ? `${inv.used} used` : `${inv.left} of ${inv.left + inv.used} left`;
      const ends = inv.until === undefined ? "no end" : now() >= inv.until ? "ran out" : `ends in ${ago(inv.until - now()).replace(" ago", "")}`;
      who.append(el("small", "", `by ${nameOf(list, inv.by)} · ${left} · ${ends}`));
      line.append(who);
      if (!live(inv, now())) line.classList.add("spent");
      const acts = el("div", "rb-guests-acts");
      const copy = iconBtn("copy", "Copy link");
      copy.onclick = () => { void navigator.clipboard?.writeText(link(inv.code)); copy.innerHTML = ICON.check; setTimeout(() => { copy.innerHTML = ICON.copy; }, 1200); };
      const take = iconBtn("trash", "Take this invite back");
      take.onclick = () => void send({ t: "uninvite", code: inv.code });
      acts.append(copy, take);
      line.append(acts);
      body.append(line);
    }
  }

  function blocked(body: HTMLElement) {
    const ids = Object.keys(list.blocked);
    if (!ids.length) body.append(el("p", "rb-guests-none", "Nobody is blocked."));
    for (const id of ids) {
      const b = list.blocked[id], line = el("div", "rb-guests-row");
      line.dataset.id = id;
      const who = el("div", "rb-guests-who");
      who.append(el("b", "", b.name), el("small", "", `by ${nameOf(list, b.by)}, ${ago(now() - b.at)}${b.why ? ` · ${b.why}` : ""}`));
      line.append(who);
      if (powers(list, o.me, id).block) {
        const u = iconBtn("undo", `Unblock ${b.name}`);
        u.onclick = () => void send({ t: "unblock", who: id });
        line.append(u);
      }
      body.append(line);
    }
  }

  function roles(body: HTMLElement) {
    const owner = list.owner === o.me, keys = Object.keys(perms);
    const grid = el("div", "rb-guests-grid");
    grid.style.setProperty("--cols", String(keys.length));
    grid.append(el("span"));
    for (const k of keys) grid.append(el("small", "rb-guests-perm", perms[k]));
    if (owner) grid.append(el("span"));
    let draft: Role[] = list.roles.map((r) => ({ ...r, perms: [...r.perms] }));
    const save = () => void send({ t: "roles", roles: draft });
    draft.forEach((r, i) => {
      const name = el("input", "rb-guests-name");
      name.value = r.name; name.disabled = !owner; name.setAttribute("aria-label", "Role name");
      name.onchange = () => { draft[i].name = name.value.trim() || r.name; save(); };
      grid.append(name);
      for (const k of keys) {
        const c = el("input"); c.type = "checkbox"; c.checked = r.perms.includes(k); c.disabled = !owner;
        c.setAttribute("aria-label", `${r.name}: ${perms[k]}`);
        c.onchange = () => { draft[i].perms = c.checked ? [...draft[i].perms, k] : draft[i].perms.filter((p) => p !== k); save(); };
        grid.append(c);
      }
      if (owner) {
        const d = iconBtn("trash", `Remove ${r.name} (its people move to the lowest role)`);
        d.disabled = draft.length === 1;
        d.onclick = () => { draft = draft.filter((x) => x !== r); save(); };
        grid.append(d);
      }
    });
    body.append(grid);
    if (owner) {
      const add = el("button", "eq-btn"); add.type = "button"; add.innerHTML = `${ICON.plus}<span>Add a role</span>`;
      add.onclick = () => {
        const low = draft[draft.length - 1];
        let id = "role", n = 1;
        while (draft.some((r) => r.id === id)) id = `role-${++n}`;
        draft = [...draft, { id, name: "New role", rank: Math.min(98, low.rank + 1), perms: [] }];
        save();
      };
      body.append(add);
      body.append(el("p", "rb-guests-none", "Higher rows rank higher: people act only on those below them."));
    }
  }

  function log(body: HTMLElement) {
    const said: Record<string, (e: GuestList["log"][number]) => string> = {
      invite: (e) => `made a ${roleName(e.role ?? "")} invite`, uninvite: () => "took an invite back", join: (e) => `let ${e.name} in as ${roleName(e.role ?? "")}`,
      leave: () => "left", role: (e) => `made ${e.name} ${roleName(e.role ?? "")}`, revoke: (e) => `took ${e.name} off`,
      block: (e) => `blocked ${e.name}`, unblock: (e) => `unblocked ${e.name}`, roles: () => "changed the roles",
    };
    if (!list.log.length) body.append(el("p", "rb-guests-none", "Nothing yet."));
    for (const e of [...list.log].reverse().slice(0, 60)) {
      const line = el("div", "rb-guests-row log");
      const who = el("div", "rb-guests-who");
      // a join is the newcomer's act, so it reads as the inviter's: "Ada let Grace in"
      const by = e.act === "join" ? list.invites.find((i) => i.code === e.code)?.by ?? list.guests[e.by]?.by ?? e.by : e.by;
      who.append(el("b", "", `${nameOf(list, by)} ${said[e.act](e)}`), el("small", "", ago(now() - e.at)));
      line.append(who);
      body.append(line);
    }
  }

  function draw() {
    root.replaceChildren();
    const head = el("header", "rb-guests-head");
    head.append(el("h2", "", o.title ?? "Guest list"), el("span", "rb-guests-count", `${Object.keys(list.guests).length + 1} in`));
    const tabs = el("nav", "rb-guests-tabs");
    tabs.setAttribute("role", "tablist");
    for (const t of TABS) {
      const [icon, word] = TAB_WORD[t];
      const b = el("button", "rb-guests-tab");
      b.type = "button"; b.title = word; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(t === tab)); b.dataset.tab = t;
      const n = t === "invites" ? list.invites.length : t === "blocked" ? Object.keys(list.blocked).length : 0;
      b.innerHTML = `${ICON[icon]}<span>${word}</span>${n ? `<i>${n}</i>` : ""}`;
      b.onclick = () => { tab = t; said = ""; draw(); };
      tabs.append(b);
    }
    const body = el("div", "rb-guests-body");
    ({ people, invites, blocked, roles, log })[tab](body);
    root.append(head, tabs, body);
    if (said) root.append(Object.assign(el("p", "rb-guests-said", said), { role: "status" }));
  }
  draw();
  return {
    set(l) { list = l; draw(); },
    state: () => ({ tab, list, said }),
    close: () => root.remove(),
  };
}

/** The panel's own rules, every one on the skin's tokens. */
const CSS = `
.rb-guests{display:flex;flex-direction:column;gap:10px;padding:12px;border:var(--ui-border) solid var(--ui-line);border-radius:var(--ui-radius);background:var(--ui-bg);box-shadow:var(--ui-shadow);min-width:0}
.rb-guests-head{display:flex;align-items:baseline;gap:8px}.rb-guests-head h2{margin:0;flex:1;font:700 17px/1.2 var(--ui-font-head,var(--ui-font))}
.rb-guests-count{color:var(--ui-dim);font-size:13px;white-space:nowrap}
.rb-guests-tabs{display:flex;gap:4px;padding:3px;border-radius:var(--ui-radius-sm);background:var(--ui-soft)}
.rb-guests-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 6px;border:0;border-radius:calc(var(--ui-radius-sm) - 2px);background:none;color:var(--ui-dim);font:inherit;font-weight:600;white-space:nowrap;cursor:pointer}
.rb-guests-tab svg{width:17px;height:17px;flex:none}.rb-guests-tab i{font-style:normal;font-size:11px;min-width:18px;padding:0 5px;border-radius:9px;background:var(--ui-line);color:var(--ui-bg)}
.rb-guests-tab[aria-selected=true]{background:var(--ui-bg);color:var(--ui-ink);box-shadow:0 1px 3px #0000002e}
@container (max-width:460px){.rb-guests-tab span{display:none}}
.rb-guests{container-type:inline-size}
.rb-guests-body{display:flex;flex-direction:column;gap:4px;max-height:min(60vh,520px);overflow:auto}
.rb-guests-row{display:flex;align-items:center;gap:8px;min-height:46px;padding:4px 6px 4px calc(6px + var(--depth,0) * 18px);border-radius:var(--ui-radius-sm)}
.rb-guests-row:hover{background:var(--ui-soft)}.rb-guests-row.spent{opacity:.5}
.rb-guests-under{display:flex;color:var(--ui-dim);margin-left:-20px}.rb-guests-under svg{width:14px;height:14px}
.rb-guests-who{flex:1;min-width:0;display:flex;flex-direction:column}.rb-guests-who b,.rb-guests-who small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rb-guests-who small,.rb-guests-none,.rb-guests-perm{color:var(--ui-dim);font-size:12px}
.rb-guests-tag{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;background:var(--ui-soft);font-size:12px;font-weight:600;white-space:nowrap}
.rb-guests-tag.owner{background:var(--ui-accent-soft,var(--ui-soft));color:var(--ui-accent)}.rb-guests-tag svg{width:14px;height:14px}
.eq select.rb-guests-role{width:auto;min-height:32px;padding:4px 8px;font-size:13px}
.rb-guests-acts{display:flex;gap:4px}.rb-guests .eq-btn.icon{min-height:32px;min-width:32px}.rb-guests .eq-btn.danger:hover{color:var(--ui-accent)}
.rb-guests-make{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:6px}
@container (max-width:460px){.rb-guests-make{grid-template-columns:1fr 1fr}}
.rb-guests-grid{display:grid;grid-template-columns:minmax(90px,1.4fr) repeat(var(--cols),minmax(34px,1fr)) auto;gap:6px 4px;align-items:center;justify-items:center;overflow:auto}
.rb-guests-grid>input[type=checkbox]{width:18px;height:18px;min-height:0;accent-color:var(--ui-accent)}
.rb-guests-perm{text-align:center;line-height:1.15}.eq input.rb-guests-name{justify-self:stretch;min-height:32px;padding:4px 8px}
.rb-guests-said{margin:0;padding:8px 10px;border-radius:var(--ui-radius-sm);background:var(--ui-accent-soft,var(--ui-soft));font-weight:600}
`;
function wearCss() {
  if (typeof document === "undefined" || document.getElementById("rb-guests-css")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "rb-guests-css", textContent: CSS }));
}
