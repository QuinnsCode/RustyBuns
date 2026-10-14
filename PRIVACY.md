# Privacy

This covers the Rusty Buns docs site and this repository. It doesn't cover apps you build with Rusty Buns, or the hosted codeSplitter service, which handle their own data.

## The docs site

- It's static files, with one exception: the home page's favorite-features vote. There are no accounts and no cookies.
- The vote stores the ranking and comment you send, with a timestamp, and nothing that names you. It keeps only the latest 50 votes, publicly readable at `/api/votes`, so don't put anything private in the comment. Your address is used in memory to allow one vote every 15 seconds and is not stored with the vote.
- There's no analytics, advertising or tracking script, and nothing from a third-party domain loads.
- Your browser's `localStorage` keeps two values on your device: your day or night choice (`theme`) and your reading settings (`reading`: font, text size, spacing). They are preferences you set, never leave the page, and aren't tracking, so there's no cookie banner. Clearing your site data removes them.
- The site is served by Cloudflare, which, like any host, sees your IP address and request headers in its ordinary request logs.
- "Copy for agent" copies a page's markdown to your clipboard in your browser. Nothing is sent anywhere.

## Your rights (GDPR and similar laws)

The site collects no personal data of its own (a vote comment is only what you choose to write, and old votes drop off after 50 more), so there's nothing to access, correct or delete. The only data about you is in Cloudflare's request logs, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/); the controller of this site is QuinnsCode (Ryan Quinn). If you want to ask about anything, or raise a complaint, open an issue or write as described below, and you can always complain to your local data protection authority.

## The repository

Issues, pull requests and comments on [GitHub](https://github.com/QuinnsCode/RustyBuns) are public and governed by [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). Commits carry the author's name and email.

## Questions

Open an issue, or report anything sensitive privately as described in [SECURITY.md](SECURITY.md).
