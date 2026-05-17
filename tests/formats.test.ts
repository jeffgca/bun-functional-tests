import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Bun.TOML.parse
// ---------------------------------------------------------------------------

describe("Bun.TOML.parse", () => {
  test("parses simple key-value pairs", () => {
    const result = Bun.TOML.parse(`name = "bun"\nversion = "1.0.0"`) as Record<string, unknown>;
    expect(result.name).toBe("bun");
    expect(result.version).toBe("1.0.0");
  });

  test("parses integers and floats", () => {
    const result = Bun.TOML.parse(`count = 42\nprice = 3.14`) as Record<string, unknown>;
    expect(result.count).toBe(42);
    expect(result.price).toBeCloseTo(3.14);
  });

  test("parses booleans", () => {
    const result = Bun.TOML.parse(`enabled = true\ndisabled = false`) as Record<string, unknown>;
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
  });

  test("parses arrays", () => {
    const result = Bun.TOML.parse(`tags = ["bun", "fast", "ts"]`) as Record<string, unknown>;
    expect(result.tags).toEqual(["bun", "fast", "ts"]);
  });

  test("parses table sections", () => {
    const result = Bun.TOML.parse(`[server]\nhost = "localhost"\nport = 3000`) as Record<string, any>;
    expect(result.server.host).toBe("localhost");
    expect(result.server.port).toBe(3000);
  });

  test("parses nested tables", () => {
    const toml = `[database]\nhost = "db.local"\n\n[database.credentials]\nuser = "admin"`;
    const result = Bun.TOML.parse(toml) as Record<string, any>;
    expect(result.database.host).toBe("db.local");
    expect(result.database.credentials.user).toBe("admin");
  });

  test("parses array of tables", () => {
    const toml = `[[products]]\nname = "A"\n\n[[products]]\nname = "B"`;
    const result = Bun.TOML.parse(toml) as Record<string, any>;
    expect(result.products).toHaveLength(2);
    expect(result.products[0].name).toBe("A");
    expect(result.products[1].name).toBe("B");
  });

  test("returns an object", () => {
    const result = Bun.TOML.parse(`x = 1`);
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bun.JSONC.parse
// ---------------------------------------------------------------------------

describe("Bun.JSONC.parse", () => {
  test("parses standard JSON", () => {
    const result = Bun.JSONC.parse('{"a":1}') as Record<string, unknown>;
    expect(result.a).toBe(1);
  });

  test("parses JSON with single-line comments", () => {
    const jsonc = `{
      // this is a comment
      "name": "bun"
    }`;
    const result = Bun.JSONC.parse(jsonc) as Record<string, unknown>;
    expect(result.name).toBe("bun");
  });

  test("parses JSON with block comments", () => {
    const jsonc = `{
      /* block comment */
      "value": 42
    }`;
    const result = Bun.JSONC.parse(jsonc) as Record<string, unknown>;
    expect((result as any).value).toBe(42);
  });

  test("parses JSON with trailing commas", () => {
    const jsonc = `{"a": 1, "b": 2,}`;
    const result = Bun.JSONC.parse(jsonc) as Record<string, unknown>;
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });

  test("parses arrays with trailing commas", () => {
    const result = Bun.JSONC.parse("[1, 2, 3,]") as number[];
    expect(result).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

describe("URL", () => {
  test("parses a full URL", () => {
    const url = new URL("https://user:pass@example.com:8080/path?q=1#hash");
    expect(url.protocol).toBe("https:");
    expect(url.username).toBe("user");
    expect(url.password).toBe("pass");
    expect(url.hostname).toBe("example.com");
    expect(url.port).toBe("8080");
    expect(url.pathname).toBe("/path");
    expect(url.search).toBe("?q=1");
    expect(url.hash).toBe("#hash");
  });

  test("href is the full serialized URL", () => {
    const url = new URL("https://example.com/path");
    expect(url.href).toBe("https://example.com/path");
  });

  test("origin combines protocol + host", () => {
    const url = new URL("https://example.com:443/path");
    expect(url.origin).toContain("example.com");
  });

  test("relative URL resolves against base", () => {
    const url = new URL("/foo/bar", "https://example.com");
    expect(url.href).toBe("https://example.com/foo/bar");
  });

  test("mutable properties update href", () => {
    const url = new URL("https://example.com");
    url.pathname = "/new-path";
    expect(url.href).toBe("https://example.com/new-path");
  });

  test("searchParams is a URLSearchParams instance", () => {
    const url = new URL("https://example.com?a=1&b=2");
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.get("b")).toBe("2");
  });

  test("throws on invalid URL", () => {
    expect(() => new URL("not-a-url")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// URLSearchParams
// ---------------------------------------------------------------------------

describe("URLSearchParams", () => {
  test("constructs from string", () => {
    const p = new URLSearchParams("a=1&b=2");
    expect(p.get("a")).toBe("1");
    expect(p.get("b")).toBe("2");
  });

  test("constructs from object", () => {
    const p = new URLSearchParams({ x: "hello", y: "world" });
    expect(p.get("x")).toBe("hello");
  });

  test("append adds duplicate keys", () => {
    const p = new URLSearchParams("a=1");
    p.append("a", "2");
    expect(p.getAll("a")).toEqual(["1", "2"]);
  });

  test("set replaces all values for a key", () => {
    const p = new URLSearchParams("a=1&a=2");
    p.set("a", "99");
    expect(p.getAll("a")).toEqual(["99"]);
  });

  test("delete removes a key", () => {
    const p = new URLSearchParams("a=1&b=2");
    p.delete("a");
    expect(p.has("a")).toBe(false);
    expect(p.has("b")).toBe(true);
  });

  test("has returns true for existing key", () => {
    const p = new URLSearchParams("x=1");
    expect(p.has("x")).toBe(true);
    expect(p.has("z")).toBe(false);
  });

  test("toString serializes correctly", () => {
    const p = new URLSearchParams({ a: "1", b: "2" });
    const str = p.toString();
    expect(str).toContain("a=1");
    expect(str).toContain("b=2");
  });

  test("forEach iterates all entries", () => {
    const p = new URLSearchParams("a=1&b=2&c=3");
    const keys: string[] = [];
    p.forEach((_, k) => keys.push(k));
    expect(keys.sort()).toEqual(["a", "b", "c"]);
  });

  test("keys(), values(), entries() iterators work", () => {
    const p = new URLSearchParams("x=10&y=20");
    expect([...p.keys()].sort()).toEqual(["x", "y"]);
    expect([...p.values()].sort()).toEqual(["10", "20"]);
    expect([...p.entries()].map(([k]) => k).sort()).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

describe("Headers", () => {
  test("constructs from object", () => {
    const h = new Headers({ "content-type": "application/json" });
    expect(h.get("content-type")).toBe("application/json");
  });

  test("get is case-insensitive", () => {
    const h = new Headers({ "X-Custom": "value" });
    expect(h.get("x-custom")).toBe("value");
    expect(h.get("X-CUSTOM")).toBe("value");
  });

  test("set overwrites existing value", () => {
    const h = new Headers();
    h.set("x-foo", "a");
    h.set("x-foo", "b");
    expect(h.get("x-foo")).toBe("b");
  });

  test("append adds to existing header", () => {
    const h = new Headers();
    h.append("accept", "text/html");
    h.append("accept", "application/json");
    const val = h.get("accept")!;
    expect(val).toContain("text/html");
    expect(val).toContain("application/json");
  });

  test("delete removes a header", () => {
    const h = new Headers({ "x-remove": "yes" });
    h.delete("x-remove");
    expect(h.has("x-remove")).toBe(false);
  });

  test("has returns true for existing header", () => {
    const h = new Headers({ "content-length": "42" });
    expect(h.has("content-length")).toBe(true);
    expect(h.has("x-missing")).toBe(false);
  });

  test("forEach iterates all entries", () => {
    const h = new Headers({ a: "1", b: "2" });
    const pairs: [string, string][] = [];
    h.forEach((v, k) => pairs.push([k, v]));
    expect(pairs.length).toBeGreaterThanOrEqual(2);
  });

  test("constructs from entries array", () => {
    const h = new Headers([
      ["content-type", "text/plain"],
      ["x-id", "123"],
    ]);
    expect(h.get("x-id")).toBe("123");
  });
});

// ---------------------------------------------------------------------------
// FormData
// ---------------------------------------------------------------------------

describe("FormData", () => {
  test("append and get a string field", () => {
    const fd = new FormData();
    fd.append("name", "bun");
    expect(fd.get("name")).toBe("bun");
  });

  test("set overwrites existing field", () => {
    const fd = new FormData();
    fd.append("x", "a");
    fd.set("x", "b");
    expect(fd.get("x")).toBe("b");
  });

  test("getAll returns all values for a key", () => {
    const fd = new FormData();
    fd.append("tag", "fast");
    fd.append("tag", "ts");
    expect(fd.getAll("tag")).toEqual(["fast", "ts"]);
  });

  test("has returns true for existing field", () => {
    const fd = new FormData();
    fd.append("key", "val");
    expect(fd.has("key")).toBe(true);
    expect(fd.has("missing")).toBe(false);
  });

  test("delete removes a field", () => {
    const fd = new FormData();
    fd.append("remove-me", "yes");
    fd.delete("remove-me");
    expect(fd.has("remove-me")).toBe(false);
  });

  test("append a Blob as a file field", () => {
    const fd = new FormData();
    const blob = new Blob(["hello"], { type: "text/plain" });
    fd.append("file", blob, "hello.txt");
    const file = fd.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("hello.txt");
  });

  test("forEach iterates all fields", () => {
    const fd = new FormData();
    fd.append("a", "1");
    fd.append("b", "2");
    const keys: string[] = [];
    fd.forEach((_, k) => keys.push(k));
    expect(keys.sort()).toEqual(["a", "b"]);
  });
});
