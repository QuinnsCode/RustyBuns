// The Character dialog over the jam room at phone width, where it fills the screen (character-kit.ts walks it).
import { setDefaultTimeout } from "bun:test";
import { characterOn } from "./character-kit.ts";

setDefaultTimeout(240_000); // the jam room in software GL on CI's runners: most of a minute to load and walk
characterOn("a phone", 390, 844);
