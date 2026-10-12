// Static sites in a trial (#1103): what init's config builds them with, and whether a failed build
// was the site or a generator this machine doesn't have. Pure, so it tests without a trial run.

/** The clientBuild init wrote for a static site (packages/cli/src/glue/static-site.ts), or undefined for an app. */
export function staticBuild(cfg: string): string | undefined {
  const build = cfg.match(/"clientBuild": "([^"]*)"/)?.[1];
  return build && /\bjekyll build\b|^hugo\b|\bmkdocs build\b|\brustybuns copy-site\b/.test(build) ? build : undefined;
}

/** The program a static build runs that comes from outside npm (bundle, jekyll, hugo, mkdocs), or undefined. */
export function staticTool(build: string): string | undefined {
  return build.match(/^(bundle|jekyll|hugo|mkdocs)\b/)?.[1];
}

/** A build that died for want of its generator or its runtime (a missing gem, a Ruby too old), not for the site. */
export const toolchainError = (tail: string) =>
  /\b(jekyll|hugo|mkdocs|bundle|ruby|python3?)\b.*(command not found|not found|No such file)|Could not find gem|Bundler could not find|requires Ruby version|Gem::MissingSpec|ModuleNotFoundError: No module named 'mkdocs/i.test(tail);
