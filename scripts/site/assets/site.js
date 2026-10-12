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
