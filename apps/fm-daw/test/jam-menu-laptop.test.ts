// The jam room's menu on a laptop (jam-menu-kit.ts walks it).
import { setDefaultTimeout } from "bun:test";
import { menuOn } from "./jam-menu-kit.ts";

setDefaultTimeout(240_000); // the jam room in software GL on CI's runners: most of a minute to load and walk
menuOn("a laptop", 1280, 720);
