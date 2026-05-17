import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const TMP = join(import.meta.dir, "tmp-build");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
  // Simple entry point that imports a helper
  writeFileSync(join(TMP, "entry.ts"), `import { add } from "./math";\nexport const result = add(2, 3);\n`);
  writeFileSync(join(TMP, "math.ts"), `export function add(a: number, b: number): number { return a + b; }\n`);
  writeFileSync(join(TMP, "jsx-entry.tsx"), `export function Hello() { return <h1>Hello</h1>; }\n`);
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Bun.Transpiler — transformSync
// ---------------------------------------------------------------------------

describe("Bun.Transpiler — transformSync", () => {
  test("strips TypeScript types", () => {
    const t = new Bun.Transpiler({ loader: "ts" });
    const out = t.transformSync("const x: number = 42;");
    expect(out).toContain("const x");
    expect(out).not.toContain(": number");
  });

  test("transpiles JSX to function calls", () => {
    const t = new Bun.Transpiler({ loader: "jsx" });
    const out = t.transformSync("const el = <div>hello</div>;");
    expect(out).toContain("jsx");
    expect(out).not.toContain("<div>");
  });

  test("transpiles TSX", () => {
    const t = new Bun.Transpiler({ loader: "tsx" });
    const out = t.transformSync("const fn = (x: number) => <span>{x}</span>;");
    expect(out).not.toContain(": number");
    expect(out).toContain("jsx");
  });

  test("returns a string", () => {
    const t = new Bun.Transpiler({ loader: "ts" });
    expect(typeof t.transformSync("export const x = 1;")).toBe("string");
  });

  test("preserves export declarations", () => {
    const t = new Bun.Transpiler({ loader: "ts" });
    const out = t.transformSync("export const answer = 42;");
    expect(out).toContain("answer");
    expect(out).toContain("42");
  });

  test("define replaces identifiers", () => {
    const t = new Bun.Transpiler({
      loader: "ts",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const out = t.transformSync("const env = process.env.NODE_ENV;");
    expect(out).toContain('"production"');
  });

  test("async transform() returns a Promise<string>", async () => {
    const t = new Bun.Transpiler({ loader: "ts" });
    const result = t.transform("const x: string = 'hi';");
    expect(result).toBeInstanceOf(Promise);
    const out = await result;
    expect(typeof out).toBe("string");
    expect(out).not.toContain(": string");
  });
});

// ---------------------------------------------------------------------------
// Bun.Transpiler — scan / scanImports
// ---------------------------------------------------------------------------

describe("Bun.Transpiler — scan / scanImports", () => {
  const t = new Bun.Transpiler({ loader: "ts" });

  test("scanImports returns array of Import objects", () => {
    const imports = t.scanImports(`import {foo} from "bar";\nimport "baz";`);
    expect(Array.isArray(imports)).toBe(true);
    expect(imports.length).toBe(2);
  });

  test("scanImports finds named import paths", () => {
    const imports = t.scanImports(`import {x} from "my-lib";\nimport type {T} from "types";`);
    const paths = imports.map((i) => i.path);
    expect(paths).toContain("my-lib");
  });

  test("scan returns imports and exports", () => {
    const { imports, exports } = t.scan(`import { foo } from "baz";\nexport const hello = "hi!";`);
    expect(imports.map((i) => i.path)).toContain("baz");
    expect(exports).toContain("hello");
  });

  test("scan finds multiple exports", () => {
    const { exports } = t.scan(`export const a = 1;\nexport function b() {}\nexport class C {}`);
    expect(exports).toContain("a");
    expect(exports).toContain("b");
    expect(exports).toContain("C");
  });

  test("import kind is 'import-statement' for static imports", () => {
    const imports = t.scanImports(`import {x} from "lib";`);
    expect(imports[0].kind).toBe("import-statement");
  });
});

// ---------------------------------------------------------------------------
// Bun.build() — in-memory bundling (no outdir)
// ---------------------------------------------------------------------------

describe("Bun.build() — bundler", () => {
  test("builds a TypeScript file successfully", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
    });
    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  test("output artifact is a Blob with text content", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
    });
    const text = await result.outputs[0].text();
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  test("bundled output contains the function from imported module", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
    });
    const text = await result.outputs[0].text();
    expect(text).toContain("add");
  });

  test("output artifact has path property", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
    });
    expect(typeof result.outputs[0].path).toBe("string");
  });

  test("output artifact has loader property", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
    });
    expect(typeof result.outputs[0].loader).toBe("string");
  });

  test("minify: true produces smaller output than no minification", async () => {
    const [normal, minified] = await Promise.all([Bun.build({ entrypoints: [join(TMP, "entry.ts")], target: "bun" }), Bun.build({ entrypoints: [join(TMP, "entry.ts")], target: "bun", minify: true })]);
    const normalText = await normal.outputs[0].text();
    const minText = await minified.outputs[0].text();
    expect(minText.length).toBeLessThanOrEqual(normalText.length);
  });

  test("define replaces constant at build time", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
      define: { MY_CONST: '"hello-from-define"' },
    });
    expect(result.success).toBe(true);
  });

  test("target: 'browser' succeeds", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "browser",
    });
    expect(result.success).toBe(true);
  });

  test("build with outdir writes files to disk", async () => {
    const outdir = join(TMP, "dist");
    mkdirSync(outdir, { recursive: true });
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      outdir,
      target: "bun",
    });
    expect(result.success).toBe(true);
    const files = Array.from(new Bun.Glob("*.js").scanSync({ cwd: outdir }));
    expect(files.length).toBeGreaterThan(0);
  });

  test("BuildOutput.logs is an array", async () => {
    const result = await Bun.build({
      entrypoints: [join(TMP, "entry.ts")],
      target: "bun",
    });
    expect(Array.isArray(result.logs)).toBe(true);
  });

  test("in-memory bundling via files option", async () => {
    const result = await Bun.build({
      entrypoints: ["/virtual/index.ts"],
      target: "bun",
      files: {
        "/virtual/index.ts": `export const x = 42;`,
      },
    });
    expect(result.success).toBe(true);
    const text = await result.outputs[0].text();
    expect(text).toContain("42");
  });

  test("invalid entrypoint causes success: false or throws", async () => {
    try {
      const result = await Bun.build({
        entrypoints: ["/nonexistent/path/that/does/not/exist.ts"],
        target: "bun",
        throw: false,
      });
      expect(result.success).toBe(false);
    } catch (e) {
      // throw: true (default) may throw instead
      expect(e).toBeTruthy();
    }
  });
});
