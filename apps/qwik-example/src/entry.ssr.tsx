// Server rendering, as the Qwik starter writes it: the root rendered to a stream.
import { renderToStream, type RenderToStreamOptions } from "@builder.io/qwik/server";
import { manifest } from "@qwik-client-manifest";
import Root from "./root";

export default function (opts: RenderToStreamOptions) {
  return renderToStream(<Root />, {
    manifest,
    ...opts,
    containerAttributes: { lang: "en", ...opts.containerAttributes },
  });
}
