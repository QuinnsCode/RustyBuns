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
