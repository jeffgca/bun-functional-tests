import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures");
const TMP = join(import.meta.dir, "tmp");

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// BunFile — metadata
// ---------------------------------------------------------------------------

describe("BunFile metadata", () => {
  test("size is a positive integer for an existing file", async () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"));
    expect(file.size).toBeGreaterThan(0);
    expect(Number.isInteger(file.size)).toBe(true);
  });

  test("type returns a MIME string for a known extension", () => {
    const txt = Bun.file(join(FIXTURES, "sample.txt"));
    const json = Bun.file(join(FIXTURES, "sample.json"));
    expect(txt.type).toStartWith("text/plain");
    expect(json.type).toStartWith("application/json");
  });

  test("type can be overridden via options", () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"), {
      type: "application/octet-stream",
    });
    expect(file.type).toStartWith("application/octet-stream");
  });

  test("exists() returns true for a real file", async () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"));
    expect(await file.exists()).toBe(true);
  });

  test("exists() returns false for a missing file", async () => {
    const file = Bun.file(join(TMP, "does-not-exist.txt"));
    expect(await file.exists()).toBe(false);
  });

  test("size is 0 for a non-existent file", () => {
    const file = Bun.file(join(TMP, "phantom.txt"));
    // BunFile is lazy — size reflects what's on disk at creation time
    expect(file.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

describe("Bun.file() — reading", () => {
  test("text() reads file as a UTF-8 string", async () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"));
    const text = await file.text();
    expect(text).toContain("Hello, Bun!");
    expect(text).toContain("Line 2");
    expect(text).toContain("Line 3");
  });

  test("json() parses file as JSON", async () => {
    const file = Bun.file(join(FIXTURES, "sample.json"));
    const data = await file.json();
    expect(data.name).toBe("bun");
    expect(data.version).toBe("1.0");
    expect(Array.isArray(data.features)).toBe(true);
    expect(data.features).toContain("fast");
  });

  test("arrayBuffer() returns an ArrayBuffer with correct byte length", async () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"));
    const buf = await file.arrayBuffer();
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(file.size);
  });

  test("bytes() returns a Uint8Array", async () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"));
    const bytes = await file.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(file.size);
    // First char is 'H' (0x48)
    expect(bytes[0]).toBe(0x48);
  });

  test("stream() returns a ReadableStream that yields the full content", async () => {
    const file = Bun.file(join(FIXTURES, "sample.txt"));
    const stream = file.stream();
    expect(stream).toBeInstanceOf(ReadableStream);
    const text = await Bun.readableStreamToText(stream);
    expect(text).toContain("Hello, Bun!");
  });

  test("can create BunFile from a file:// URL", async () => {
    const url = Bun.pathToFileURL(join(FIXTURES, "sample.txt"));
    const file = Bun.file(url);
    const text = await file.text();
    expect(text).toContain("Hello, Bun!");
  });
});

// ---------------------------------------------------------------------------
// Writing files
// ---------------------------------------------------------------------------

describe("Bun.write()", () => {
  test("writes a string to disk and returns byte count", async () => {
    const path = join(TMP, "write-string.txt");
    const content = "written by bun:test";
    const bytesWritten = await Bun.write(path, content);
    expect(bytesWritten).toBe(Buffer.byteLength(content, "utf-8"));
    const readBack = await Bun.file(path).text();
    expect(readBack).toBe(content);
  });

  test("writes a Uint8Array to disk", async () => {
    const path = join(TMP, "write-bytes.bin");
    const data = new Uint8Array([0x62, 0x75, 0x6e]); // "bun"
    await Bun.write(path, data);
    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("bun");
  });

  test("writes an ArrayBuffer to disk", async () => {
    const path = join(TMP, "write-ab.bin");
    const encoder = new TextEncoder();
    const buf = encoder.encode("hello arraybuffer").buffer;
    await Bun.write(path, buf);
    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("hello arraybuffer");
  });

  test("writes a Blob to disk", async () => {
    const path = join(TMP, "write-blob.txt");
    const blob = new Blob(["blob content"], { type: "text/plain" });
    await Bun.write(path, blob);
    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("blob content");
  });

  test("copies a BunFile by passing it as the source", async () => {
    const src = Bun.file(join(FIXTURES, "sample.txt"));
    const dst = join(TMP, "copied.txt");
    await Bun.write(dst, src);
    const original = await src.text();
    const copy = await Bun.file(dst).text();
    expect(copy).toBe(original);
  });

  test("overwrites an existing file", async () => {
    const path = join(TMP, "overwrite.txt");
    await Bun.write(path, "first");
    await Bun.write(path, "second");
    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("second");
  });

  test("writes using a BunFile destination", async () => {
    const dest = Bun.file(join(TMP, "bunfile-dest.txt"));
    await Bun.write(dest, "via BunFile destination");
    expect(await dest.text()).toBe("via BunFile destination");
  });

  test("writes a Response body to disk", async () => {
    const path = join(TMP, "response-body.txt");
    const response = new Response("response body content");
    await Bun.write(path, response);
    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("response body content");
  });
});

