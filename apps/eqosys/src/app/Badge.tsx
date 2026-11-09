// An app's maturity as a small lucide badge, on its tile and its page.
import type { Maturity } from "../apps.ts";

const Icon = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

// Lucide's sprout, leaf and flask-conical (ISC).
const BADGES: Record<Maturity, { label: string; tip: string; icon: React.ReactNode }> = {
  alpha: { label: "Alpha", tip: "Alpha: early, and changing fast", icon: <><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></> },
  beta: { label: "Beta", tip: "Beta: works, still being polished", icon: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></> },
  experimental: { label: "Experimental", tip: "Experimental: an idea being tried out", icon: <><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" /><path d="M6.453 15h11.094" /><path d="M8.5 2h7" /></> },
};

/** A maturity badge: a lucide icon, with the word as its tooltip and its accessible name. */
export const Badge = ({ m }: { m: Maturity }) => {
  const b = BADGES[m];
  return <span className={`badge-m ${m}`} title={b.tip} role="img" aria-label={b.label}><Icon>{b.icon}</Icon></span>;
};
