/** The command that runs only the tests for `only`, or null to run the test script as it is (scoped.mjs). */
export function scopedTest(script: string, only: string[] | undefined, tracked: string[]): string[] | null;
