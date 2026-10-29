// The demo tours the Worker carries, from content/*.json: Science On a Sphere tour scripts (TerraViz's own format)
// with a `title` on top. `bun run cms` in apps/terraviz-demo edits their words and numbers; add a file here to
// ship another. A teacher plays one with ?tour=<name> on the link or window.sphere.tour("<name>").
import threePlaces from "../content/three-places.json";

const tour = (t: { title: string; tourTasks: unknown[] }) => ({ title: t.title, json: JSON.stringify(t) });

export const TOURS: Record<string, { title: string; json: string }> = {
  "three-places": tour(threePlaces),
};
