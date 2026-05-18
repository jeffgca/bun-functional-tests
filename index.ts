export type { TestFailure, TestCase, TestFile, TestResults } from "./lib/runner";
import { runTests } from "./lib/runner";
export { runTests };

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const { parseArgs, printSummary } = await import("./lib/reporter");
  const { outfile, testArgs } = parseArgs(Bun.argv.slice(2));
  const results = await runTests(testArgs);
  printSummary(results);
  if (outfile) {
    await Bun.write(outfile, JSON.stringify(results, null, 2));
  }
  process.exit(results.summary.failures > 0 ? 1 : 0);
}
