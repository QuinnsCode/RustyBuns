// 🥐 Bun's ahead-of-time compiler (#2216), opt in: bun run desktop:build -- --aot
//
// Bun's docs describe `bun compile` = `bun build --compile --aot`: the whole program as machine code, no JIT, and
// they call it experimental. As of 2026-11-21 no stable Bun has it (1.4.3, 1.4.4 and 1.4.5 have no --aot; canary
// 1.4.6-canary.1 does), so the default build stays the JIT one and --aot builds a second binary, dist/agent-office-<os>-<arch>-aot, next to it.
// AOT only builds for the Mac or Linux it runs on, so --all still makes just the one AOT binary, for this host.
// Compare them with ls -l, bun run desktop:smoke -- --aot, and bun bench/aot.ts.
//
// Measured on canary 1.4.6-canary.1+24e5faf8d, 2026-11-28, macOS arm64 (#5555), JIT → AOT, medians of 5, 20 s idle:
// binary 199 → 133 MB, ready 883 → 801 ms, office RSS 192 → 169 MB, pty host RSS 35 → 27 MB,
// CPU office 0.54 → 0.33 s, pty host 0.12 → 0.03 s. Not measured: a floor with workers on it.
// One trap: import.meta.dir lists the compiled modules, but reading one throws ENOENT.

/** Whether a `bun build --help` text offers --aot. */
export function hasAot(help: string): boolean {
  return /^\s*--aot(?![\w-])/m.test(help);
}

/** The AOT binary's name for a JIT binary's name. */
export const aotName = (jit: string) => `${jit}-aot`;

/** Throws, saying what to do, when the running Bun can't build AOT. */
export async function requireAot(): Promise<void> {
  const help = await Bun.$`${process.execPath} build --help`.nothrow().quiet().text();
  if (!hasAot(help)) {
    throw new Error(`--aot: Bun ${Bun.version} has no ahead-of-time compiler (bun build --aot). ` +
      "It needs a Bun release that ships it; the pinned Bun stays as it is until we choose to move (#2216).");
  }
}
