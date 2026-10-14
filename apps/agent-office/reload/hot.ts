// A page script that can be swapped in place says so: hot("rb-clock", () => undo what it did). When the rebuild moves
// only such scripts, reload/index.ts calls dispose, then imports the new file, instead of refreshing the page.
export interface Hot { dispose: () => void }

export const hot = (name: string, dispose: () => void) => {
  const g = globalThis as { __rbHot?: Record<string, Hot> };
  (g.__rbHot ??= {})[name] = { dispose };
};
