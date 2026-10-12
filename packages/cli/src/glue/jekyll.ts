// `rustybuns jekyll <args>`: run Jekyll however this machine can. Current Jekyll needs Ruby 3+, and
// macOS ships 2.6, where `gem install jekyll` dies on ffi. So a too-old (or missing) Ruby falls back
// to Docker: ruby:3.3 with the gems in a named volume, so only the first build pays for the install.
// Pure (the machine's facts in), so the choice is testable; index.ts spawns it.
export interface JekyllEnv {
  /** RUBY_VERSION of the ruby on PATH, or "" with none. */
  ruby: string;
  /** Is this program on PATH? */
  has: (bin: string) => boolean;
  /** The site has a Gemfile (github-pages, plugins): build through Bundler. */
  gemfile: boolean;
  /** The site folder, mounted into the container. */
  cwd: string;
  /** With no Gemfile: the `plugins` its configs turn on, which need their gems next to Jekyll's. */
  plugins?: string[];
  /** Is this gem installed for the local Ruby? Asked only when the local Jekyll would run. */
  gem?: (name: string) => boolean;
}

// Not -slim: Jekyll's own http_parser.rb and a Gemfile's plugins compile C extensions, and slim has no make.
export const JEKYLL_IMAGE = "ruby:3.3";
export const JEKYLL_GEMS_VOLUME = "rustybuns-jekyll-gems";

export type JekyllPlan = { how: "local"; argv: string[] } | { how: "docker"; argv: string[]; image: string; /** Plugin gems it installs too. */ plugins: number } | { how: "none"; why: string };

// A gem name, so it can sit in the container's shell script as is.
const GEM = /^[A-Za-z0-9][\w.-]*$/;
const quote = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

export function jekyllPlan(args: string[], env: JekyllEnv): JekyllPlan {
  const rubyOk = Number(env.ruby.split(".")[0]) >= 3;
  if (rubyOk && env.gemfile && env.has("bundle")) return { how: "local", argv: ["bundle", "exec", "jekyll", ...args] };
  // A plugin gem the local Ruby lacks stops Jekyll with a dependency error, so that build goes to Docker.
  const plugins = env.gemfile ? [] : (env.plugins ?? []).filter((p) => GEM.test(p));
  const missing = rubyOk && !env.gemfile && env.has("jekyll") ? plugins.filter((p) => !env.gem?.(p)) : [];
  if (rubyOk && !env.gemfile && env.has("jekyll") && !missing.length) return { how: "local", argv: ["jekyll", ...args] };
  if (env.has("docker")) {
    const jekyll = args.map(quote).join(" ");
    const script = env.gemfile ? `bundle install --quiet && bundle exec jekyll ${jekyll}`
      : `${["jekyll", ...plugins].map((g) => `(gem list -i '^${g}$' >/dev/null || gem install --no-document ${g})`).join(" && ")} && jekyll ${jekyll}`;
    return {
      how: "docker",
      image: JEKYLL_IMAGE,
      plugins: plugins.length,
      argv: ["docker", "run", "--rm", "-v", `${env.cwd}:/site`, "-w", "/site", "-v", `${JEKYLL_GEMS_VOLUME}:/usr/local/bundle`,
        JEKYLL_IMAGE, "sh", "-c", script],
    };
  }
  const local = env.gemfile ? "bundle" : "jekyll";
  const why = !env.ruby ? "there's no ruby on PATH" : !rubyOk ? `ruby ${env.ruby} is too old for current Jekyll (it needs 3+)`
    : missing.length ? `the site's plugins aren't installed (${missing.join(", ")})` : `${local} is not on PATH`;
  const gems = ["jekyll", ...plugins].join(" ");
  const fix = !rubyOk ? `install Docker (the build then runs in a ruby:3.3 container), or Ruby 3+ (\`brew install ruby\`) and \`gem install ${gems}\``
    : env.gemfile ? "run `bundle install`, or install Docker" : `run \`gem install ${missing.length ? missing.join(" ") : gems}\`, or install Docker`;
  return { how: "none", why: `${why}, and there's no Docker either. To build, ${fix}` };
}
