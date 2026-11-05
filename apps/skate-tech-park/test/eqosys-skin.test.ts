// One journey through the running park: a signed-in rider opens a party link and the spaces panel, and the lobby, the
// spaces and the report form wear the park's eqosys skin (src/eqosys.ts SKIN), resolved against its own stylesheet
// (--paper, --ink in styles.css). No eqosys answers here, so the panels show their offline state, skinned all the same.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

// A token the page reads as fresh for a day (the page only peeks at it; the Worker is who checks it).
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 86_400;
const token = `${b64({ alg: "EdDSA" })}.${b64({ iss: "x", aud: "skate-tech-park", sub: "u_ada", email: "ada@example.com", name: "Ada", source: "skate-tech-park", access: ["play"], iat: exp - 90_000, exp })}.sig`;

test.skipIf(!chromePath())("signed in, the party lobby, spaces and report form wear the park's paper and ink", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
    await load(chrome.cdp, tab, vite.url, 500);
    await tab.eval(`localStorage.setItem("stp.eqosys", location.origin); localStorage.setItem("stp.login", JSON.stringify({ name: "Ada", email: "ada@example.com", token: ${JSON.stringify(token)} }))`);
    await load(chrome.cdp, tab, `${vite.url}?level=el-capitan&party=KRTZ`, 2500);
    const got = await tab.eval<Record<string, string>>(`(() => {
      document.getElementById("spaces-btn").click();
      document.querySelector(".rb-report > .eq-btn").click();
      const css = (sel) => getComputedStyle(document.querySelector(sel));
      return { lobby: css(".rb-lobby").backgroundColor, lobbyLine: css(".rb-lobby").borderTopColor, lobbyShadow: css(".rb-lobby").boxShadow,
        spaces: css("#spaces.rb-spaces").backgroundColor, spacesShadow: css("#spaces.rb-spaces").boxShadow, form: css(".rb-report .eq-form").backgroundColor };
    })()`);
    const paper = "rgb(251, 247, 240)", ink = "rgb(27, 27, 31)"; // --paper, --ink
    expect(got).toMatchObject({ lobby: paper, lobbyLine: ink, spaces: paper, form: paper });
    expect(got.lobbyShadow).toBe(`${ink} 3px 3px 0px 0px`);
    expect(got.spacesShadow).toBe(got.lobbyShadow);
    await tab.close();
  } finally { chrome.stop(); vite.stop(); }
});
