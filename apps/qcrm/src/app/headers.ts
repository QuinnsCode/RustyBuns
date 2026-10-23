import type { RouteMiddleware } from "rwsdk/router";

// The Rust engine needs wasm-unsafe-eval; nothing else leaves 'self'. /demo frames /app, so frame-ancestors is 'self'.
export const setCommonHeaders = (): RouteMiddleware => ({ response, rw: { nonce } }) => {
  if (!import.meta.env.VITE_IS_DEV_SERVER) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self';`,
  );
};
