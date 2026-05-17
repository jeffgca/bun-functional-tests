import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach, mock, spyOn, jest, setSystemTime } from "bun:test";

// ---------------------------------------------------------------------------
// mock()
// ---------------------------------------------------------------------------

describe("mock() — basic mocks", () => {
  test("mock() creates a callable function", () => {
    const fn = mock();
    expect(typeof fn).toBe("function");
  });

  test("mock().mock.calls tracks calls", () => {
    const fn = mock();
    fn(1, 2);
    fn("a");
    expect(fn.mock.calls.length).toBe(2);
    expect(fn.mock.calls[0]).toEqual([1, 2]);
    expect(fn.mock.calls[1]).toEqual(["a"]);
  });

  test("mock with implementation returns value", () => {
    const fn = mock((x: number) => x * 2);
    expect(fn(5)).toBe(10);
  });

  test("mock.mock.results tracks return values", () => {
    const fn = mock((x: number) => x + 1);
    fn(3);
    fn(7);
    expect(fn.mock.results[0].value).toBe(4);
    expect(fn.mock.results[1].value).toBe(8);
  });

  test("mockReturnValue sets a fixed return", () => {
    const fn = mock().mockReturnValue(42);
    expect(fn()).toBe(42);
    expect(fn()).toBe(42);
  });

  test("mockReturnValueOnce returns value once then falls through", () => {
    const fn = mock().mockReturnValueOnce("first").mockReturnValue("default");
    expect(fn()).toBe("first");
    expect(fn()).toBe("default");
  });

  test("mockImplementation replaces implementation", () => {
    const fn = mock(() => "original");
    fn.mockImplementation(() => "replaced");
    expect(fn()).toBe("replaced");
  });

  test("mockImplementationOnce replaces implementation once", () => {
    const fn = mock(() => "original");
    fn.mockImplementationOnce(() => "once");
    expect(fn()).toBe("once");
    expect(fn()).toBe("original");
  });

  test("mockResolvedValue returns a resolved promise", async () => {
    const fn = mock().mockResolvedValue("async-result");
    await expect(fn()).resolves.toBe("async-result");
  });

  test("mockRejectedValue returns a rejected promise", async () => {
    const fn = mock().mockRejectedValue(new Error("boom"));
    await expect(fn()).rejects.toThrow("boom");
  });

  test("mockClear resets calls and results", () => {
    const fn = mock(() => 1);
    fn();
    fn.mockClear();
    expect(fn.mock.calls.length).toBe(0);
    expect(fn.mock.results.length).toBe(0);
  });

  test("mockReset clears calls and removes implementation", () => {
    const fn = mock(() => 99);
    fn();
    fn.mockReset();
    expect(fn.mock.calls.length).toBe(0);
    expect(fn()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// spyOn()
// ---------------------------------------------------------------------------

describe("spyOn()", () => {
  test("spyOn wraps an object method and tracks calls", () => {
    const obj = { greet: (name: string) => `Hello, ${name}!` };
    const spy = spyOn(obj, "greet");
    const result = obj.greet("World");
    expect(result).toBe("Hello, World!");
    expect(spy.mock.calls.length).toBe(1);
    expect(spy.mock.calls[0]).toEqual(["World"]);
  });

  test("spyOn preserves original behavior by default", () => {
    const obj = { add: (a: number, b: number) => a + b };
    spyOn(obj, "add");
    expect(obj.add(2, 3)).toBe(5);
  });

  test("spyOn can override implementation", () => {
    const obj = { fn: () => "real" };
    const spy = spyOn(obj, "fn").mockImplementation(() => "fake");
    expect(obj.fn()).toBe("fake");
    spy.mockRestore();
    expect(obj.fn()).toBe("real");
  });

  test("mockRestore restores original method", () => {
    const obj = { val: () => 100 };
    const spy = spyOn(obj, "val").mockReturnValue(999);
    expect(obj.val()).toBe(999);
    spy.mockRestore();
    expect(obj.val()).toBe(100);
  });

  test("spyOn tracks calls to built-in Math.random", () => {
    const spy = spyOn(Math, "random").mockReturnValue(0.5);
    expect(Math.random()).toBe(0.5);
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// jest.fn() — alias for mock()
// ---------------------------------------------------------------------------

describe("jest.fn() compatibility", () => {
  test("jest.fn() creates a mock function", () => {
    const fn = jest.fn();
    fn("test");
    expect(fn.mock.calls.length).toBe(1);
  });

  test("jest.fn(impl) uses implementation", () => {
    const fn = jest.fn((x: number) => x * 3);
    expect(fn(4)).toBe(12);
  });

  test("jest.spyOn mirrors spyOn", () => {
    const obj = { compute: () => 7 };
    const spy = jest.spyOn(obj, "compute").mockReturnValue(99);
    expect(obj.compute()).toBe(99);
    spy.mockRestore();
    expect(obj.compute()).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Fake timers — setSystemTime
// ---------------------------------------------------------------------------

describe("fake timers — setSystemTime", () => {
  afterEach(() => {
    // Restore real time after each test
    setSystemTime();
  });

  test("setSystemTime fixes Date.now()", () => {
    const epoch = new Date("2000-01-01T00:00:00Z").getTime();
    setSystemTime(epoch);
    expect(Date.now()).toBe(epoch);
  });

  test("setSystemTime accepts a Date object", () => {
    const d = new Date("2025-06-15T12:00:00Z");
    setSystemTime(d);
    expect(new Date().toISOString().startsWith("2025-06-15")).toBe(true);
  });

  test("new Date() returns mocked time", () => {
    setSystemTime(new Date("1999-12-31T23:59:59Z"));
    const now = new Date();
    expect(now.getFullYear()).toBe(1999);
    expect(now.getMonth()).toBe(11); // December = 11
  });

  test("setSystemTime(0) sets Unix epoch", () => {
    setSystemTime(0);
    expect(Date.now()).toBe(0);
  });

  test("setSystemTime() without arg restores real clock", () => {
    setSystemTime(0);
    setSystemTime();
    // Real time should be after year 2020
    expect(Date.now()).toBeGreaterThan(new Date("2020-01-01").getTime());
  });
});

// ---------------------------------------------------------------------------
// Hook ordering
// ---------------------------------------------------------------------------

const hookOrder: string[] = [];

describe("hook ordering", () => {
  beforeAll(() => {
    hookOrder.push("beforeAll");
  });
  afterAll(() => {
    expect(hookOrder).toEqual(["beforeAll", "beforeEach-1", "test-1", "afterEach-1", "beforeEach-2", "test-2", "afterEach-2"]);
    hookOrder.length = 0;
  });
  beforeEach(() => {
    hookOrder.push(`beforeEach-${hookOrder.filter((s) => s.startsWith("test-")).length + 1}`);
  });
  afterEach(() => {
    hookOrder.push(`afterEach-${hookOrder.filter((s) => s.startsWith("afterEach-")).length + 1}`);
  });

  test("first test runs in order", () => {
    hookOrder.push("test-1");
  });

  test("second test runs in order", () => {
    hookOrder.push("test-2");
  });
});

// ---------------------------------------------------------------------------
// Nested describe scope
// ---------------------------------------------------------------------------

describe("nested describe", () => {
  const log: string[] = [];

  beforeAll(() => log.push("outer-beforeAll"));
  afterAll(() => {
    expect(log).toContain("outer-beforeAll");
    expect(log).toContain("inner-beforeAll");
    expect(log).toContain("inner-test");
    expect(log).toContain("outer-test");
  });

  describe("inner", () => {
    beforeAll(() => log.push("inner-beforeAll"));
    test("inner test", () => {
      log.push("inner-test");
      expect(true).toBe(true);
    });
  });

  test("outer test", () => {
    log.push("outer-test");
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// expect matchers
// ---------------------------------------------------------------------------

describe("expect matchers", () => {
  test("toBeUndefined / toBeDefined", () => {
    expect(undefined).toBeUndefined();
    expect(null).toBeDefined();
    expect(1).toBeDefined();
  });

  test("toBeNull / toBeTruthy / toBeFalsy", () => {
    expect(null).toBeNull();
    expect(1).toBeTruthy();
    expect(0).toBeFalsy();
    expect("").toBeFalsy();
  });

  test("toBeGreaterThan / toBeLessThan / toBeCloseTo", () => {
    expect(5).toBeGreaterThan(4);
    expect(3).toBeLessThan(4);
    expect(0.1 + 0.2).toBeCloseTo(0.3);
  });

  test("toContain for arrays and strings", () => {
    expect([1, 2, 3]).toContain(2);
    expect("hello world").toContain("world");
  });

  test("toHaveLength", () => {
    expect([1, 2, 3]).toHaveLength(3);
    expect("abc").toHaveLength(3);
  });

  test("toMatchObject partial match", () => {
    expect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, c: 3 });
  });

  test("toThrow", () => {
    expect(() => {
      throw new Error("oops");
    }).toThrow("oops");
  });

  test("resolves / rejects", async () => {
    await expect(Promise.resolve(42)).resolves.toBe(42);
    await expect(Promise.reject(new Error("fail"))).rejects.toThrow("fail");
  });

  test("not.toBe", () => {
    expect(1).not.toBe(2);
    expect("a").not.toBe("b");
  });

  test("toBeInstanceOf", () => {
    expect(new Date()).toBeInstanceOf(Date);
    expect([]).toBeInstanceOf(Array);
  });

  test("toStrictEqual", () => {
    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect([1, 2]).toStrictEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Snapshot testing
// ---------------------------------------------------------------------------

describe("snapshot testing", () => {
  test("toMatchSnapshot — primitive", () => {
    expect(42).toMatchSnapshot();
  });

  test("toMatchSnapshot — object", () => {
    expect({ name: "bun", version: 1 }).toMatchSnapshot();
  });

  test("toMatchSnapshot — array", () => {
    expect([1, "two", true]).toMatchSnapshot();
  });

  test("toMatchInlineSnapshot — string", () => {
    expect("hello").toMatchInlineSnapshot(`"hello"`);
  });

  test("toMatchInlineSnapshot — number", () => {
    expect(123).toMatchInlineSnapshot(`123`);
  });
});
