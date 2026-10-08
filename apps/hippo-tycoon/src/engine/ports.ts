// What the room needs from a platform, as a few structural interfaces. A
// Cloudflare DurableObjectState, the Rusty Buns in-process one, and the fakes
// in the tests all satisfy these without wrapper objects.

export interface EngineSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Per-connection state that must outlive the DO's memory (CF hibernation). */
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface EngineStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  /** The DO alarm: alarm() is called at about this time, even after an eviction. */
  setAlarm?(at: number): Promise<void>;
}

export interface EngineCtx {
  storage: EngineStorage;
  getWebSockets(): EngineSocket[];
}

/** Time, injectable so tests drive the tick loop by hand. */
export interface Clock {
  now(): number;
  schedule(fn: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
