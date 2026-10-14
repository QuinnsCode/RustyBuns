// The version menu: go to the same page in the other version, or its home if that version doesn't have it.
const menu = document.querySelector(".version select");
menu?.addEventListener("change", async () => {
  const { root, page } = menu.dataset;
  let target = "index.html";
  try {
    const versions = await (await fetch(`${root}/versions.json`)).json();
    if (versions[menu.value]?.includes(page)) target = page;
  } catch {}
  location.href = `${root}/${menu.value}/${target}`;
});

// "Copy for agent": this page's markdown behind a one-line prompt, on the clipboard.
const copy = document.querySelector("button.copy");
copy?.addEventListener("click", async () => {
  const label = copy.textContent;
  try {
    const md = await (await fetch(copy.dataset.md)).text();
    await navigator.clipboard.writeText(`Read this documentation page, then help me with it. Don't deploy anything or read .env files.\n\n${md}`);
    copy.textContent = "Copied";
  } catch {
    copy.textContent = "Couldn't copy";
  }
  announce(copy.textContent);
  setTimeout(() => (copy.textContent = label), 1500);
});

// The day/night toggle: the sun disc shrinks into its centre to uncover the moon. The page head sets the first theme.
const theme = document.querySelector(".theme");
const sync = () => {
  const label = `${document.documentElement.dataset.theme === "dark" ? "Night" : "Day"} mode`;
  theme?.setAttribute("aria-label", label);
  theme?.setAttribute("title", label);
};
sync();
theme?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
  sync();
});

// The footer year follows the visitor's clock, so a site built last year doesn't say last year.
for (const y of document.querySelectorAll("footer .year")) y.textContent = String(new Date().getFullYear());

// Announcements for screen readers (the page's polite live region).
function announce(text) {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

// Reading settings: font (including dyslexia-friendly ones), text size and spacing, kept in this browser only.
// The page head applies the saved choice before first paint; this wires the form and the WebMCP tools.
const reading = document.querySelector(".reading");
const form = reading?.querySelector("form");
const root = document.documentElement;
const keys = ["font", "size", "space"];
const read = () => { try { return JSON.parse(localStorage.getItem("reading") || "{}"); } catch { return {}; } };
const apply = (prefs) => {
  for (const k of keys) {
    if (prefs[k]) root.dataset[k] = prefs[k]; else delete root.dataset[k];
    if (form) form.elements[k].value = prefs[k] || "";
  }
  try { localStorage.setItem("reading", JSON.stringify(prefs)); } catch {}
};
if (form) {
  apply(read());
  form.addEventListener("change", () => apply(Object.fromEntries(keys.map((k) => [k, form.elements[k].value]))));
  form.elements.reset.addEventListener("click", () => { apply({}); announce("Reading settings reset"); });
  reading.addEventListener("keydown", (e) => { if (e.key === "Escape" && reading.open) { reading.open = false; reading.querySelector("summary").focus(); } });
}

// WebMCP: let an agent change the same settings, and read the page as text, where the browser offers it.
const mc = navigator.modelContext;
if (mc?.registerTool && form) {
  const options = (k) => [...form.elements[k].options].map((o) => o.value);
  const tool = (name, description, inputSchema, run) =>
    mc.registerTool({ name, description, inputSchema, async execute(args) { return { content: [{ type: "text", text: run(args ?? {}) }] }; } });
  tool("set_reading_settings", "Change how this documentation site is displayed: font (atkinson and dyslexic are dyslexia friendly), text size and spacing. Omitted fields stay as they are; an empty string restores the default.", {
    type: "object",
    properties: { font: { type: "string", enum: options("font") }, size: { type: "string", enum: options("size") }, space: { type: "string", enum: options("space") } },
  }, (args) => {
    apply({ ...read(), ...Object.fromEntries(keys.filter((k) => options(k).includes(args[k])).map((k) => [k, args[k]])) });
    return `Reading settings: ${JSON.stringify(read())}`;
  });
  tool("set_color_theme", "Switch this site between day and night mode.", { type: "object", properties: { mode: { type: "string", enum: ["light", "dark"] } }, required: ["mode"] }, ({ mode }) => {
    if (root.dataset.theme !== mode) theme?.click();
    return `Theme: ${root.dataset.theme}`;
  });
}
