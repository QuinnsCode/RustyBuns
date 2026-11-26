// The browser entry: mount the page, with the agent's door (its WebMCP tools) up for as long as it is mounted.
import { BrowserHost } from "@effect/ui/html";
import { Effect, Layer } from "effect";
import { layer as agent } from "./agent.ts";
import { ProfilePage } from "./ProfilePage.ts";

const Main = BrowserHost.mount(ProfilePage, {}, document.getElementById("app")!).pipe(Layer.provide(agent));

Layer.launch(Main).pipe(Effect.runFork);
