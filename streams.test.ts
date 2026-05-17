import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// ReadableStream — construction and consumption
// ---------------------------------------------------------------------------

describe("ReadableStream — basic construction and reading", () => {
  test("read chunks from a simple pull source", async () => {
    const chunks = ["hello", " ", "world"];
    let i = 0;
    const stream = new ReadableStream<string>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]);
        else controller.close();
      },
    });
    const reader = stream.getReader();
    const results: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value!);
    }
    expect(results).toEqual(chunks);
  });

  test("stream from start() with enqueue/close", async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.enqueue(3);
        controller.close();
      },
    });
    const all = await Bun.readableStreamToArray(stream);
    expect(all).toEqual([1, 2, 3]);
  });

  test("Bun.readableStreamToArray returns an array of chunks", async () => {
    const stream = new ReadableStream<string>({
      start(c) {
        c.enqueue("a");
        c.enqueue("b");
        c.close();
      },
    });
    expect(await Bun.readableStreamToArray(stream)).toEqual(["a", "b"]);
  });

  test("Bun.readableStreamToArrayBuffer concatenates Uint8Array chunks", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("foo"));
        c.enqueue(enc.encode("bar"));
        c.close();
      },
    });
    const buf = await Bun.readableStreamToArrayBuffer(stream);
    expect(new TextDecoder().decode(buf)).toBe("foobar");
  });

  test("tee() splits into two independent streams", async () => {
    const stream = new ReadableStream<number>({
      start(c) {
        c.enqueue(10);
        c.enqueue(20);
        c.close();
      },
    });
    const [a, b] = stream.tee();
    const [ra, rb] = await Promise.all([Bun.readableStreamToArray(a), Bun.readableStreamToArray(b)]);
    expect(ra).toEqual([10, 20]);
    expect(rb).toEqual([10, 20]);
  });

  test("cancel() resolves without error", async () => {
    const stream = new ReadableStream<number>({
      start(c) {
        c.enqueue(1);
      },
    });
    const reader = stream.getReader();
    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WritableStream
// ---------------------------------------------------------------------------

describe("WritableStream", () => {
  test("write chunks and close", async () => {
    const received: string[] = [];
    const stream = new WritableStream<string>({
      write(chunk) {
        received.push(chunk);
      },
    });
    const writer = stream.getWriter();
    await writer.write("x");
    await writer.write("y");
    await writer.close();
    expect(received).toEqual(["x", "y"]);
  });

  test("abort() calls abort handler", async () => {
    let abortReason: unknown;
    const stream = new WritableStream({
      abort(reason) {
        abortReason = reason;
      },
    });
    const writer = stream.getWriter();
    await writer.abort("oops");
    expect(abortReason).toBe("oops");
  });

  test("desiredSize is exposed on writer", async () => {
    const stream = new WritableStream<number>(
      {
        write() {},
      },
      new CountQueuingStrategy({ highWaterMark: 3 }),
    );
    const writer = stream.getWriter();
    expect(typeof writer.desiredSize).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// TransformStream
// ---------------------------------------------------------------------------

describe("TransformStream", () => {
  test("transforms each chunk", async () => {
    const transform = new TransformStream<string, string>({
      transform(chunk, controller) {
        controller.enqueue(chunk.toUpperCase());
      },
    });
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    writer.write("hello");
    writer.write("world");
    writer.close();
    const results: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value!);
    }
    expect(results).toEqual(["HELLO", "WORLD"]);
  });

  test("pipe ReadableStream through TransformStream", async () => {
    const source = new ReadableStream<number>({
      start(c) {
        c.enqueue(1);
        c.enqueue(2);
        c.enqueue(3);
        c.close();
      },
    });
    const doubler = new TransformStream<number, number>({
      transform(chunk, ctrl) {
        ctrl.enqueue(chunk * 2);
      },
    });
    source.pipeTo(doubler.writable);
    const result = await Bun.readableStreamToArray(doubler.readable);
    expect(result).toEqual([2, 4, 6]);
  });

  test("flush is called on close", async () => {
    let flushed = false;
    const transform = new TransformStream<string, string>({
      transform(chunk, ctrl) {
        ctrl.enqueue(chunk);
      },
      flush(ctrl) {
        flushed = true;
        ctrl.enqueue("END");
      },
    });
    const writer = transform.writable.getWriter();
    writer.write("a");
    writer.close();
    const chunks = await Bun.readableStreamToArray(transform.readable);
    expect(chunks).toEqual(["a", "END"]);
    expect(flushed).toBe(true);
  });

  test("identity TransformStream passes chunks through", async () => {
    const transform = new TransformStream<string, string>();
    const writer = transform.writable.getWriter();
    writer.write("pass");
    writer.close();
    const result = await Bun.readableStreamToArray(transform.readable);
    expect(result).toEqual(["pass"]);
  });
});

// ---------------------------------------------------------------------------
// Bun.ArrayBufferSink
// ---------------------------------------------------------------------------

describe("Bun.ArrayBufferSink", () => {
  test("basic write + end returns ArrayBuffer", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start();
    sink.write("hello");
    sink.write(" world");
    const result = sink.end();
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(result as ArrayBuffer)).toBe("hello world");
  });

  test("asUint8Array option makes end() return Uint8Array", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start({ asUint8Array: true });
    sink.write("bun");
    const result = sink.end();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result as Uint8Array)).toBe("bun");
  });

  test("write() returns number of bytes written", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start();
    const n = sink.write("abc");
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThan(0);
  });

  test("stream mode: flush() returns Uint8Array of pending data", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start({ stream: true, asUint8Array: true });
    sink.write("chunk1");
    const flushed = sink.flush() as Uint8Array;
    expect(flushed).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(flushed)).toBe("chunk1");
  });

  test("stream mode: writes after flush accumulate correctly", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start({ stream: true, asUint8Array: true });
    sink.write("first");
    sink.flush();
    sink.write("second");
    const second = sink.flush() as Uint8Array;
    expect(new TextDecoder().decode(second)).toBe("second");
  });

  test("highWaterMark preallocates buffer without changing behaviour", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start({ highWaterMark: 1024 });
    sink.write("data");
    const result = new TextDecoder().decode(sink.end() as ArrayBuffer);
    expect(result).toBe("data");
  });

  test("can write ArrayBuffer chunks", () => {
    const sink = new Bun.ArrayBufferSink();
    sink.start();
    sink.write(new TextEncoder().encode("bytes"));
    const result = new TextDecoder().decode(sink.end() as ArrayBuffer);
    expect(result).toBe("bytes");
  });
});

// ---------------------------------------------------------------------------
// Bun.concatArrayBuffers
// ---------------------------------------------------------------------------

describe("Bun.concatArrayBuffers", () => {
  test("concatenates multiple ArrayBuffers", () => {
    const enc = new TextEncoder();
    const a = enc.encode("foo").buffer;
    const b = enc.encode("bar").buffer;
    const result = Bun.concatArrayBuffers([a, b]);
    expect(new TextDecoder().decode(result)).toBe("foobar");
  });

  test("concatenates Uint8Array views", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const result = new Uint8Array(Bun.concatArrayBuffers([a, b]));
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  test("returns an ArrayBuffer by default", () => {
    const result = Bun.concatArrayBuffers([new Uint8Array([1])]);
    expect(result).toBeInstanceOf(ArrayBuffer);
  });

  test("maxLength truncates the result", () => {
    const enc = new TextEncoder();
    const a = enc.encode("hello world").buffer;
    const result = Bun.concatArrayBuffers([a], 5);
    expect(new TextDecoder().decode(result)).toBe("hello");
  });

  test("empty array returns empty ArrayBuffer", () => {
    const result = Bun.concatArrayBuffers([]);
    expect(result.byteLength).toBe(0);
  });
});
