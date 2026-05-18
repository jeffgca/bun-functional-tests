export type { TestFailure, TestCase, TestFile, TestResults } from "./lib/runner";
import { runTests } from "./lib/runner";
export { runTests };

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const { parseArgs, printSummary } = await import("./lib/reporter");
  const { createSpinner } = await import("nanospinner");
  const { outfile, verbose, testArgs } = parseArgs(Bun.argv.slice(2));

  const spinner = createSpinner("Running tests...").start();
  let testsCompleted = 0;

  let results;
  try {
    results = await runTests(testArgs, undefined, {
      onProgress: (count) => {
        testsCompleted = count;
        spinner.update({ text: `Running tests... (${count} completed)` });
      },
    });
  } catch (e) {
    spinner.error({ text: String(e) });
    process.exit(1);
  }

  const { summary } = results;
  const statusText = summary.failures > 0 ? `${summary.failures} failed, ${summary.passed} passed (${summary.tests} total)` : `All ${summary.tests} tests passed`;

  if (summary.failures > 0) {
    spinner.error({ text: statusText });
  } else {
    spinner.success({ text: statusText });
  }

  printSummary(results, { verbose });

  if (outfile) {
    await Bun.write(outfile, JSON.stringify(results, null, 2));
  }
  process.exit(summary.failures > 0 ? 1 : 0);
}
