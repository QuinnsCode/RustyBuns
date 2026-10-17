import { VERSION } from "../env.ts";
import styles from "./styles.css?url";

export const TAG = `qCRM-v${VERSION.replaceAll(".", "")}`;
const DESCRIPTION = "qCRM: the CRM your agents can use. MCP built in, a Rust engine for analysis in your browser, office sync, signed webhooks, a desktop app, and every row yours to export or delete.";

// One document for every page. The hero copy, feature list and demo banner are server-rendered
// HTML, so crawlers read the whole pitch; the wave canvas and the CRM itself are progressive.
export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>qCRM: a CRM your agents can use</title>
      <meta name="description" content={DESCRIPTION} />
      <meta name="generator" content={TAG} />
      <meta name="color-scheme" content="light dark" />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4eee2" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#05030a" />
      <meta property="og:title" content="qCRM" />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
      <link rel="stylesheet" href={styles} />
      <link rel="modulepreload" href="/src/client.tsx" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org", "@type": "SoftwareApplication", name: "qCRM", applicationCategory: "BusinessApplication",
        operatingSystem: "Web, macOS, Windows, Linux", softwareVersion: VERSION, description: DESCRIPTION, author: { "@type": "Organization", name: "QNTBR" },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Demo" },
      }) }} />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);
