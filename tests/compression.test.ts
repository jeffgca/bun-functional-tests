import { describe, test, expect } from "bun:test";

const SAMPLE = "Hello, Bun compression! ".repeat(100);
const SAMPLE_BYTES = new TextEncoder().encode(SAMPLE);

// ---------------------------------------------------------------------------
// gzipSync / gunzipSync
// ---------------------------------------------------------------------------

describe("Bun.gzipSync / Bun.gunzipSync", () => {
  test("roundtrip string → Uint8Array → string", () => {
    const compressed = Bun.gzipSync(SAMPLE);
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("roundtrip Uint8Array", () => {
    const compressed = Bun.gzipSync(SAMPLE_BYTES);
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("compressed size is smaller than the original", () => {
    const compressed = Bun.gzipSync(SAMPLE);
    expect(compressed.byteLength).toBeLessThan(SAMPLE_BYTES.byteLength);
  });

  test("returns a Uint8Array", () => {
    expect(Bun.gzipSync(SAMPLE)).toBeInstanceOf(Uint8Array);
  });

  test("level option is accepted", () => {
    const fast = Bun.gzipSync(SAMPLE, { level: 1 });
    const best = Bun.gzipSync(SAMPLE, { level: 9 });
    // Both should decompress to the same thing
    expect(new TextDecoder().decode(Bun.gunzipSync(fast))).toBe(SAMPLE);
    expect(new TextDecoder().decode(Bun.gunzipSync(best))).toBe(SAMPLE);
  });

  test("empty input roundtrips", () => {
    const compressed = Bun.gzipSync("");
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe("");
  });

  test("binary data roundtrips", () => {
    const binary = new Uint8Array([0, 1, 2, 255, 254, 128, 0, 99]);
    const rt = Bun.gunzipSync(Bun.gzipSync(binary));
    expect(rt).toEqual(binary);
  });
});

// ---------------------------------------------------------------------------
// deflateSync / inflateSync
// ---------------------------------------------------------------------------

describe("Bun.deflateSync / Bun.inflateSync", () => {
  test("roundtrip string", () => {
    const compressed = Bun.deflateSync(SAMPLE);
    const decompressed = Bun.inflateSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("roundtrip Uint8Array", () => {
    const compressed = Bun.deflateSync(SAMPLE_BYTES);
    const decompressed = Bun.inflateSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("compressed is smaller than original", () => {
    const compressed = Bun.deflateSync(SAMPLE);
    expect(compressed.byteLength).toBeLessThan(SAMPLE_BYTES.byteLength);
  });

  test("returns a Uint8Array", () => {
    expect(Bun.deflateSync(SAMPLE)).toBeInstanceOf(Uint8Array);
  });

  test("level option is accepted", () => {
    const fast = Bun.deflateSync(SAMPLE, { level: 1 });
    const best = Bun.deflateSync(SAMPLE, { level: 9 });
    expect(new TextDecoder().decode(Bun.inflateSync(fast))).toBe(SAMPLE);
    expect(new TextDecoder().decode(Bun.inflateSync(best))).toBe(SAMPLE);
  });

  test("empty input roundtrips", () => {
    const compressed = Bun.deflateSync("");
    const decompressed = Bun.inflateSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// zstdCompressSync / zstdDecompressSync  (sync)
// ---------------------------------------------------------------------------

describe("Bun.zstdCompressSync / Bun.zstdDecompressSync", () => {
  test("roundtrip string", () => {
    const compressed = Bun.zstdCompressSync(SAMPLE);
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("roundtrip Uint8Array", () => {
    const compressed = Bun.zstdCompressSync(SAMPLE_BYTES);
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("returns a Buffer", () => {
    expect(Bun.zstdCompressSync(SAMPLE)).toBeInstanceOf(Buffer);
  });

  test("compressed size is smaller than original", () => {
    const compressed = Bun.zstdCompressSync(SAMPLE);
    expect(compressed.byteLength).toBeLessThan(SAMPLE_BYTES.byteLength);
  });

  test("level option is accepted", () => {
    const low = Bun.zstdCompressSync(SAMPLE, { level: 1 });
    const high = Bun.zstdCompressSync(SAMPLE, { level: 10 });
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(low))).toBe(SAMPLE);
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(high))).toBe(SAMPLE);
  });

  test("empty input roundtrips", () => {
    const compressed = Bun.zstdCompressSync("");
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe("");
  });

  test("binary data roundtrips", () => {
    const binary = new Uint8Array([10, 20, 0, 255, 128, 64, 32, 1]);
    const rt = Bun.zstdDecompressSync(Bun.zstdCompressSync(binary));
    expect(rt).toEqual(binary);
  });
});

// ---------------------------------------------------------------------------
// zstdCompress / zstdDecompress  (async)
// ---------------------------------------------------------------------------

describe("Bun.zstdCompress / Bun.zstdDecompress (async)", () => {
  test("roundtrip string", async () => {
    const compressed = await Bun.zstdCompress(SAMPLE);
    const decompressed = await Bun.zstdDecompress(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(SAMPLE);
  });

  test("returns Promise<Buffer>", async () => {
    const result = Bun.zstdCompress(SAMPLE);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeInstanceOf(Buffer);
  });

  test("async result matches sync result", async () => {
    const sync = Bun.zstdCompressSync(SAMPLE);
    const async_ = await Bun.zstdCompress(SAMPLE);
    // Both should decompress to the same string (may differ as bytes due to frame headers/seed)
    const syncStr = new TextDecoder().decode(Bun.zstdDecompressSync(sync));
    const asyncStr = new TextDecoder().decode(await Bun.zstdDecompress(async_));
    expect(syncStr).toBe(asyncStr);
  });
});

// ---------------------------------------------------------------------------
// Web standard CompressionStream / DecompressionStream
// ---------------------------------------------------------------------------

describe("CompressionStream / DecompressionStream", () => {
  async function compress(format: string, data: string): Promise<Uint8Array> {
    const stream = new CompressionStream(format as CompressionFormat);
    const writer = stream.writable.getWriter();
    writer.write(new TextEncoder().encode(data));
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  async function decompress(format: string, data: Uint8Array): Promise<string> {
    const stream = new DecompressionStream(format as CompressionFormat);
    const writer = stream.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(out);
  }

  test("gzip roundtrip via streams", async () => {
    const compressed = await compress("gzip", SAMPLE);
    const result = await decompress("gzip", compressed);
    expect(result).toBe(SAMPLE);
  });

  test("deflate roundtrip via streams", async () => {
    const compressed = await compress("deflate", SAMPLE);
    const result = await decompress("deflate", compressed);
    expect(result).toBe(SAMPLE);
  });

  test("deflate-raw roundtrip via streams", async () => {
    const compressed = await compress("deflate-raw", SAMPLE);
    const result = await decompress("deflate-raw", compressed);
    expect(result).toBe(SAMPLE);
  });

  test("gzip stream output matches gzipSync output (decompresses correctly)", async () => {
    const streamCompressed = await compress("gzip", "hello world");
    const decompressed = Bun.gunzipSync(streamCompressed);
    expect(new TextDecoder().decode(decompressed)).toBe("hello world");
  });
});
