# Privacy

This covers the Rusty Buns docs site and this repository. It doesn't cover apps you build with Rusty Buns, or the hosted codeSplitter service, which handle their own data.

## The docs site

- It's static files. There are no accounts, no forms and no cookies.
- There's no analytics, advertising or tracking script, and nothing from a third-party domain loads.
- Your browser's `localStorage` keeps one value, your day or night choice, on your device. It never leaves the page.
- The site is served by Cloudflare, which, like any host, sees your IP address and request headers in its ordinary request logs.
- "Copy for agent" copies a page's markdown to your clipboard in your browser. Nothing is sent anywhere.

## The repository

Issues, pull requests and comments on [GitHub](https://github.com/QuinnsCode/RustyBuns) are public and governed by [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). Commits carry the author's name and email.

## Questions

Open an issue, or report anything sensitive privately as described in [SECURITY.md](SECURITY.md).
