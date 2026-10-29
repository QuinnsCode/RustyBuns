// The tour's steps: one file each in src/features/ and an order.txt, the way codeSplitter's feature strip is built,
// read through the same `ordered`. A new step is a new file and a line in order.txt; `go` sends Next to another page.
import { obj, opt, str, type Of } from "@rustybuns/util/guard";
import { ordered } from "@rustybuns/util/features";

const Step = obj({ icon: str(), title: str(), what: str(Infinity), at: str(), go: opt(str()) });
export type Step = Of<typeof Step> & { id: string };

/** The steps from their parsed files (by id) and order.txt's text. Throws on a file that isn't whole or an order that names a ghost. */
export const tourSteps = (files: Record<string, unknown>, order: string): Step[] => ordered(files, order, Step, "src/features");
