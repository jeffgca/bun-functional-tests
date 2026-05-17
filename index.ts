export type { TestFailure, TestCase, TestFile, TestResults } from "./lib/runner";
import { runTests } from "./lib/runner";
export { runTests };

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const results = await runTests(Bun.argv.slice(2));
  console.log(JSON.stringify(results, null, 2));
}
