// Infer the worker build command from the app's own scripts. The deploy build
// is whatever the app already runs before `wrangler deploy`, minus the deploy.
//   "release": "rw-scripts ensure-deploy-env && pnpm run clean && prisma generate && RWSDK_DEPLOY=1 pnpm run build && wrangler deploy"
//   -> "prisma generate && RWSDK_DEPLOY=1 vite build"

//
// A script that is only the deploy ("deploy": "wrangler deploy") says nothing about
// the build, so the next one is read. With none left, `fallback`: vite build for a
// Vite-built Worker, null for a plain one, which Alchemy bundles from its main.
export function inferWorkerBuild<F extends string | null = string>(scripts: Record<string, string>, fallback: F = "vite build" as F): { build: string | F; from: string } {
  for (const from of ["release", "deploy", "build:worker", "build"]) {
    const src = scripts[from];
    if (!src) continue;
    const kept: string[] = [];
    for (let p of src.split(/\s*&&\s*/).map((p) => p.trim()).filter(Boolean)) {
      // drop the deploy itself and deploy-only env checks
      if (/\bwrangler\s+(deploy|publish|versions)\b/.test(p)) continue;
      if (/ensure-deploy-env|ensure-env\b/.test(p)) continue;
      if (/\bclean(:\w+)?\b/.test(p) && /^(pnpm|npm|bun|yarn)\b/.test(p)) continue;   // cache cleans are not part of a build
      // inline "<pm> run build" to the actual build script so the command is pm-agnostic
      const m = p.match(/^(?:(\w+=\S+\s+)+)?(?:pnpm|npm|bun|yarn)\s+(?:run\s+)?build$/);
      if (m && scripts["build"]) p = (m[0].match(/^(?:\w+=\S+\s+)+/)?.[0] ?? "") + scripts["build"];
      kept.push(p);
    }
    if (kept.length) return { build: kept.join(" && "), from };
  }
  return { build: fallback, from: "default" };
}
