// Things that happen at once: an agent's calls while a person presses Undo or Start over, and the world's frame
// loading again before the server has answered MarkMade. Story.explore tries every order of them and of the Command
// results, and answers with the shortest one that breaks a rule.
import { Story } from "@effect/ui/testing";
import { test } from "bun:test";
import { LANDS } from "../src/lands.ts";
import { starter } from "../src/page.ts";
import { MarkMade, PageMessage, ProfilePageNoDeps, ReportPage } from "../src/ProfilePage.ts";
import { READY } from "../src/worlds.ts";

const props = { room: "testroom0001", origin: "http://localhost", initial: starter, full: false, landing: false, who: "Ada", made: false, back: false };

const call = (n: number, request: Parameters<typeof PageMessage.ReceivedAgentCall>[0]["call"]["request"]) => PageMessage.ReceivedAgentCall({ call: { call: n, tool: "agent", request } });
const write = call(1, { _tag: "WriteFile", path: "world.js", text: "// the agent's dunes" });
const loaded = PageMessage.Saw({ what: "loaded" });

const commands = [
  [ReportPage, { success: [PageMessage.CompletedReportPage()] }],
  [MarkMade, { success: [PageMessage.MadeWorld({ made: true }), PageMessage.MadeWorld({ made: false })] }],
] as const;

/** Worlds the page itself hands out: the AI built none of them. */
const given = [starter, ...READY, ...LANDS].map((w) => `"files":${JSON.stringify(w.files)}`);

test("an agent's calls and a person's Undo and Start over, in any order: the page always reports what is on screen", () => {
  Story.explore(ProfilePageNoDeps, props, {
    messages: [write, call(2, { _tag: "Undo" }), PageMessage.ClickedUndo(), PageMessage.ClickedReset()],
    commands,
    // Reports queue: the last one waiting carries the page as it is now, so page_read can't end up behind.
    invariant: (story) => {
      const last = story.pending.filter((p) => p.command.name === ReportPage.name).at(-1);
      return last === undefined || JSON.stringify(last.command.args).includes(`"page":${JSON.stringify(story.model.page)}`);
    },
    depth: 5,
  });
});

test("a frame that loads again while MarkMade is out doesn't start it twice, and made stays made", () => {
  Story.explore(ProfilePageNoDeps, props, {
    messages: [write, PageMessage.Saw({ what: "start" }), loaded],
    commands,
    invariant: (story) => story.pending.filter((p) => p.command.name === MarkMade.name).length <= 1,
    transition: ({ before, after }) => {
      if (before.made && !after.made) throw new Error("made went back to false");
    },
    depth: 6,
  });
});

test("Start over or Undo before the agent's world has loaded doesn't save a world the page handed out as made", () => {
  Story.explore(ProfilePageNoDeps, props, {
    messages: [write, PageMessage.ClickedUndo(), PageMessage.ClickedReset(), PageMessage.ClickedTry({ name: READY[0]!.name }), loaded],
    commands,
    invariant: (story) => story.pending.every((p) => p.command.name !== MarkMade.name || !given.some((files) => JSON.stringify(p.command.args).includes(files))),
    depth: 4,
  });
});
