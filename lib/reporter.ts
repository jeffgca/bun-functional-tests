import type { TestResults } from "./runner";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function color(code: string, s: string) {
  return `${code}${s}${RESET}`;
}
function bold(s: string) {
  return color(BOLD, s);
}
function dim(s: string) {
  return color(DIM, s);
}
function red(s: string) {
  return color(RED, s);
}
function green(s: string) {
  return color(GREEN, s);
}
function yellow(s: string) {
  return color(YELLOW, s);
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): { outfile: string | null; verbose: boolean; testArgs: string[] } {
  const testArgs: string[] = [];
  let outfile: string | null = null;
  let verbose = false;
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--outfile") {
      outfile = argv[i + 1] ?? null;
      i += 2;
    } else if (argv[i] === "--verbose") {
      verbose = true;
      i++;
    } else {
      testArgs.push(argv[i]);
      i++;
    }
  }
  return { outfile, verbose, testArgs };
}

// ─── Summary printer ──────────────────────────────────────────────────────────

export function printSummary(results: TestResults, options: { verbose?: boolean } = {}): void {
  const { verbose = false } = options;
  const { summary, files } = results;
  const passed = summary.failures === 0;
  const hr = dim("─".repeat(60));

  // Status banner
  console.log();
  if (passed) {
    console.log(bold(green("  ✓ PASS")));
  } else {
    console.log(bold(red("  ✗ FAIL")));
  }

  // Overall summary row (always shown)
  console.log();
  const parts = [`Tests: ${bold(String(summary.tests))}`, `Passed: ${bold(green(String(summary.passed)))}`, summary.failures > 0 ? `Failed: ${bold(red(String(summary.failures)))}` : `Failed: ${bold(String(summary.failures))}`, summary.skipped > 0 ? `Skipped: ${bold(yellow(String(summary.skipped)))}` : `Skipped: ${bold(String(summary.skipped))}`, `Time: ${bold(summary.time.toFixed(2) + "s")}`];
  console.log("  " + parts.join("  |  "));

  // Per-file table:
  //   verbose        → show all files
  //   failures exist → show only failed files
  //   all pass       → hide file list
  const filesToShow = verbose ? files : files.filter((f) => f.failures > 0);

  if (filesToShow.length > 0) {
    console.log();
    console.log(hr);
    for (const file of filesToShow) {
      const fileHasFailed = file.failures > 0;
      const indicator = fileHasFailed ? red("✗") : green("✓");
      const fileLine = `  ${indicator}  ${file.file}`;
      const counts = `${file.tests} tests, ${file.failures} failed, ${file.skipped} skipped`;
      if (fileHasFailed) {
        console.log(`${bold(red(fileLine))}  ${dim(counts)}`);
      } else {
        console.log(`${dim(fileLine)}  ${dim(counts)}`);
      }
    }
  }

  // Failure detail block
  const failedCases = files.flatMap((f) => f.cases.filter((c) => c.status === "failed"));
  if (failedCases.length > 0) {
    console.log();
    console.log(hr);
    console.log(bold(red("  Failures")));
    console.log();
    for (const tc of failedCases) {
      const suitePart = tc.suite ? `${tc.suite} > ` : "";
      console.log(`  ${bold(red(`${suitePart}${tc.name}`))}`);
      console.log(`  ${dim(`${tc.file}:${tc.line}`)}`);
      if (tc.failure) {
        if (tc.failure.message) {
          console.log(`    ${red(tc.failure.message)}`);
        }
        if (tc.failure.body) {
          for (const line of tc.failure.body.split("\n")) {
            console.log(`    ${red(line)}`);
          }
        }
      }
      console.log();
    }
  }

  console.log(hr);
  console.log();
}
