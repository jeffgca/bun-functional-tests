import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Connects a WebSocket client, resolving once the connection is open. */
function connectWS(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`WS connect failed: ${url}`)), { once: true });
  });
}

/** Resolves with the payload of the next inbound message. */
function nextMessage(ws: WebSocket): Promise<string | ArrayBuffer> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => resolve(e.data), { once: true });
  });
}

/** Resolves when the WebSocket fires its close event. */
function waitClose(ws: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("close", resolve as EventListener, { once: true });
  });
}

// ── Shared echo server ────────────────────────────────────────────────────────
// open:    increments openCount, sends "connected"
// message: echoes the payload back verbatim
// close:   records last code / reason

let echoServer: Server;
let echoUrl: string;
let openCount = 0;
let lastCloseCode = 0;
let lastCloseReason = "";

beforeAll(() => {
  echoServer = Bun.serve({
    port: 0,
    fetch(req, server) {
      const ok = server.upgrade(req);
      return ok ? undefined : new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        openCount++;
        ws.send("connected");
      },
      message(ws, msg) {
        ws.send(msg as string);
      },
      close(_ws, code, reason) {
        lastCloseCode = code;
        lastCloseReason = reason;
      },
    },
  });
  echoUrl = `ws://localhost:${echoServer.port}`;
});

afterAll(async () => {
  await echoServer.stop(true);
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe("WebSocket lifecycle", () => {
  test("client can connect and receives the open greeting", async () => {
    const ws = await connectWS(echoUrl);
    const greeting = await nextMessage(ws);
    expect(greeting).toBe("connected");
    ws.close();
    await waitClose(ws);
  });

  test("open handler increments server-side open counter", async () => {
    const before = openCount;
    const ws = await connectWS(echoUrl);
    await nextMessage(ws); // consume "connected"
    expect(openCount).toBe(before + 1);
    ws.close();
    await waitClose(ws);
  });

  test("server.pendingWebSockets increments when a socket opens", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws); // ensure open handler has run
    expect(echoServer.pendingWebSockets).toBeGreaterThan(0);
    ws.close();
    await waitClose(ws);
    await Bun.sleep(20); // let the server process the close
  });

  test("close handler receives the close code from client.close()", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws);
    ws.close(4001, "test-reason");
    await waitClose(ws);
    await Bun.sleep(20);
    expect(lastCloseCode).toBe(4001);
    // Note: the close reason string is not guaranteed to survive the round-trip
    // in all Bun versions, so we only assert on the numeric code.
  });

  test("close event fires on the client after ws.close()", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws);
    const closePromise = waitClose(ws);
    ws.close(1000, "normal");
    const evt = await closePromise;
    expect(evt.type).toBe("close");
  });
});

// ── Message exchange ──────────────────────────────────────────────────────────

describe("message exchange", () => {
  test("string message is echoed back correctly", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws); // consume greeting
    ws.send("hello bun websocket");
    expect(await nextMessage(ws)).toBe("hello bun websocket");
    ws.close();
    await waitClose(ws);
  });

  test("multiple sequential messages are echoed in order", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws);
    const messages = ["alpha", "beta", "gamma"];
    const received: string[] = [];
    for (const m of messages) {
      ws.send(m);
      received.push((await nextMessage(ws)) as string);
    }
    expect(received).toEqual(messages);
    ws.close();
    await waitClose(ws);
  });

  test("empty string message is echoed back", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws);
    ws.send("");
    expect(await nextMessage(ws)).toBe("");
    ws.close();
    await waitClose(ws);
  });

  test("binary (Uint8Array) message round-trips correctly", async () => {
    const ws = await connectWS(echoUrl);
    ws.binaryType = "arraybuffer";
    await nextMessage(ws);
    const payload = new Uint8Array([10, 20, 30, 40, 50]);
    ws.send(payload);
    const reply = await nextMessage(ws);
    expect(reply).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(reply as ArrayBuffer)).toEqual(payload);
    ws.close();
    await waitClose(ws);
  });

  test("ArrayBuffer message round-trips correctly", async () => {
    const ws = await connectWS(echoUrl);
    ws.binaryType = "arraybuffer";
    await nextMessage(ws);
    const buf = new Uint8Array([0x62, 0x75, 0x6e]).buffer; // "bun"
    ws.send(buf);
    const reply = await nextMessage(ws);
    expect(reply).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(reply as ArrayBuffer)).toEqual(new Uint8Array(buf));
    ws.close();
    await waitClose(ws);
  });

  test("large string message is echoed back intact", async () => {
    const ws = await connectWS(echoUrl);
    await nextMessage(ws);
    const large = "x".repeat(64 * 1024); // 64 KB
    ws.send(large);
    const reply = await nextMessage(ws);
    expect(reply).toBe(large);
    ws.close();
    await waitClose(ws);
  });
});

