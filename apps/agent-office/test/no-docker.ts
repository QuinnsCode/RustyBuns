// A box probe for tests of the box route: a stopped box on a small host, so they check grants and logs, not the machine
// they run on (the default probe asks Docker, which hangs where its daemon is down or slow).
import type { Probe } from "../sandbox/server.ts";

export const noDocker: Probe = { host: async () => ({ cpus: 4, memBytes: 8 * 2 ** 30 }), health: async () => ({ running: false as const }) };
