// The two edits to the 3D office's bundle behind power/ (applied by scripts/rustybunsify.ts, checked against the
// pinned release in test/power.test.ts).
export const POWER_PATCHES: [from: string, to: string][] = [
  // the frame loop asks __rbFrame first, so a frame can be skipped and the office draws at the rate you need rather
  // than every one a 120 Hz display offers; the clock just sees a longer gap next time
  ["function r(i){n.update(i);let a=n.getDelta();",
    "function r(i){if(globalThis.__rbFrame?.(i)===!1)return void requestAnimationFrame(r);n.update(i);let a=n.getDelta();"],
  // and the GPU is left to the browser: "high-performance" wakes a Mac's discrete GPU, which drains a battery for a cartoon
  ["antialias:!0,powerPreference:`high-performance`}", "antialias:!0,powerPreference:`default`}"],
];
