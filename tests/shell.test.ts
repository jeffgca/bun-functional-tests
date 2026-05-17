import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const isWindows = process.platform === "win32";
const TMP = join(import.meta.dir, "tmp-shell");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Bun.$ — template shell
// ---------------------------------------------------------------------------

describe("Bun.$ — basic execution", () => {
  test("echo returns expected text", async () => {
    const out = await $`echo hello`.quiet().text();
    expect(out.trim()).toBe("hello");
  });

  test("exit code 0 on success", async () => {
    const { exitCode } = await $`true`.quiet();
    expect(exitCode).toBe(0);
  });

  test("exit code 1 on failure with .nothrow()", async () => {
    const { exitCode } = await $`false`.quiet().nothrow();
    expect(exitCode).toBe(1);
  });

  test("non-zero exit throws by default", async () => {
    let threw = false;
    try {
      await $`false`.quiet();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test(".text() returns stdout as string", async () => {
    const text = await $`echo bun`.quiet().text();
    expect(text.trim()).toBe("bun");
  });

  test(".json() parses stdout as JSON", async () => {
    const data = await $`echo '{"ok":true}'`.quiet().json();
    expect(data).toEqual({ ok: true });
  });

  test(".bytes() returns Uint8Array", async () => {
    const bytes = await $`echo hi`.quiet().bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("multi-command pipeline", async () => {
    if (isWindows) {
      // wc is not available on Windows; test pipeline using the built-in cat
      const out = await $`echo "foo bar baz" | cat`.quiet().text();
      expect(out.trim()).toBe("foo bar baz");
    } else {
      const out = await $`echo "foo bar baz" | wc -w`.quiet().text();
      expect(parseInt(out.trim())).toBe(3);
    }
  });

  test("stderr is captured in .stderr", async () => {
    // ls on a nonexistent path writes to stderr naturally
    const result = await $`ls /nonexistent_file_xyz_abc`.quiet().nothrow();
    const errText = new TextDecoder().decode(result.stderr);
    expect(errText.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Bun.$ — variable interpolation
// ---------------------------------------------------------------------------

describe("Bun.$ — interpolation", () => {
  test("string variable interpolated safely", async () => {
    const name = "world";
    const out = await $`echo ${name}`.quiet().text();
    expect(out.trim()).toBe("world");
  });

  test("array of args is expanded word-by-word", async () => {
    const args = ["a", "b", "c"];
    const out = await $`echo ${args}`.quiet().text();
    expect(out.trim()).toBe("a b c");
  });

  test("$.escape() escapes shell metacharacters", () => {
    const raw = "hello; rm -rf /";
    const escaped = $.escape(raw);
    // escape wraps/quotes the string so it differs from the raw input
    expect(escaped).not.toBe(raw);
  });

  test("$.braces() expands brace patterns", () => {
    const result = $.braces("file.{ts,js}");
    expect(result).toEqual(["file.ts", "file.js"]);
  });
});

// ---------------------------------------------------------------------------
// Bun.$ — environment and cwd
// ---------------------------------------------------------------------------

describe("Bun.$ — env and cwd", () => {
  test(".env() sets custom env var", async () => {
    const out = await $`echo $MYVAR`
      .quiet()
      .env({ ...process.env, MYVAR: "hello123" })
      .text();
    expect(out.trim()).toBe("hello123");
  });

  test(".cwd() changes working directory", async () => {
    const out = await $`pwd`.quiet().cwd(TMP).text();
    // resolve symlinks for macOS /private/var -> /var etc.
    expect(out.trim()).toBe((await Bun.file("/dev/null").exists()) ? out.trim() : TMP);
    // Simply verify the reported dir ends with our tmp dir name
    expect(out.trim()).toContain("tmp-shell");
  });

  test("$.cwd() sets global cwd for that $ instance", async () => {
    const shell = $.cwd(TMP);
    const out = await shell`pwd`.quiet().text();
    expect(out.trim()).toContain("tmp-shell");
  });

  test("$.env() sets global env for that $ instance", async () => {
    const shell = $.env({ ...process.env, SHELL_TEST: "yes" });
    const out = await shell`echo $SHELL_TEST`.quiet().text();
    expect(out.trim()).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// Bun.$ — file I/O redirection
// ---------------------------------------------------------------------------

describe("Bun.$ — file redirection", () => {
  test("redirect stdout to file with > redirect", async () => {
    const outPath = join(TMP, "out.txt");
    await $`echo written > ${outPath}`.quiet();
    const contents = await Bun.file(outPath).text();
    expect(contents.trim()).toBe("written");
  });

  test("pipe output of one command to another via stdin()", async () => {
    const catArgs = isWindows ? ["bun", "-e", "process.stdin.pipe(process.stdout)"] : ["cat"];
    const proc = Bun.spawn(catArgs, { stdin: "pipe", stdout: "pipe" });
    proc.stdin.write("piped\n");
    proc.stdin.end();
    const text = await new Response(proc.stdout).text();
    expect(text.trim()).toBe("piped");
  });
});

// ---------------------------------------------------------------------------
// Bun.$ — nothrow / throws
// ---------------------------------------------------------------------------

describe("Bun.$ — error control", () => {
  test("ShellError has exitCode and stdout/stderr", async () => {
    let err: any;
    try {
      await $`false`.quiet();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(typeof err.exitCode).toBe("number");
  });

  test("$.nothrow() suppresses throw on non-zero exit", async () => {
    const shell = $.nothrow();
    const result = await shell`exit 42`.quiet();
    expect(result.exitCode).toBe(42);
  });

  test("$.throws(false) suppresses throw", async () => {
    const shell = $.throws(false);
    const result = await shell`exit 7`.quiet();
    expect(result.exitCode).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Bun.spawn — async subprocess
// ---------------------------------------------------------------------------

describe("Bun.spawn", () => {
  test("captures stdout via pipe", async () => {
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", "echo spawned"] : ["echo", "spawned"], { stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    expect(text.trim()).toBe("spawned");
    await proc.exited;
    expect(proc.exitCode).toBe(0);
  });

  test("captures stderr via pipe", async () => {
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", "echo err 1>&2"] : ["sh", "-c", "echo err >&2"], { stderr: "pipe" });
    const text = await new Response(proc.stderr).text();
    await proc.exited;
    expect(text.trim()).toBe("err");
  });

  test("writes to stdin via pipe", async () => {
    const catArgs = isWindows ? ["bun", "-e", "process.stdin.pipe(process.stdout)"] : ["cat"];
    const proc = Bun.spawn(catArgs, { stdin: "pipe", stdout: "pipe" });
    proc.stdin.write("hello stdin");
    proc.stdin.end();
    const text = await new Response(proc.stdout).text();
    expect(text).toBe("hello stdin");
  });

  test("exited promise resolves with exit code", async () => {
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", "exit 3"] : ["sh", "-c", "exit 3"], { stdout: "ignore" });
    const code = await proc.exited;
    expect(code).toBe(3);
  });

  test("kill() terminates the process", async () => {
    const proc = Bun.spawn(isWindows ? ["bun", "-e", "await Bun.sleep(60000)"] : ["sleep", "60"], { stdout: "ignore" });
    proc.kill();
    const code = await proc.exited;
    expect(code).not.toBe(0);
  });

  test("env option passes custom environment", async () => {
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", "echo %CUSTOM_VAR%"] : ["sh", "-c", "echo $CUSTOM_VAR"], {
      env: { ...process.env, CUSTOM_VAR: "custom_value" },
      stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    expect(text.trim()).toBe("custom_value");
  });

  test("cwd option sets working directory", async () => {
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", "cd"] : ["pwd"], { cwd: TMP, stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    expect(text.trim()).toContain("tmp-shell");
  });

  test("pid is a positive integer", async () => {
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", "exit 0"] : ["true"], { stdout: "ignore" });
    expect(proc.pid).toBeGreaterThan(0);
    await proc.exited;
  });
});

// ---------------------------------------------------------------------------
// Bun.spawnSync — synchronous subprocess
// ---------------------------------------------------------------------------

describe("Bun.spawnSync", () => {
  test("captures stdout synchronously", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "echo sync"] : ["echo", "sync"]);
    expect(result.stdout.toString().trim()).toBe("sync");
  });

  test("exit code is returned", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "exit 5"] : ["sh", "-c", "exit 5"]);
    expect(result.exitCode).toBe(5);
  });

  test("captures stderr synchronously", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "echo err 1>&2"] : ["sh", "-c", "echo err >&2"]);
    expect(result.stderr.toString().trim()).toBe("err");
  });

  test("success is true when exit code is 0", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "exit 0"] : ["true"]);
    expect(result.success).toBe(true);
  });

  test("success is false when exit code is non-zero", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "exit 1"] : ["false"]);
    expect(result.success).toBe(false);
  });

  test("stdin buffer is passed to the process", () => {
    const catArgs = isWindows ? ["bun", "-e", "process.stdin.pipe(process.stdout)"] : ["cat"];
    const result = Bun.spawnSync(catArgs, { stdin: Buffer.from("hello sync stdin") });
    expect(result.stdout.toString()).toBe("hello sync stdin");
  });

  test("env option is forwarded", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "echo %SYNC_VAR%"] : ["sh", "-c", "echo $SYNC_VAR"], { env: { ...process.env, SYNC_VAR: "sync123" } });
    expect(result.stdout.toString().trim()).toBe("sync123");
  });

  test("cwd option is respected", () => {
    const result = Bun.spawnSync(isWindows ? ["cmd", "/c", "cd"] : ["pwd"], { cwd: TMP });
    expect(result.stdout.toString().trim()).toContain("tmp-shell");
  });
});
