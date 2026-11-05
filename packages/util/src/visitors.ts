// Who a request looks like, from its headers alone: a person in a browser, an agent, or a bot.
// codeSplitter's insights (apps/codesplitter/src/insights.ts) and eqosys's visitors (apps/eqosys/src/visitors.ts)
// both sort their traffic with it.
//   person  a Mozilla user agent that sends the sec-fetch-* headers a real browser adds
//   agent   a script (curl, python, node…), an AI client, or a "browser" without those headers (headless, or spoofed)
//   bot     a crawler or uptime checker that says so

export type Kind = "person" | "agent" | "bot";
export type Via = "browser" | "crawler" | "headless" | "script";

const BOT = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|preview|uptime|monitor|pingdom|statuscake|lighthouse/i;
const HEADLESS = /headless|phantomjs|playwright|puppeteer|selenium|webdriver/i;
const SCRIPT = /^(curl|wget|httpie|python|aiohttp|httpx|go-http|okhttp|java|ruby|php|node|undici|axios|got|bun|deno|postman|insomnia|rust|reqwest)|claude|anthropic|openai|chatgpt|gpt|perplexity|mcp|langchain/i;

/** What a request's headers say it is. */
export function kindOf(headers: Headers): { kind: Kind; via: Via } {
  const ua = headers.get("user-agent") ?? "";
  if (BOT.test(ua)) return { kind: "bot", via: "crawler" };
  if (HEADLESS.test(ua)) return { kind: "agent", via: "headless" };
  if (!ua || SCRIPT.test(ua)) return { kind: "agent", via: "script" };
  if (/^Mozilla\//.test(ua) && headers.has("sec-fetch-mode")) return { kind: "person", via: "browser" };
  return { kind: "agent", via: "headless" };
}
