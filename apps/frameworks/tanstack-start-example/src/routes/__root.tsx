/// <reference types="vite/client" />
import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Notes" }],
  }),
  component: () => <Outlet />,
  shellComponent: Shell,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
