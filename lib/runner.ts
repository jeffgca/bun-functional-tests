import { join } from "node:path";
import { parseStringPromise } from "xml2js";

export const JUNIT_PATH = join(import.meta.dir, "..", "junit.xml");

// ─── Output types ─────────────────────────────────────────────────────────────

export interface TestFailure {
  message: string;
  type: string;
  body: string;
}

export interface TestCase {
  name: string;
  suite: string;
  file: string;
  line: number;
  time: number;
  assertions: number;
  status: "passed" | "failed" | "skipped";
  failure?: TestFailure;
}

export interface TestFile {
  file: string;
  tests: number;
  assertions: number;
  failures: number;
  skipped: number;
  time: number;
  cases: TestCase[];
}

export interface TestResults {
  summary: {
    tests: number;
    assertions: number;
    failures: number;
    skipped: number;
    passed: number;
    time: number;
  };
  files: TestFile[];
}

// ─── xml2js types (parsed shape) ─────────────────────────────────────────────

export interface JUnitAttrs {
  name?: string;
  file?: string;
  line?: string;
  time?: string;
  tests?: string;
  assertions?: string;
  failures?: string;
  skipped?: string;
  classname?: string;
  message?: string;
  type?: string;
}

export interface JUnitTestcase {
  $: JUnitAttrs;
  failure?: [{ $: JUnitAttrs; _?: string }];
  skipped?: [unknown];
}

export interface JUnitTestsuite {
  $: JUnitAttrs;
  testcase?: JUnitTestcase[];
  testsuite?: JUnitTestsuite[];
}

export interface JUnitTestsuites {
  $: JUnitAttrs;
  testsuite?: JUnitTestsuite[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function num(attrs: JUnitAttrs, key: keyof JUnitAttrs, fallback = 0): number {
  const v = attrs[key];
  return v !== undefined ? Number(v) : fallback;
}

export function collectCases(suite: JUnitTestsuite, cases: TestCase[]): void {
  for (const tc of suite.testcase ?? []) {
    const a = tc.$;
    const failureNode = tc.failure?.[0];
    const status = failureNode ? "failed" : tc.skipped ? "skipped" : "passed";
    const entry: TestCase = {
      name: a.name ?? "",
      suite: a.classname ?? "",
      file: a.file ?? "",
      line: num(a, "line"),
      time: num(a, "time"),
      assertions: num(a, "assertions"),
      status,
    };
    if (failureNode) {
      entry.failure = {
        message: failureNode.$?.message ?? "",
        type: failureNode.$?.type ?? "",
        body: failureNode._ ?? "",
      };
    }
    cases.push(entry);
  }
  for (const nested of suite.testsuite ?? []) {
    collectCases(nested, cases);
  }
}

export async function parseJUnit(xml: string): Promise<TestResults> {
  const parsed = await parseStringPromise(xml, { explicitArray: true });
  const root: JUnitTestsuites = parsed.testsuites;
  const ra = root.$;

  const files: TestFile[] = [];
  for (const fileNode of root.testsuite ?? []) {
    const fa = fileNode.$;
    const cases: TestCase[] = [];
    collectCases(fileNode, cases);
    files.push({
      file: fa.file ?? fa.name ?? "",
      tests: num(fa, "tests"),
      assertions: num(fa, "assertions"),
      failures: num(fa, "failures"),
      skipped: num(fa, "skipped"),
      time: num(fa, "time"),
      cases,
    });
  }

  const tests = num(ra, "tests");
  const assertions = num(ra, "assertions");
  const failures = num(ra, "failures");
  const skipped = num(ra, "skipped");
  const time = num(ra, "time");

  return {
    summary: { tests, assertions, failures, skipped, passed: tests - failures - skipped, time },
    files,
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runTests(args: string[] = [], junitPath = JUNIT_PATH): Promise<TestResults> {
  const proc = Bun.spawn({
    cmd: ["bun", "test", ...args, "--reporter=junit", `--reporter-outfile=${junitPath}`],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr || `bun test failed with exit code ${exitCode}`);
  }

  const xml = await Bun.file(junitPath).text();
  return parseJUnit(xml);
}
