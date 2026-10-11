// The boards' clock: when they last heard from GitHub, as a time of day in the zone you picked in Settings.

export const KEY = "rustybuns.timezone";

/** Every zone this browser knows, or none if it can't list them. */
export const zones = (): string[] => (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];

/** The browser's own zone, which "Automatic" follows. */
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "3:42 PM PDT · ", for in front of "Updated just now"; a zone the browser doesn't know falls back to its own. */
export function clock(at: number, zone?: string | null, locale?: string): string {
  if (!at) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return `${new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone || undefined }).format(at)} · `;
  } catch {
    return `${new Intl.DateTimeFormat(locale, opts).format(at)} · `;
  }
}
