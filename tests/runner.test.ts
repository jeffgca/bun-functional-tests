import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { num, collectCases, parseJUnit, runTests } from "../lib/runner";
import type { JUnitAttrs, JUnitTestsuite, TestCase } from "../lib/runner";

// ─── num() ────────────────────────────────────────────────────────────────────

describe("num()", () => {
  test("returns the numeric value of the key", () => {
    const attrs: JUnitAttrs = { tests: "42", time: "1.5" };
    expect(num(attrs, "tests")).toBe(42);
    expect(num(attrs, "time")).toBe(1.5);
  });

  test("returns fallback when key is absent", () => {
    const attrs: JUnitAttrs = {};
    expect(num(attrs, "failures")).toBe(0);
    expect(num(attrs, "failures", 99)).toBe(99);
  });
});

// ─── collectCases() ───────────────────────────────────────────────────────────

describe("collectCases()", () => {
  test("collects a passing test case", () => {
    const suite: JUnitTestsuite = {
      $: { name: "Suite" },
      testcase: [
        {
          $: {
            name: "passes",
            classname: "My Suite",
            file: "tests/foo.test.ts",
            line: "5",
            time: "0.1",
            assertions: "1",
          },
        },
      ],
    };
    const cases: TestCase[] = [];
    collectCases(suite, cases);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      name: "passes",
      suite: "My Suite",
      file: "tests/foo.test.ts",
      line: 5,
      time: 0.1,
      assertions: 1,
      status: "passed",
    });
    expect(cases[0].failure).toBeUndefined();
  });

  test("marks a test as failed when a <failure> element is present", () => {
    const suite: JUnitTestsuite = {
      $: { name: "Suite" },
      testcase: [
        {
          $: { name: "fails", classname: "Suite", file: "f.ts", line: "10", time: "0.2", assertions: "1" },
          failure: [{ $: { message: "Expected 1 to be 2", type: "AssertionError" }, _: "stack trace here" }],
        },
      ],
    };
    const cases: TestCase[] = [];
    collectCases(suite, cases);
    expect(cases[0].status).toBe("failed");
    expect(cases[0].failure).toEqual({
      message: "Expected 1 to be 2",
      type: "AssertionError",
      body: "stack trace here",
    });
  });

  test("marks a test as skipped when a <skipped> element is present", () => {
    const suite: JUnitTestsuite = {
      $: { name: "Suite" },
      testcase: [
        {
          $: { name: "todo", classname: "Suite", file: "f.ts", line: "1", time: "0", assertions: "0" },
          skipped: [{}],
        },
      ],
    };
    const cases: TestCase[] = [];
    collectCases(suite, cases);
    expect(cases[0].status).toBe("skipped");
  });

  test("recursively collects from nested suites", () => {
    const inner: JUnitTestsuite = {
      $: { name: "Inner" },
      testcase: [{ $: { name: "inner test", classname: "Inner", file: "f.ts", line: "1", time: "0.05", assertions: "1" } }],
    };
    const outer: JUnitTestsuite = {
      $: { name: "Outer" },
      testcase: [{ $: { name: "outer test", classname: "Outer", file: "f.ts", line: "10", time: "0.05", assertions: "1" } }],
      testsuite: [inner],
    };
    const cases: TestCase[] = [];
    collectCases(outer, cases);
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.name)).toEqual(["outer test", "inner test"]);
  });

  test("handles empty suite gracefully", () => {
    const suite: JUnitTestsuite = { $: { name: "Empty" } };
    const cases: TestCase[] = [];
    collectCases(suite, cases);
    expect(cases).toHaveLength(0);
  });
});

// ─── parseJUnit() ─────────────────────────────────────────────────────────────

const ALL_PASSING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="2" failures="0" skipped="0" time="0.3">
  <testsuite name="tests/a.test.ts" file="tests/a.test.ts" tests="2" assertions="2" failures="0" skipped="0" time="0.3">
    <testcase name="first" classname="Suite" file="tests/a.test.ts" line="5" time="0.1" assertions="1"/>
    <testcase name="second" classname="Suite" file="tests/a.test.ts" line="10" time="0.2" assertions="1"/>
  </testsuite>
</testsuites>`;

const WITH_FAILURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="2" failures="1" skipped="0" time="0.5">
  <testsuite name="tests/b.test.ts" file="tests/b.test.ts" tests="2" assertions="2" failures="1" skipped="0" time="0.5">
    <testcase name="passes" classname="Suite B" file="tests/b.test.ts" line="3" time="0.1" assertions="1"/>
    <testcase name="fails" classname="Suite B" file="tests/b.test.ts" line="8" time="0.4" assertions="1">
      <failure message="Expected 1 to equal 2" type="AssertionError">Error: Expected 1 to equal 2
  at tests/b.test.ts:9</failure>
    </testcase>
  </testsuite>
</testsuites>`;

