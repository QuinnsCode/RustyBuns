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
}

// Not -slim: Jekyll's own http_parser.rb and a Gemfile's plugins compile C extensions, and slim has no make.
export const JEKYLL_IMAGE = "ruby:3.3";
export const JEKYLL_GEMS_VOLUME = "rustybuns-jekyll-gems";

export type JekyllPlan = { how: "local"; argv: string[] } | { how: "docker"; argv: string[]; image: string } | { how: "none"; why: string };

const quote = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

export function jekyllPlan(args: string[], env: JekyllEnv): JekyllPlan {
  const rubyOk = Number(env.ruby.split(".")[0]) >= 3;
  if (rubyOk && env.gemfile && env.has("bundle")) return { how: "local", argv: ["bundle", "exec", "jekyll", ...args] };
  if (rubyOk && !env.gemfile && env.has("jekyll")) return { how: "local", argv: ["jekyll", ...args] };
  if (env.has("docker")) {
    const jekyll = args.map(quote).join(" ");
    const script = env.gemfile ? `bundle install --quiet && bundle exec jekyll ${jekyll}`
      : `(gem list -i '^jekyll$' >/dev/null || gem install --no-document jekyll) && jekyll ${jekyll}`;
    return {
      how: "docker",
      image: JEKYLL_IMAGE,
      argv: ["docker", "run", "--rm", "-v", `${env.cwd}:/site`, "-w", "/site", "-v", `${JEKYLL_GEMS_VOLUME}:/usr/local/bundle`,
        JEKYLL_IMAGE, "sh", "-c", script],
    };
  }
  const local = env.gemfile ? "bundle" : "jekyll";
  const why = !env.ruby ? "there's no ruby on PATH" : !rubyOk ? `ruby ${env.ruby} is too old for current Jekyll (it needs 3+)` : `${local} is not on PATH`;
  const fix = !rubyOk ? "install Docker (the build then runs in a ruby:3.3 container), or Ruby 3+ (`brew install ruby`) and `gem install jekyll`"
    : env.gemfile ? "run `bundle install`, or install Docker" : "run `gem install jekyll`, or install Docker";
  return { how: "none", why: `${why}, and there's no Docker either. To build, ${fix}` };
}
