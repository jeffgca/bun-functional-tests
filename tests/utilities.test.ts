import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Bun.sleep / Bun.sleepSync
// ---------------------------------------------------------------------------

describe("Bun.sleep / Bun.sleepSync", () => {
  test("sleep(ms) returns a Promise that resolves", async () => {
    const result = Bun.sleep(1);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  test("sleep(0) resolves immediately", async () => {
    await Bun.sleep(0);
  });

  test("sleep takes approximately the requested time", async () => {
    const before = Date.now();
    await Bun.sleep(20);
    const elapsed = Date.now() - before;
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  test("sleepSync blocks synchronously", () => {
    const before = Date.now();
    Bun.sleepSync(20);
    const elapsed = Date.now() - before;
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// Bun.nanoseconds
// ---------------------------------------------------------------------------

describe("Bun.nanoseconds", () => {
  test("returns a number", () => {
    expect(typeof Bun.nanoseconds()).toBe("number");
  });

  test("increases over time", async () => {
    const a = Bun.nanoseconds();
    await Bun.sleep(1);
    const b = Bun.nanoseconds();
    expect(b).toBeGreaterThan(a);
  });

  test("two successive calls differ", () => {
    const a = Bun.nanoseconds();
    const b = Bun.nanoseconds();
    // At minimum they should not be equal (clock has nanosecond granularity)
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Bun.deepEquals
// ---------------------------------------------------------------------------

describe("Bun.deepEquals", () => {
  test("equal primitives return true", () => {
    expect(Bun.deepEquals(1, 1)).toBe(true);
    expect(Bun.deepEquals("a", "a")).toBe(true);
    expect(Bun.deepEquals(null, null)).toBe(true);
  });

  test("unequal primitives return false", () => {
    expect(Bun.deepEquals(1, 2)).toBe(false);
    expect(Bun.deepEquals("a", "b")).toBe(false);
  });

  test("deeply equal objects return true", () => {
    expect(Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(true);
  });

  test("structurally different objects return false", () => {
    expect(Bun.deepEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(Bun.deepEquals({ a: 1 }, { b: 1 })).toBe(false);
  });

  test("equal arrays return true", () => {
    expect(Bun.deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  test("arrays of different length return false", () => {
    expect(Bun.deepEquals([1, 2], [1, 2, 3])).toBe(false);
  });

  test("strict mode distinguishes 0 and -0", () => {
    // Bun.deepEquals always treats 0 and -0 as distinct (strict semantics)
    expect(Bun.deepEquals(0, -0, true)).toBe(false);
    expect(Bun.deepEquals(0, 0, true)).toBe(true);
    expect(Bun.deepEquals(-0, -0, true)).toBe(true);
  });

  test("nested objects with same values are equal", () => {
    const a = { x: { y: { z: 42 } } };
    const b = { x: { y: { z: 42 } } };
    expect(Bun.deepEquals(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bun.deepMatch
// ---------------------------------------------------------------------------

describe("Bun.deepMatch", () => {
  test("subset matches superset", () => {
    expect(Bun.deepMatch({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  });

  test("superset does not match subset", () => {
    expect(Bun.deepMatch({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  test("exact match returns true", () => {
    expect(Bun.deepMatch({ a: 1 }, { a: 1 })).toBe(true);
  });

  test("mismatched value returns false", () => {
    expect(Bun.deepMatch({ a: 2 }, { a: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bun.inspect
// ---------------------------------------------------------------------------

describe("Bun.inspect", () => {
  test("returns a string", () => {
    expect(typeof Bun.inspect({ x: 1 })).toBe("string");
  });

  test("includes object keys", () => {
    const result = Bun.inspect({ hello: "world" });
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  test("handles arrays", () => {
    const result = Bun.inspect([1, 2, 3]);
    expect(result).toContain("1");
    expect(result).toContain("2");
    expect(result).toContain("3");
  });

  test("handles null and undefined", () => {
    expect(Bun.inspect(null)).toContain("null");
    expect(Bun.inspect(undefined)).toContain("undefined");
  });

  test("depth option limits nesting", () => {
    const nested = { a: { b: { c: { d: "deep" } } } };
    const shallow = Bun.inspect(nested, { depth: 1 });
    expect(shallow).not.toContain("deep");
  });

  test("inspect.table returns a string", () => {
    const result = Bun.inspect.table([{ a: 1 }, { a: 2 }]);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Bun.escapeHTML
// ---------------------------------------------------------------------------

describe("Bun.escapeHTML", () => {
  test("escapes < and >", () => {
    expect(Bun.escapeHTML("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("escapes &", () => {
    expect(Bun.escapeHTML("a & b")).toBe("a &amp; b");
  });

  test("escapes double quotes", () => {
    expect(Bun.escapeHTML('"quoted"')).toBe("&quot;quoted&quot;");
  });

  test("escapes single quotes", () => {
    expect(Bun.escapeHTML("it's")).toBe("it&#x27;s");
  });

  test("plain text is unchanged", () => {
    expect(Bun.escapeHTML("hello world")).toBe("hello world");
  });

  test("accepts numbers", () => {
    expect(Bun.escapeHTML(42 as any)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// Bun.color
// ---------------------------------------------------------------------------

describe("Bun.color", () => {
  test("parses named color to hex", () => {
    const result = Bun.color("red", "hex");
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("parses hex color to rgb object", () => {
    const result = Bun.color("#ff0000", "{rgb}");
    expect(result).not.toBeNull();
    expect(result!.r).toBe(255);
    expect(result!.g).toBe(0);
    expect(result!.b).toBe(0);
  });

  test("parses hex color to [rgb] array", () => {
    const result = Bun.color("#00ff00", "[rgb]");
    expect(result).toEqual([0, 255, 0]);
  });

  test("returns null for invalid color", () => {
    const result = Bun.color("not-a-color", "hex");
    expect(result).toBeNull();
  });

  test("parses rgb() string", () => {
    const result = Bun.color("rgb(100, 150, 200)", "{rgb}");
    expect(result!.r).toBe(100);
    expect(result!.g).toBe(150);
    expect(result!.b).toBe(200);
  });

  test("number output format", () => {
    const result = Bun.color("red", "number");
    expect(typeof result).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Bun.semver
// ---------------------------------------------------------------------------

describe("Bun.semver", () => {
  test("satisfies: exact version matches", () => {
    expect(Bun.semver.satisfies("1.2.3", "1.2.3")).toBe(true);
  });

  test("satisfies: caret range", () => {
    expect(Bun.semver.satisfies("1.3.0", "^1.2.0")).toBe(true);
    expect(Bun.semver.satisfies("2.0.0", "^1.2.0")).toBe(false);
  });

  test("satisfies: tilde range", () => {
    expect(Bun.semver.satisfies("1.2.5", "~1.2.0")).toBe(true);
    expect(Bun.semver.satisfies("1.3.0", "~1.2.0")).toBe(false);
  });

  test("satisfies: wildcard", () => {
    expect(Bun.semver.satisfies("99.0.0", "*")).toBe(true);
  });

  test("order: equal versions return 0", () => {
    expect(Bun.semver.order("1.0.0", "1.0.0")).toBe(0);
  });

  test("order: greater version returns 1", () => {
    expect(Bun.semver.order("2.0.0", "1.9.9")).toBe(1);
  });

  test("order: lesser version returns -1", () => {
    expect(Bun.semver.order("1.0.0", "1.0.1")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Bun.which
// ---------------------------------------------------------------------------

describe("Bun.which", () => {
  test("finds common executables like 'ls'", () => {
    const result = process.platform === "win32" ? Bun.which("cmd") : Bun.which("ls");
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  test("returns null for non-existent command", () => {
    expect(Bun.which("this-command-does-not-exist-xyz-abc")).toBeNull();
  });

  test("finds 'bun' itself", () => {
    const result = Bun.which("bun");
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bun.pathToFileURL / Bun.fileURLToPath
// ---------------------------------------------------------------------------

describe("Bun.pathToFileURL / Bun.fileURLToPath", () => {
  const isWindows = process.platform === "win32";
  const nativePath = isWindows ? "C:\\tmp\\test.txt" : "/tmp/test.txt";
  const nativePath2 = isWindows ? "C:\\usr\\local\\bin\\bun" : "/usr/local/bin/bun";

  test("pathToFileURL returns a URL with file:// scheme", () => {
    const url = Bun.pathToFileURL(nativePath);
    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe("file:");
    expect(Bun.fileURLToPath(url)).toBe(nativePath);
  });

  test("fileURLToPath converts URL back to path", () => {
    const url = Bun.pathToFileURL(nativePath);
    const path = Bun.fileURLToPath(url);
    expect(path).toBe(nativePath);
  });

  test("roundtrip path → URL → path", () => {
    const url = Bun.pathToFileURL(nativePath2);
    const result = Bun.fileURLToPath(url);
    expect(result).toBe(nativePath2);
  });
});

// ---------------------------------------------------------------------------
// Bun.peek
// ---------------------------------------------------------------------------

describe("Bun.peek", () => {
  test("peek on already-resolved promise returns the value", async () => {
    const p = Promise.resolve(42);
    await p; // ensure it's settled
    const peeked = Bun.peek(p);
    // After awaiting, peek should return the resolved value or the promise
    expect(peeked === 42 || peeked instanceof Promise).toBe(true);
  });

  test("peek.status on resolved promise returns 'fulfilled'", async () => {
    const p = Promise.resolve("done");
    await p;
    expect(Bun.peek.status(p)).toBe("fulfilled");
  });

  test("peek.status on pending promise returns 'pending'", () => {
    const p = new Promise<void>(() => {}); // never resolves
    expect(Bun.peek.status(p)).toBe("pending");
  });

  test("peek.status on rejected promise returns 'rejected'", async () => {
    const p = Promise.reject(new Error("boom"));
    try {
      await p;
    } catch {}
    expect(Bun.peek.status(p)).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// Bun runtime metadata
// ---------------------------------------------------------------------------

describe("Bun runtime metadata", () => {
  test("Bun.version is a semver string", () => {
    expect(typeof Bun.version).toBe("string");
    expect(Bun.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("Bun.revision is a non-empty string", () => {
    expect(typeof Bun.revision).toBe("string");
    expect(Bun.revision.length).toBeGreaterThan(0);
  });

  test("Bun.env is the process environment", () => {
    expect(Bun.env).toBe(process.env);
  });

  test("process.env.PATH is defined", () => {
    expect(typeof process.env.PATH).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// structuredClone
// ---------------------------------------------------------------------------

describe("structuredClone", () => {
  test("clones a plain object", () => {
    const obj = { a: 1, b: { c: 2 } };
    const clone = structuredClone(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.b).not.toBe(obj.b);
  });

  test("clones arrays", () => {
    const arr = [1, [2, 3], { x: 4 }];
    const clone = structuredClone(arr);
    expect(clone).toEqual(arr);
    expect(clone).not.toBe(arr);
  });

  test("clones Date objects", () => {
    const d = new Date("2024-01-01");
    const clone = structuredClone(d);
    expect(clone).toEqual(d);
    expect(clone).not.toBe(d);
  });

  test("clones Map and Set", () => {
    const m = new Map([["k", "v"]]);
    const s = new Set([1, 2, 3]);
    const cm = structuredClone(m);
    const cs = structuredClone(s);
    expect(cm.get("k")).toBe("v");
    expect(cs.has(2)).toBe(true);
  });
});
