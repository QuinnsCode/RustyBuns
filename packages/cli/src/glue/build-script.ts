// Infer the worker build command from the app's own scripts. The deploy build
// is whatever the app already runs before `wrangler deploy`, minus the deploy.
//   "release": "rw-scripts ensure-deploy-env && pnpm run clean && prisma generate && RWSDK_DEPLOY=1 pnpm run build && wrangler deploy"
//   -> "prisma generate && RWSDK_DEPLOY=1 vite build"

export function inferWorkerBuild(scripts: Record<string, string>): { build: string; from: string } {
  const src = scripts["release"] ?? scripts["deploy"] ?? scripts["build:worker"] ?? scripts["build"];
  const from = scripts["release"] ? "release" : scripts["deploy"] ? "deploy" : scripts["build:worker"] ? "build:worker" : scripts["build"] ? "build" : "default";
  if (!src) return { build: "vite build", from };
  const parts = src.split(/\s*&&\s*/).map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  for (let p of parts) {
    // drop the deploy itself and deploy-only env checks
    if (/\bwrangler\s+(deploy|publish|versions)\b/.test(p)) continue;
    if (/ensure-deploy-env|ensure-env\b/.test(p)) continue;
    if (/\bclean(:\w+)?\b/.test(p) && /^(pnpm|npm|bun|yarn)\b/.test(p)) continue;   // cache cleans are not part of a build
    // inline "<pm> run build" to the actual build script so the command is pm-agnostic
    const m = p.match(/^(?:(\w+=\S+\s+)+)?(?:pnpm|npm|bun|yarn)\s+(?:run\s+)?build$/);
    if (m && scripts["build"]) p = (m[0].match(/^(?:\w+=\S+\s+)+/)?.[0] ?? "") + scripts["build"];
    kept.push(p);
  }
  return { build: kept.join(" && ") || "vite build", from };
}
