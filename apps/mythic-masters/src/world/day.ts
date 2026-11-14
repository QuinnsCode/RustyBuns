// The game's day and nothing else: how long one lasts and what hour it is. Its own file so the party's room
// (edge/region.ts, through net/party.ts) can tell night from day without pulling the world in.
export const DAY = 24 * 60;    // seconds of real time one game day takes: a region's walk sees a sunset
export const DAWN_HOUR = 8;    // the walk begins at eight in the morning
/** The hour of the day `t` seconds into the walk. */
export const hourAt = (t: number) => (DAWN_HOUR + (24 * t) / DAY) % 24;
