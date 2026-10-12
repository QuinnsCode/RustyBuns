import type { RouteMiddleware } from "rwsdk/router";

// Tight by default: our own scripts (and rwsdk's nonce'd bootstrap), plus Turnstile.
export const setCommonHeaders = (): RouteMiddleware => ({ response, rw: { nonce } }) => {
  if (!import.meta.env.VITE_IS_DEV_SERVER) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; ` +
      `frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none';`,
  );
};
