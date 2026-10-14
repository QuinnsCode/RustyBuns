export const POINTS: Record<string, number>;
export const BPM: number;
type Feature = { slug: string; title: string };
type Cast = { id: string; tiers: Record<string, string> };
export function columns(features: Feature[], vote: Cast | null | undefined, votes: Cast[]): (Feature & { i: number; h: number; avg: number })[];
export function nextIndex(votes: Cast[], at: number, seen: Set<string>): number;
export function ballot(zones: Record<string, string[]>): Record<string, string>;
