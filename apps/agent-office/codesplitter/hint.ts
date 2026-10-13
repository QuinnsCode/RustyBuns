// codeSplitter's dispatch hint (#1187), the pure part: which socket message queues a task, the text codeSplitter
// guesses its files from, and the prompt that stacks it on a branch already changing them. The card is in index.ts.

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

/** The prompt, told to start from `branch` instead of main and to open its pull request onto it (GitHub moves the
 * PR onto main by itself once that branch merges and is deleted). */
export function stackedPrompt(prompt: string, busy: Hint["busy"][number]): string {
  return `${prompt}\n\nStack this on \`${busy.branch}\`: it is still open and already changes ${busy.files.map((f) => `\`${f}\``).join(", ")}. ` +
    `Make your branch from origin/${busy.branch} instead of main, and open your pull request with --base ${busy.branch}. ` +
    `If that branch isn't on origin any more, it has merged: start from main as usual.`;
}
