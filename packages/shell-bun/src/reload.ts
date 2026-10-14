// Under `rustybuns run desktop --watch` (RB_WATCH) every host adds this script to its pages, so a window
// refreshes itself when the watch swaps the host for a rebuilt one. The page asks /__rb/boot (a new id each
// time the host starts) and reloads when the id changes, once the new host answers. A page with something
// typed into it shows a Refresh button instead of throwing the text away.
export const RELOAD_PATH = "/__rb/boot";

const SCRIPT = `(()=>{let boot;const typing=()=>{const a=document.activeElement;return !!a&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&!!a.value||!!a?.isContentEditable};
const offer=()=>{if(document.getElementById("rb-reload"))return;const b=document.createElement("button");b.id="rb-reload";b.textContent="Updated, refresh";
b.style.cssText="position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:8px 12px;border-radius:6px;border:1px solid #888;background:#fff;color:#000;cursor:pointer";
b.onclick=()=>location.reload();document.body.append(b)};
const tick=async()=>{try{const r=await fetch("${RELOAD_PATH}",{cache:"no-store"});if(r.ok){const b=(await r.json()).boot;if(boot&&b!==boot){if(!typing())return location.reload();offer();boot=b}else boot=boot||b}}catch{}setTimeout(tick,800)};tick()})()`;

export const RELOAD_TAG = `<script>${SCRIPT}</script>`;
