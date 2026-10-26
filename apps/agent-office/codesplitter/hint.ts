// codeSplitter's dispatch hint (#1187), the pure part: which socket message queues a task, and the text codeSplitter
// guesses its files from. The card is in index.ts.

/** The office client's message putting a task on the queue (📋 Add to queue, or an issue dropped on the queue). */
export interface QueueAdd { t: "queue.add"; prompt: string; title?: string; issue?: number; [k: string]: unknown }
/** codeSplitter's GET .../dispatch-hint: the task's likely files and the open branches already changing them, most first. */
export interface Hint { files: string[]; busy: { branch: string; files: string[] }[] }

export function queueAdd(data: unknown): QueueAdd | undefined {
  if (typeof data !== "string" || !data.startsWith('{"t":"queue.add"')) return;
  try {
    const msg = JSON.parse(data);
    return msg?.t === "queue.add" && typeof msg.prompt === "string" ? msg : undefined;
  } catch {
    return;
  }
}

/** What the hint reads: the task's prompt and title, plus its issue's title, body and labels when the page has them
 * (an issue's prompt only says "Work on GitHub issue #N"). Capped, as a query string. */
export function taskText(msg: QueueAdd, issue?: string, max = 4000): string {
  return [msg.title, msg.prompt, issue].filter(Boolean).join("\n").slice(0, max);
}

/** A task the card's Wait is holding on the office server (#1287): the message to send, and the branches it waits on. */
export interface Held { id: string; msg: QueueAdd; branches: string[]; at: number }

/** Which of the held task's branches are still open, by codeSplitter's branch list. A branch it no longer lists has
 * merged and gone. Null when codeSplitter can't say, so the task keeps waiting. */
export function stillBusy(held: Held, branches: { name: string; status: string }[] | null): string[] | null {
  if (!branches) return null;
  const open = new Set(branches.filter((b) => b.status === "open").map((b) => b.name));
  return held.branches.filter((b) => open.has(b));
}
