// @refresh reload
// SolidStart's server entry, as its template writes it. `mode: "async"` renders the whole page
// before sending, so the count is in the HTML itself rather than streamed in after a fallback.
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>solidstart-example</title>
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  { mode: "async" },
);
