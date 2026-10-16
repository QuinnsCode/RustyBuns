// The Rusty Buns docs site: the README as the home page, a page per README feature, About, and the
// root guides. Old tags from before the feature-list README get their README as one page.
import { configReference } from "./config-reference.ts";
import { voteSection } from "./vote-section.ts";
import { type Page, type Site, slug, titleOf } from "./lib.ts";

const GUIDES = ["GETTING_STARTED.md", "AGENT_PROMPTS.md", "REFERENCE.md", "ADOPTION.md", "EXAMPLES.md", "COSTS.md", "FRAMEWORKS.md", "FRAMEWORK_COVERAGE.md", "SECURITY.md", "LICENSING.md", "PRIVACY.md", "ACCESSIBILITY.md", "APPLE_SIGNING.md", "WINDOWS_LINUX_SIGNING.md"];

export const rustybuns: Site = {
  name: "Rusty Buns",
  tagline: "Write a web app once. Ship it as a desktop binary, a Cloudflare Worker and a Linux server.",
  repo: "QuinnsCode/RustyBuns",
  ogImage: "og-rustybuns.png",
  pages(src) {
    const readme = src.read("README.md") ?? "# Rusty Buns\n";
    const pages: Page[] = [];
    const features: Page[] = [];
    // Each `### Title` under `## Features` is a short line then <details>: the home page keeps the
    // short line and links to the feature's own page, which has the long version.
    const home = readme.replace(/\n## Features\n([\s\S]*?)(?=\n## )/, (section) =>
      section
        .replace(/\nEach feature is one line\. Click \*\*More\*\* for the long version\.\n/, "\n")
        .replace(/\n### (.+)\n([\s\S]*?)(?=\n### |$)/g, (_, title: string, body: string) => {
          const [short = "", ...rest] = body.trim().split(/\n\s*\n/);
          const long = rest.join("\n\n").replace(/^<details><summary>[^<]*<\/summary>\s*/, "").replace(/\s*<\/details>\s*$/, "");
          const page = `features/${slug(title)}.html`;
          features.push({ path: page, title: title.replace(/`/g, ""), md: `# ${title}\n\n${short}\n\n${long}\n`, from: "README.md", anchor: slug(title), section: "Features" });
          return `\n### ${title}\n\n${short} [More →](${page})\n`;
        }) + "\n<!--extra-->\n",
    );
    // The favourite-features vote sits under the list on today's home page; old tags have no API behind them.
    const vote = src.version === "latest" ? { extra: voteSection(features.map((f) => ({ slug: f.anchor!, title: f.title }))), script: "votes.js" } : {};
    pages.push({ path: "index.html", title: "Rusty Buns", md: home, from: "README.md", ...vote });
    const about = src.read("ABOUT.md");
    if (about) pages.push({ path: "about.html", title: titleOf(about, "About"), md: about, from: "ABOUT.md" });
    pages.push(...features);
    for (const file of GUIDES) {
      const md = src.read(file);
      if (md) pages.push({ path: `guides/${file.replace(/\.md$/, "").toLowerCase().replace(/_/g, "-")}.html`, title: titleOf(md, file), md, from: file, section: "Guides" });
    }
    const config = configReference(src);
    if (config) pages.push(config);
    return pages;
  },
};