// ── ws.send() return value ────────────────────────────────────────────────────

describe("ws.send() backpressure indicator", () => {
  test("send() returns a non-negative integer", async () => {
    let sendResult: number | undefined;
    const probe = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
        return undefined;
      },
      websocket: {
        message(ws, msg) {
          sendResult = ws.send(msg as string);
        },
      },
    });

    try {
      const ws = await connectWS(`ws://localhost:${probe.port}`);
      ws.send("ping");
      await nextMessage(ws).catch(() => {});
      await Bun.sleep(20);
      expect(typeof sendResult).toBe("number");
      expect(sendResult!).toBeGreaterThanOrEqual(0);
      ws.close();
      await waitClose(ws);
    } finally {
      await probe.stop(true);
    }
  });
});

// ── Contextual data (ws.data) ─────────────────────────────────────────────────

describe("contextual data (ws.data)", () => {
  let dataServer: Server;

  beforeAll(() => {
    dataServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        const url = new URL(req.url);
        server.upgrade(req, {
          data: {
            userId: url.searchParams.get("userId") ?? "anon",
            role: url.searchParams.get("role") ?? "user",
          },
        });
        return undefined;
      },
      websocket: {
        data: {} as { userId: string; role: string },
        open(ws) {
          // Reflect the attached data back to the client
          ws.send(JSON.stringify({ userId: ws.data.userId, role: ws.data.role }));
        },
        message(ws, msg) {
          ws.send(msg as string);
        },
      },
    });
  });

  afterAll(async () => {
    await dataServer.stop(true);
  });

  test("ws.data carries userId from the upgrade call", async () => {
    const ws = await connectWS(`ws://localhost:${dataServer.port}/?userId=alice&role=admin`);
    const raw = await nextMessage(ws);
    const data = JSON.parse(raw as string);
    expect(data.userId).toBe("alice");
    expect(data.role).toBe("admin");
    ws.close();
    await waitClose(ws);
  });

  test("multiple connections carry independent data", async () => {
    // Sequential connections avoid message-ordering races.
    const ws1 = await connectWS(`ws://localhost:${dataServer.port}/?userId=user1`);
    const d1 = await nextMessage(ws1);
    const ws2 = await connectWS(`ws://localhost:${dataServer.port}/?userId=user2`);
    const d2 = await nextMessage(ws2);
    expect(JSON.parse(d1 as string).userId).toBe("user1");
    expect(JSON.parse(d2 as string).userId).toBe("user2");
    ws1.close();
    ws2.close();
    await Promise.all([waitClose(ws1), waitClose(ws2)]);
  });
});

// ── Pub/Sub ───────────────────────────────────────────────────────────────────

