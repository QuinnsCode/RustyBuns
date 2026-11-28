// What Python answers, declared once: the host checks it, the page gets the types.
import { num, obj, str, type Of } from "@rustybuns/util/guard";

const finite = num(-Number.MAX_VALUE, Number.MAX_VALUE);

export const About = obj({ version: str(50) });
export type About = Of<typeof About>;

export const Summary = obj({ count: finite, mean: finite, median: finite, stdev: finite });
export type Summary = Of<typeof Summary>;
