// Part 3 of the per-park journeys (test/lines.ts): its own file so CI can put it on its own shard.
import { parkJourneys } from "./lines.ts";

await parkJourneys(2);
