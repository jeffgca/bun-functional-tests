import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const TMP = join(import.meta.dir, "tmp-workers");

// ---------------------------------------------------------------------------
// Helper: promise that resolves on the first "message" event from a Worker
// ---------------------------------------------------------------------------
function nextMessage(worker: Worker): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    worker.onmessage = resolve;
    worker.onerror = reject;
  });
}

// ---------------------------------------------------------------------------
// Worker script paths — written once in beforeAll
// ---------------------------------------------------------------------------
const ECHO_WORKER = join(TMP, "echo.worker.ts");
const MATH_WORKER = join(TMP, "math.worker.ts");
const MULTI_WORKER = join(TMP, "multi.worker.ts");
const ERROR_WORKER = join(TMP, "error.worker.ts");
const SHARED_WORKER = join(TMP, "shared.worker.ts");
const TRANSFERABLE_WORKER = join(TMP, "transferable.worker.ts");
const ENV_WORKER = join(TMP, "env.worker.ts");
const SELF_TERM_WORKER = join(TMP, "self-term.worker.ts");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });

  // Echoes whatever it receives back to the parent
  writeFileSync(ECHO_WORKER, `self.onmessage = (e) => { self.postMessage(e.data); };\n`);

  // Performs simple addition and posts the result
  writeFileSync(
    MATH_WORKER,
    `self.onmessage = (e) => {
  const { a, b } = e.data;
  self.postMessage(a + b);
};\n`,
  );

  // Posts three sequential messages then exits
  writeFileSync(
    MULTI_WORKER,
    `self.postMessage(1);
self.postMessage(2);
self.postMessage(3);\n`,
  );

  // Throws an unhandled error so the parent gets an error event
  writeFileSync(ERROR_WORKER, `throw new Error("worker boom");\n`);

  // Reads an env var and posts it back
  writeFileSync(ENV_WORKER, `self.postMessage(process.env.WORKER_VAR ?? "missing");\n`);

  // Posts the current threadId and immediately terminates itself
  writeFileSync(
    SELF_TERM_WORKER,
    `import { threadId } from "node:worker_threads";
self.postMessage({ threadId });
process.exit(0);\n`,
  );

  // Receives a SharedArrayBuffer, writes to it, then signals done
  writeFileSync(
    SHARED_WORKER,
    `self.onmessage = (e) => {
  const view = new Int32Array(e.data);
  view[0] = 42;
  self.postMessage("done");
};\n`,
  );

  // Receives an ArrayBuffer transfer and posts its byteLength
  writeFileSync(
    TRANSFERABLE_WORKER,
    `self.onmessage = (e) => {
  self.postMessage(e.data.byteLength);
};\n`,
  );
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Basic message passing
// ---------------------------------------------------------------------------

describe("Worker — basic messaging", () => {
  test("echo worker reflects messages back", async () => {
    const w = new Worker(ECHO_WORKER);
    const p = nextMessage(w);
    w.postMessage("hello");
    const e = await p;
    expect(e.data).toBe("hello");
    w.terminate();
  });

  test("sends and receives a plain object", async () => {
    const w = new Worker(ECHO_WORKER);
    const p = nextMessage(w);
    w.postMessage({ x: 1, y: 2 });
    const e = await p;
    expect(e.data).toEqual({ x: 1, y: 2 });
    w.terminate();
  });

  test("math worker computes a + b", async () => {
    const w = new Worker(MATH_WORKER);
    const p = nextMessage(w);
    w.postMessage({ a: 7, b: 8 });
    const e = await p;
    expect(e.data).toBe(15);
    w.terminate();
  });

  test("receives multiple messages in order", async () => {
    const w = new Worker(MULTI_WORKER);
    const results: number[] = [];
    await new Promise<void>((resolve) => {
      w.onmessage = (e) => {
        results.push(e.data);
        if (results.length === 3) resolve();
      };
    });
    w.terminate();
    expect(results).toEqual([1, 2, 3]);
  });

  test("postMessage with nested arrays and numbers", async () => {
    const w = new Worker(ECHO_WORKER);
    const payload = { list: [1, "two", true, null] };
    const p = nextMessage(w);
    w.postMessage(payload);
    const e = await p;
    expect(e.data).toEqual(payload);
    w.terminate();
  });
});

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

describe("Worker — lifecycle", () => {
  test("threadId is a positive integer", async () => {
    const w = new Worker(SELF_TERM_WORKER);
    const e = await nextMessage(w);
    expect(e.data.threadId).toBeGreaterThan(0);
    w.terminate();
  });

  test("terminate() stops a running worker", async () => {
    const w = new Worker(ECHO_WORKER);
    w.terminate();
    // After termination further messages should not arrive
    const timedOut = await Promise.race([nextMessage(w).then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 100))]);
    expect(timedOut).toBe(true);
  });

  test("worker threadId differs from main thread (0 or 1)", async () => {
    const w = new Worker(SELF_TERM_WORKER);
    const e = await nextMessage(w);
    // Main thread is always threadId === 0; workers get a positive id
    expect(e.data.threadId).not.toBe(0);
    w.terminate();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("Worker — error handling", () => {
  test("unhandled error fires onerror on the Worker", async () => {
    const w = new Worker(ERROR_WORKER);
    const err = await new Promise<ErrorEvent>((resolve) => {
      w.onerror = resolve;
    });
    expect(err).toBeDefined();
    w.terminate();
  });
});

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

describe("Worker — environment", () => {
  test("worker receives custom env vars", async () => {
    const w = new Worker(ENV_WORKER, {
      env: { ...process.env, WORKER_VAR: "from_env" },
    });
    const e = await nextMessage(w);
    expect(e.data).toBe("from_env");
    w.terminate();
  });
});

// ---------------------------------------------------------------------------
// Transferable objects
// ---------------------------------------------------------------------------

describe("Worker — transferables", () => {
  test("ArrayBuffer can be transferred to a worker", async () => {
    const w = new Worker(TRANSFERABLE_WORKER);
    const buf = new ArrayBuffer(64);
    const p = nextMessage(w);
    w.postMessage(buf, [buf]);
    const e = await p;
    expect(e.data).toBe(64);
    w.terminate();
  });
});

// ---------------------------------------------------------------------------
// SharedArrayBuffer
// ---------------------------------------------------------------------------

describe("Worker — SharedArrayBuffer", () => {
  test("worker writes to a SharedArrayBuffer visible from main thread", async () => {
    const w = new Worker(SHARED_WORKER);
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    const p = nextMessage(w);
    w.postMessage(sab);
    await p;
    expect(view[0]).toBe(42);
    w.terminate();
  });
});