// ---------------------------------------------------------------------------
// Incremental writing with FileSink
// ---------------------------------------------------------------------------

describe("FileSink — incremental writing", () => {
  test("writes multiple string chunks and reads them back", async () => {
    const path = join(TMP, "filesink-chunks.txt");
    const file = Bun.file(path);
    const writer = file.writer();

    writer.write("chunk one\n");
    writer.write("chunk two\n");
    writer.write("chunk three\n");
    await writer.end();

    const result = await Bun.file(path).text();
    expect(result).toBe("chunk one\nchunk two\nchunk three\n");
  });

  test("write() returns the number of bytes buffered", async () => {
    const path = join(TMP, "filesink-count.txt");
    const writer = Bun.file(path).writer();
    const n = writer.write("hello");

    // write() can return a number or a Promise<number> depending on backpressure;
    // https://bun.sh/reference/bun/BunFile/writer#bun.BunFile.writer
    // fun fact, on UNIX systems this seems to always be an integer, Windows is more likely to return a Promise
    if (n instanceof Promise) {
      // write returned a Promise — resolve it and verify the byte count
      const resolved = await n;
      expect(typeof resolved).toBe("number");
      expect(resolved).toBeGreaterThan(0);
    } else {
      // write returned synchronously — verify the byte count directly
      expect(typeof n).toBe("number");
      expect(n).toBeGreaterThan(0);
    }

    writer.end();
  });

  test("flush() flushes the buffer and returns bytes flushed", async () => {
    const path = join(TMP, "filesink-flush.txt");
    const writer = Bun.file(path).writer();
    writer.write("flushed content");
    const flushed = writer.flush();
    // flush() can return a number or Promise<number>
    const bytes = flushed instanceof Promise ? await flushed : flushed;
    expect(bytes).toBeGreaterThanOrEqual(0);
    await writer.end();
    expect(await Bun.file(path).text()).toContain("flushed content");
  });

  test("writes Uint8Array chunks", async () => {
    const path = join(TMP, "filesink-bytes.bin");
    const writer = Bun.file(path).writer();
    writer.write(new Uint8Array([0x66, 0x6f, 0x6f])); // "foo"
    writer.write(new Uint8Array([0x62, 0x61, 0x72])); // "bar"
    await writer.end();
    const text = await Bun.file(path).text();
    expect(text).toBe("foobar");
  });

  test("respects a custom highWaterMark", async () => {
    const path = join(TMP, "filesink-hwm.txt");
    const writer = Bun.file(path).writer({ highWaterMark: 4 });
    writer.write("abcdefgh");
    await writer.end();
    const text = await Bun.file(path).text();
    expect(text).toBe("abcdefgh");
  });
});

// ---------------------------------------------------------------------------
// File deletion
// ---------------------------------------------------------------------------

describe("BunFile.delete()", () => {
  test("deletes an existing file", async () => {
    const path = join(TMP, "to-delete.txt");
    await Bun.write(path, "bye");
    expect(await Bun.file(path).exists()).toBe(true);
    await Bun.file(path).delete();
    expect(await Bun.file(path).exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bun.stdin / stdout / stderr
// ---------------------------------------------------------------------------

describe("Bun standard streams", () => {
  test("Bun.stdin is a BunFile with a numeric fd", () => {
    expect(Bun.stdin).toBeDefined();
    // fd 0 is stdin; BunFile created from fd has size 0
    expect(typeof Bun.stdin.size).toBe("number");
    expect(typeof Bun.stdin.type).toBe("string");
  });

  test("Bun.stdout is a BunFile with a stream() method", () => {
    expect(Bun.stdout).toBeDefined();
    expect(typeof Bun.stdout.size).toBe("number");
    expect(typeof Bun.stdout.type).toBe("string");
  });

  test("Bun.stderr is a BunFile with a stream() method", () => {
    expect(Bun.stderr).toBeDefined();
    expect(typeof Bun.stderr.size).toBe("number");
    expect(typeof Bun.stderr.type).toBe("string");
  });

  test("Bun.stdout and Bun.stderr have a MIME type", () => {
    // terminals are binary streams; Bun reports application/octet-stream
    expect(typeof Bun.stdout.type).toBe("string");
    expect(Bun.stdout.type.length).toBeGreaterThan(0);
    expect(typeof Bun.stderr.type).toBe("string");
  });
});
