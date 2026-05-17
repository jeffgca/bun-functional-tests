import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const { Glob, FileSystemRouter } = Bun;

// ---------------------------------------------------------------------------
// Setup: create a temporary directory tree for both Glob and FileSystemRouter
// ---------------------------------------------------------------------------

const TMP = join(import.meta.dir, "tmp-glob");
const PAGES = join(TMP, "pages");

beforeAll(() => {
  mkdirSync(join(TMP, "src"), { recursive: true });
  mkdirSync(join(TMP, "src", "utils"), { recursive: true });
  mkdirSync(join(TMP, "src", "components"), { recursive: true });
  mkdirSync(PAGES, { recursive: true });
  mkdirSync(join(PAGES, "blog", "[slug]"), { recursive: true });
  mkdirSync(join(PAGES, "users", "[id]"), { recursive: true });

  // Files for Glob scanning
  writeFileSync(join(TMP, "src", "index.ts"), "// index");
  writeFileSync(join(TMP, "src", "app.tsx"), "// app");
  writeFileSync(join(TMP, "src", "style.css"), "/* css */");
  writeFileSync(join(TMP, "src", "utils", "helper.ts"), "// helper");
  writeFileSync(join(TMP, "src", "utils", "math.ts"), "// math");
  writeFileSync(join(TMP, "src", "components", "Button.tsx"), "// button");
  writeFileSync(join(TMP, "src", "components", "Input.tsx"), "// input");
  writeFileSync(join(TMP, "README.md"), "# readme");

  // Pages for FileSystemRouter
  writeFileSync(join(PAGES, "index.tsx"), "// home");
  writeFileSync(join(PAGES, "about.tsx"), "// about");
  writeFileSync(join(PAGES, "blog", "index.tsx"), "// blog list");
  writeFileSync(join(PAGES, "blog", "[slug]", "index.tsx"), "// blog post");
  writeFileSync(join(PAGES, "users", "[id]", "index.tsx"), "// user");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Bun.Glob — match()
// ---------------------------------------------------------------------------

describe("Bun.Glob — match()", () => {
  test("*.ts matches a .ts file", () => {
    expect(new Glob("*.ts").match("index.ts")).toBe(true);
  });

  test("*.ts does not match a .tsx file", () => {
    expect(new Glob("*.ts").match("App.tsx")).toBe(false);
  });

  test("*.{ts,tsx} matches both extensions", () => {
    const g = new Glob("*.{ts,tsx}");
    expect(g.match("foo.ts")).toBe(true);
    expect(g.match("foo.tsx")).toBe(true);
    expect(g.match("foo.js")).toBe(false);
  });

  test("? matches exactly one character", () => {
    expect(new Glob("?.ts").match("a.ts")).toBe(true);
    expect(new Glob("?.ts").match("ab.ts")).toBe(false);
  });

  test("[ab] matches character class", () => {
    const g = new Glob("[abc].ts");
    expect(g.match("a.ts")).toBe(true);
    expect(g.match("b.ts")).toBe(true);
    expect(g.match("d.ts")).toBe(false);
  });

  test("** matches across path separators", () => {
    expect(new Glob("**/*.ts").match("src/utils/helper.ts")).toBe(true);
  });

  test("negation ! flips the match", () => {
    expect(new Glob("!*.ts").match("foo.ts")).toBe(false);
    expect(new Glob("!*.ts").match("foo.js")).toBe(true);
  });

  test("exact pattern matches exact string", () => {
    expect(new Glob("README.md").match("README.md")).toBe(true);
    expect(new Glob("README.md").match("README.txt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bun.Glob — scanSync()
// ---------------------------------------------------------------------------

describe("Bun.Glob — scanSync()", () => {
  test("scans *.ts files in a directory", () => {
    const files = Array.from(new Glob("*.ts").scanSync({ cwd: join(TMP, "src") }));
    expect(files).toContain("index.ts");
    expect(files.every((f) => f.endsWith(".ts"))).toBe(true);
  });

  test("**/*.ts finds nested .ts files", () => {
    const files = Array.from(new Glob("**/*.ts").scanSync({ cwd: join(TMP, "src") }));
    expect(files.some((f) => f.includes("utils"))).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test("*.{ts,tsx} finds both TypeScript variants", () => {
    const files = Array.from(new Glob("*.{ts,tsx}").scanSync({ cwd: join(TMP, "src") }));
    expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
    expect(files.some((f) => f.endsWith(".tsx"))).toBe(true);
  });

  test("*.css finds only CSS files", () => {
    const files = Array.from(new Glob("*.css").scanSync({ cwd: join(TMP, "src") }));
    expect(files).toContain("style.css");
    expect(files.every((f) => f.endsWith(".css"))).toBe(true);
  });

  test("**/*.tsx finds TSX files in subdirectories", () => {
    const files = Array.from(new Glob("**/*.tsx").scanSync({ cwd: join(TMP, "src") }));
    expect(files.some((f) => f.includes("components"))).toBe(true);
  });

  test("non-matching pattern returns empty iterator", () => {
    const files = Array.from(new Glob("*.wasm").scanSync({ cwd: join(TMP, "src") }));
    expect(files).toHaveLength(0);
  });

  test("absolute option returns absolute paths", () => {
    const files = Array.from(new Glob("*.ts").scanSync({ cwd: join(TMP, "src"), absolute: true }));
    expect(files.every((f) => f.startsWith("/"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bun.Glob — scan() (async)
// ---------------------------------------------------------------------------

describe("Bun.Glob — scan() async", () => {
  test("async scan returns same results as syncScan", async () => {
    const sync = Array.from(new Glob("**/*.ts").scanSync({ cwd: join(TMP, "src") })).sort();
    const async_ = (await Array.fromAsync(new Glob("**/*.ts").scan({ cwd: join(TMP, "src") }))).sort();
    expect(async_).toEqual(sync);
  });

  test("async for-await loop works", async () => {
    const files: string[] = [];
    for await (const f of new Glob("*.{ts,tsx}").scan({ cwd: join(TMP, "src") })) {
      files.push(f);
    }
    expect(files.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Bun.FileSystemRouter
// ---------------------------------------------------------------------------

describe("Bun.FileSystemRouter — nextjs style", () => {
  let router: InstanceType<typeof FileSystemRouter>;

  beforeAll(() => {
    router = new FileSystemRouter({ dir: PAGES, style: "nextjs" });
  });

  test("matches exact route /", () => {
    const match = router.match("/");
    expect(match).not.toBeNull();
    expect(match!.name).toBe("/");
  });

  test("matches exact route /about", () => {
    const match = router.match("/about");
    expect(match).not.toBeNull();
  });

  test("matches /blog as exact route", () => {
    const match = router.match("/blog");
    expect(match).not.toBeNull();
  });

  test("matches dynamic route /blog/my-post", () => {
    const match = router.match("/blog/my-post");
    expect(match).not.toBeNull();
    expect(match!.params.slug).toBe("my-post");
  });

  test("dynamic params are extracted correctly", () => {
    const match = router.match("/users/42");
    expect(match).not.toBeNull();
    expect(match!.params.id).toBe("42");
  });

  test("match() returns null for unknown routes", () => {
    expect(router.match("/this/route/does/not/exist")).toBeNull();
  });

  test("routes property lists all registered routes", () => {
    expect(typeof router.routes).toBe("object");
    expect(Object.keys(router.routes).length).toBeGreaterThan(0);
  });

  test("style property is 'nextjs'", () => {
    expect(router.style).toBe("nextjs");
  });

  test("matched route has filePath", () => {
    const match = router.match("/about");
    expect(typeof match!.filePath).toBe("string");
    expect(match!.filePath.endsWith(".tsx")).toBe(true);
  });

  test("matched route has pathname", () => {
    const match = router.match("/about");
    expect(match!.pathname).toBe("/about");
  });

  test("query string is parsed into query object", () => {
    const match = router.match("/about?foo=bar");
    expect(match).not.toBeNull();
    expect(match!.query.foo).toBe("bar");
  });
});
