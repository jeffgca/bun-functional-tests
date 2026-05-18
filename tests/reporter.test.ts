import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { parseArgs, printSummary } from "../lib/reporter";
import type { TestResults } from "../lib/runner";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PASSING_RESULTS: TestResults = {
  summary: { tests: 3, assertions: 3, failures: 0, skipped: 0, passed: 3, time: 0.5 },
  files: [
    {
      file: "tests/a.test.ts",
      tests: 3,
      assertions: 3,
      failures: 0,
      skipped: 0,
      time: 0.5,
      cases: [
        { name: "first", suite: "Suite A", file: "tests/a.test.ts", line: 5, time: 0.1, assertions: 1, status: "passed" },
        { name: "second", suite: "Suite A", file: "tests/a.test.ts", line: 10, time: 0.2, assertions: 1, status: "passed" },
        { name: "third", suite: "Suite A", file: "tests/a.test.ts", line: 15, time: 0.2, assertions: 1, status: "passed" },
      ],
    },
  ],
};

const FAILING_RESULTS: TestResults = {
  summary: { tests: 2, assertions: 2, failures: 1, skipped: 0, passed: 1, time: 0.8 },
  files: [
    {
      file: "tests/b.test.ts",
      tests: 2,
      assertions: 2,
      failures: 1,
      skipped: 0,
      time: 0.8,
      cases: [
        { name: "passes", suite: "Suite B", file: "tests/b.test.ts", line: 3, time: 0.1, assertions: 1, status: "passed" },
        {
          name: "fails",
          suite: "Suite B",
          file: "tests/b.test.ts",
          line: 8,
          time: 0.7,
          assertions: 1,
          status: "failed",
          failure: { message: "Expected 1 to equal 2", type: "AssertionError", body: "Error: Expected 1 to equal 2\n  at tests/b.test.ts:9" },
        },
      ],
    },
  ],
};

const SKIPPED_RESULTS: TestResults = {
  summary: { tests: 2, assertions: 1, failures: 0, skipped: 1, passed: 1, time: 0.2 },
  files: [
    {
      file: "tests/c.test.ts",
      tests: 2,
      assertions: 1,
      failures: 0,
      skipped: 1,
      time: 0.2,
      cases: [
        { name: "runs", suite: "Suite C", file: "tests/c.test.ts", line: 3, time: 0.2, assertions: 1, status: "passed" },
        { name: "todo test", suite: "Suite C", file: "tests/c.test.ts", line: 7, time: 0, assertions: 0, status: "skipped" },
      ],
    },
  ],
};

// ─── parseArgs() ─────────────────────────────────────────────────────────────

describe("parseArgs()", () => {
  test("returns empty testArgs and null outfile when given no args", () => {
    expect(parseArgs([])).toEqual({ outfile: null, testArgs: [] });
  });

  test("passes through non-outfile args as testArgs", () => {
    const result = parseArgs(["tests/foo.test.ts", "--timeout", "5000"]);
    expect(result).toEqual({ outfile: null, testArgs: ["tests/foo.test.ts", "--timeout", "5000"] });
  });

  test("extracts --outfile value and removes both tokens from testArgs", () => {
    const result = parseArgs(["--outfile", "/tmp/out.json"]);
    expect(result).toEqual({ outfile: "/tmp/out.json", testArgs: [] });
  });

  test("strips --outfile from the middle of the arg list", () => {
    const result = parseArgs(["tests/a.test.ts", "--outfile", "/tmp/out.json", "--timeout", "5000"]);
    expect(result).toEqual({
      outfile: "/tmp/out.json",
      testArgs: ["tests/a.test.ts", "--timeout", "5000"],
    });
  });

  test("returns null outfile when --outfile appears last with no value", () => {
    const result = parseArgs(["tests/a.test.ts", "--outfile"]);
    expect(result.outfile).toBeNull();
    expect(result.testArgs).toEqual(["tests/a.test.ts"]);
  });
});

// ─── printSummary() ──────────────────────────────────────────────────────────

describe("printSummary()", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    (console.log as ReturnType<typeof spyOn>).mockRestore();
  });

  // Strip ANSI codes for readable assertions
  function plain(s: string) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
  }
  function plainLines() {
    return lines.map(plain);
  }

  test("prints PASS banner for all-passing results", () => {
    printSummary(PASSING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("✓ PASS");
    expect(output).not.toContain("✗ FAIL");
  });

  test("prints FAIL banner when there are failures", () => {
    printSummary(FAILING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("✗ FAIL");
    expect(output).not.toContain("✓ PASS");
  });

  test("summary row contains counts and time", () => {
    printSummary(PASSING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("Tests: 3");
    expect(output).toContain("Passed: 3");
    expect(output).toContain("Failed: 0");
    expect(output).toContain("Skipped: 0");
    expect(output).toContain("Time: 0.50s");
  });

  test("summary row reflects failure counts", () => {
    printSummary(FAILING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("Failed: 1");
    expect(output).toContain("Passed: 1");
  });

  test("prints per-file entry for each file", () => {
    printSummary(PASSING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("tests/a.test.ts");
  });

  test("does not print failure block when all tests pass", () => {
    printSummary(PASSING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).not.toContain("Failures");
  });

  test("prints failure block with test name when there are failures", () => {
    printSummary(FAILING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("Failures");
    expect(output).toContain("Suite B > fails");
  });

  test("failure block includes file and line number", () => {
    printSummary(FAILING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("tests/b.test.ts:8");
  });

  test("failure block includes failure message", () => {
    printSummary(FAILING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("Expected 1 to equal 2");
  });

  test("failure block includes failure body", () => {
    printSummary(FAILING_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("tests/b.test.ts:9");
  });

  test("skipped count shown in summary row", () => {
    printSummary(SKIPPED_RESULTS);
    const output = plainLines().join("\n");
    expect(output).toContain("Skipped: 1");
  });
});

// ─── --outfile integration ────────────────────────────────────────────────────

describe("--outfile integration", () => {
  test("writes JSON results to file when outfile is specified", async () => {
    const outfile = `/tmp/reporter-test-${Date.now()}.json`;
    const results = PASSING_RESULTS;
    await Bun.write(outfile, JSON.stringify(results, null, 2));
    const written = await Bun.file(outfile).text();
    const parsed = JSON.parse(written);
    expect(parsed.summary.tests).toBe(3);
    expect(parsed.summary.passed).toBe(3);
  });
});
