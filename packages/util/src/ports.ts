// Every local port a script or dev server here listens on by default: one number, one service, so two never fight over
// a port (`bun run manual` and eqosys's home preview both took 4790). A new server takes the next free number in its
// block, adds a row, and reads its port from here (`portArg`), never a literal. Anything that can run twice at once
// (tests, smoke runs, the apps `bun run manual` starts) listens on port 0 instead. This file imports nothing, so an app
// without `@rustybuns/util` in its package.json can import it by path.
export const PORTS = {
  // Agent Office (its own binary and scripts keep the number; listed so nothing else takes it)
  office: 4600,
  officeDemo: 4720,
  // packages/cms, the content editor: its default, then one per app's `bun run cms` (set in that app's package.json,
  // since the published cms can't import this; `--port` there is a number)
  cms: 4700,
  cmsTwoFronts: 4701,
  cmsGitRecon: 4702,
  cmsTerraviz: 4703,
  cmsCodesplitter: 4704,
  cmsMythic: 4705,
  terravizDemo: 4730,
  // codeSplitter
  mervinWatch: 4177,
  welcome: 4747,
  threadDemo: 4748,
  liveDemo: 4749,
  gitpath: 4783,
  codesplitterOffice: 4791,
  // git-recon
  battle: 4180,
  // repo tools and previews
  manual: 4790,
  eqosysPreview: 4792,
  qview3d: 5190,
  parkHideSeek: 5391,
  // Bun servers standing in for a deploy
  geoboxq: 8787,
  geoboxqFront: 8788,
  geoboxqShopify: 8789,
  cronSwanson: 8790,
  playgroundSizes: 8800,
} as const;
export type PortName = keyof typeof PORTS;
const isName = (v: string): v is PortName => Object.hasOwn(PORTS, v);

/** A `--port` value: a number, or a name from PORTS (`--port cmsMythic`); missing or unknown, `fallback`'s number. */
export const portArg = (v: string | undefined, fallback: PortName): number => {
  if (v && /^\d+$/.test(v)) return Number(v);
  return v && isName(v) ? PORTS[v] : PORTS[fallback];
};