const WITH_SKIPPED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="2" failures="0" skipped="1" time="0.2">
  <testsuite name="tests/c.test.ts" file="tests/c.test.ts" tests="3" assertions="2" failures="0" skipped="1" time="0.2">
    <testcase name="runs" classname="Suite C" file="tests/c.test.ts" line="3" time="0.1" assertions="1"/>
    <testcase name="also runs" classname="Suite C" file="tests/c.test.ts" line="7" time="0.1" assertions="1"/>
    <testcase name="skipped" classname="Suite C" file="tests/c.test.ts" line="11" time="0" assertions="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

const MULTI_FILE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="3" failures="0" skipped="0" time="0.6">
  <testsuite name="tests/one.test.ts" file="tests/one.test.ts" tests="1" assertions="1" failures="0" skipped="0" time="0.3">
    <testcase name="test in one" classname="One" file="tests/one.test.ts" line="1" time="0.3" assertions="1"/>
  </testsuite>
  <testsuite name="tests/two.test.ts" file="tests/two.test.ts" tests="2" assertions="2" failures="0" skipped="0" time="0.3">
    <testcase name="test a" classname="Two" file="tests/two.test.ts" line="1" time="0.1" assertions="1"/>
    <testcase name="test b" classname="Two" file="tests/two.test.ts" line="5" time="0.2" assertions="1"/>
  </testsuite>
</testsuites>`;

describe("parseJUnit()", () => {
  test("summary counts for all-passing XML", async () => {
    const result = await parseJUnit(ALL_PASSING_XML);
    expect(result.summary).toEqual({ tests: 2, assertions: 2, failures: 0, skipped: 0, passed: 2, time: 0.3 });
  });

  test("produces one file entry per <testsuite>", async () => {
    const result = await parseJUnit(ALL_PASSING_XML);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe("tests/a.test.ts");
  });

  test("cases are populated correctly", async () => {
    const result = await parseJUnit(ALL_PASSING_XML);
    expect(result.files[0].cases).toHaveLength(2);
    expect(result.files[0].cases[0]).toMatchObject({ name: "first", status: "passed" });
    expect(result.files[0].cases[1]).toMatchObject({ name: "second", status: "passed" });
  });

  test("summary reflects failures", async () => {
    const result = await parseJUnit(WITH_FAILURE_XML);
    expect(result.summary.failures).toBe(1);
    expect(result.summary.passed).toBe(1);
  });

  test("failed case includes failure detail", async () => {
    const result = await parseJUnit(WITH_FAILURE_XML);
    const failedCase = result.files[0].cases.find((c) => c.status === "failed");
    expect(failedCase).toBeDefined();
    expect(failedCase!.failure?.message).toBe("Expected 1 to equal 2");
    expect(failedCase!.failure?.type).toBe("AssertionError");
    expect(failedCase!.failure?.body).toContain("b.test.ts:9");
  });

  test("summary reflects skipped tests", async () => {
    const result = await parseJUnit(WITH_SKIPPED_XML);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.passed).toBe(2);
  });

  test("skipped case has correct status", async () => {
    const result = await parseJUnit(WITH_SKIPPED_XML);
    const skippedCase = result.files[0].cases.find((c) => c.status === "skipped");
    expect(skippedCase).toBeDefined();
    expect(skippedCase!.name).toBe("skipped");
  });

  test("multiple files are captured as separate entries", async () => {
    const result = await parseJUnit(MULTI_FILE_XML);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].file).toBe("tests/one.test.ts");
    expect(result.files[1].file).toBe("tests/two.test.ts");
    expect(result.files[0].cases).toHaveLength(1);
    expect(result.files[1].cases).toHaveLength(2);
  });

  test("passed = tests - failures - skipped", async () => {
    const result = await parseJUnit(WITH_FAILURE_XML);
    const { tests, failures, skipped, passed } = result.summary;
    expect(passed).toBe(tests - failures - skipped);
  });
});

// ─── runTests() ───────────────────────────────────────────────────────────────

describe("runTests()", () => {
  const TEMP_JUNIT = join(import.meta.dir, "../junit-runner-test.xml");

  afterAll(async () => {
    // clean up the temp JUnit file
    const f = Bun.file(TEMP_JUNIT);
    if (await f.exists()) await Bun.$`rm ${TEMP_JUNIT}`.quiet();
  });

  test("runs a test file and returns structured results", async () => {
    // Run only this suite's own passing unit tests (num, collectCases, parseJUnit)
    // by targeting this file, but to avoid recursion we pass a simple fixture.
    // We use a real bun test run against a minimal inline test file.
    const tmpFile = join(import.meta.dir, "../_runner_smoke_test.ts");
    await Bun.write(tmpFile, `import { test, expect } from "bun:test";\ntest("smoke", () => { expect(1).toBe(1); });\n`);
    try {
      const { runTests: rt } = await import("../lib/runner");
      const results = await rt([tmpFile], TEMP_JUNIT);
      expect(results.summary.tests).toBeGreaterThanOrEqual(1);
      expect(results.summary.failures).toBe(0);
      expect(results.files.length).toBeGreaterThanOrEqual(1);
      const smokeCase = results.files.flatMap((f) => f.cases).find((c) => c.name === "smoke");
      expect(smokeCase?.status).toBe("passed");
    } finally {
      await Bun.$`rm ${tmpFile}`.quiet();
    }
  }, 10000);
});