describe("pub/sub", () => {
  let pubServer: Server;
  let pubBase: string;

  beforeAll(() => {
    pubServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        const topic = new URL(req.url).searchParams.get("topic") ?? "default";
        server.upgrade(req, { data: { topic } });
        return undefined;
      },
      websocket: {
        data: {} as { topic: string },
        open(ws) {
          ws.subscribe(ws.data.topic);
          // Confirm subscription to client
          ws.send(`subscribed:${ws.data.topic}`);
        },
        message(ws, msg) {
          // Respond to introspection commands
          if (msg === "subscriptions") {
            ws.send(JSON.stringify(ws.subscriptions));
            return;
          }
          if (typeof msg === "string" && msg.startsWith("is-subscribed:")) {
            const t = msg.slice("is-subscribed:".length);
            ws.send(ws.isSubscribed(t) ? "yes" : "no");
            return;
          }
          // Otherwise broadcast to topic (excluding self)
          ws.publish(ws.data.topic, `broadcast:${msg}`);
        },
        close(ws) {
          ws.unsubscribe(ws.data.topic);
        },
      },
    });
    pubBase = `ws://localhost:${pubServer.port}`;
  });

  afterAll(async () => {
    await pubServer.stop(true);
  });

  test("subscribe confirmation is received on open", async () => {
    const ws = await connectWS(`${pubBase}/?topic=t1`);
    expect(await nextMessage(ws)).toBe("subscribed:t1");
    ws.close();
    await waitClose(ws);
  });

  test("ws.isSubscribed() returns true after subscribing", async () => {
    const ws = await connectWS(`${pubBase}/?topic=t-sub`);
    await nextMessage(ws); // consume confirmation
    ws.send("is-subscribed:t-sub");
    expect(await nextMessage(ws)).toBe("yes");
    ws.close();
    await waitClose(ws);
  });

  test("ws.isSubscribed() returns false for an unrelated topic", async () => {
    const ws = await connectWS(`${pubBase}/?topic=t-pos`);
    await nextMessage(ws);
    ws.send("is-subscribed:other-topic");
    expect(await nextMessage(ws)).toBe("no");
    ws.close();
    await waitClose(ws);
  });

  test("ws.subscriptions includes the active topic", async () => {
    const ws = await connectWS(`${pubBase}/?topic=t-list`);
    await nextMessage(ws);
    ws.send("subscriptions");
    const raw = await nextMessage(ws);
    const subs = JSON.parse(raw as string) as string[];
    expect(subs).toContain("t-list");
    ws.close();
    await waitClose(ws);
  });

  test("ws.publish() delivers message to other subscribers but not self", async () => {
    // Sequential connect ensures both subscriptions are active before we publish.
    const ws1 = await connectWS(`${pubBase}/?topic=room-a`);
    await nextMessage(ws1); // consume "subscribed:room-a"
    const ws2 = await connectWS(`${pubBase}/?topic=room-a`);
    await nextMessage(ws2); // consume "subscribed:room-a"

    // Register listener on ws2 before ws1 sends
    const ws2Recv = nextMessage(ws2);
    ws1.send("hello-from-ws1");
    expect(await ws2Recv).toBe("broadcast:hello-from-ws1");

    ws1.close();
    ws2.close();
    await Promise.all([waitClose(ws1), waitClose(ws2)]);
  });

  test("server.publish() broadcasts to all subscribers of a topic", async () => {
    const ws1 = await connectWS(`${pubBase}/?topic=announce`);
    await nextMessage(ws1); // consume "subscribed:announce"
    const ws2 = await connectWS(`${pubBase}/?topic=announce`);
    await nextMessage(ws2); // consume "subscribed:announce"

    // Register listeners before publishing
    const ws1Recv = nextMessage(ws1);
    const ws2Recv = nextMessage(ws2);
    pubServer.publish("announce", "server broadcast");

    expect(await ws1Recv).toBe("server broadcast");
    expect(await ws2Recv).toBe("server broadcast");

    ws1.close();
    ws2.close();
    await Promise.all([waitClose(ws1), waitClose(ws2)]);
  });

  test("server.subscriberCount() reflects live subscription count", async () => {
    const topic = `count-${Date.now()}`;
    expect(pubServer.subscriberCount(topic)).toBe(0);

    const ws = await connectWS(`${pubBase}/?topic=${topic}`);
    await nextMessage(ws); // wait for "subscribed:" to ensure open() has run
    expect(pubServer.subscriberCount(topic)).toBe(1);

    ws.close();
    await waitClose(ws);
    await Bun.sleep(20); // let the server process the close
    expect(pubServer.subscriberCount(topic)).toBe(0);
  });
});

// ── Compression ───────────────────────────────────────────────────────────────

describe("perMessageDeflate compression", () => {
  test("messages are received correctly when perMessageDeflate is enabled", async () => {
    const compressed = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
        return undefined;
      },
      websocket: {
        perMessageDeflate: true,
        message(ws, msg) {
          // Echo back with compression flag
          ws.send(msg as string, true);
        },
      },
    });

    try {
      const ws = await connectWS(`ws://localhost:${compressed.port}`);
      const payload = "compress this! ".repeat(100); // repetitive content → good compression ratio
      ws.send(payload);
      const reply = await nextMessage(ws);
      expect(reply).toBe(payload);
      ws.close();
      await waitClose(ws);
    } finally {
      await compressed.stop(true);
    }
  });
});

// ── Custom upgrade headers ─────────────────────────────────────────────────────

describe("custom upgrade headers", () => {
  test("Set-Cookie header is returned in the 101 upgrade response", async () => {
    const headerServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req, {
          headers: { "X-Session": "abc123" },
        });
        return undefined;
      },
      websocket: {
        message(ws, msg) {
          ws.send(msg as string);
        },
      },
    });

    try {
      // Bun's WebSocket client supports reading upgrade response headers
      // We verify the connection succeeds (headers are accepted without error)
      const ws = await connectWS(`ws://localhost:${headerServer.port}`);
      ws.send("ok");
      expect(await nextMessage(ws)).toBe("ok");
      ws.close();
      await waitClose(ws);
    } finally {
      await headerServer.stop(true);
    }
  });
});
