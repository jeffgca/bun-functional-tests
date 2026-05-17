import { describe, test, expect, afterEach } from "bun:test";
import { dns } from "bun";

// ---------------------------------------------------------------------------
// Helper: free port via brief Bun.listen bind
// ---------------------------------------------------------------------------
async function freePort(): Promise<number> {
  const tmp = Bun.listen({
    port: 0,
    hostname: "127.0.0.1",
    socket: { data() {}, open() {}, close() {}, error() {} },
  });
  const port = tmp.port;
  tmp.stop(true);
  return port;
}

// ---------------------------------------------------------------------------
// fetch — built-in HTTP client
// ---------------------------------------------------------------------------

describe("fetch — built-in HTTP client", () => {
  test("GET request returns 200 for a local server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    try {
      const res = await fetch(`${server.url}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await server.stop(true);
    }
  });

  test("fetch returns headers from the server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("body", { headers: { "x-custom": "test-value" } });
      },
    });
    try {
      const res = await fetch(`${server.url}`);
      expect(res.headers.get("x-custom")).toBe("test-value");
    } finally {
      await server.stop(true);
    }
  });

  test("POST body is received by server", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        return new Response(body);
      },
    });
    try {
      const res = await fetch(`${server.url}`, {
        method: "POST",
        body: "hello server",
      });
      expect(await res.text()).toBe("hello server");
    } finally {
      await server.stop(true);
    }
  });

  test("JSON round-trip via fetch", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const data = await req.json();
        return Response.json({ received: data });
      },
    });
    try {
      const res = await fetch(`${server.url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: 42 }),
      });
      const json = (await res.json()) as { received: { value: number } };
      expect(json.received.value).toBe(42);
    } finally {
      await server.stop(true);
    }
  });

  test("fetch follows redirect", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/redirect") {
          return Response.redirect(`${server.url}target`, 302);
        }
        return new Response("landed");
      },
    });
    try {
      const res = await fetch(`${server.url}redirect`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("landed");
    } finally {
      await server.stop(true);
    }
  });

  test("fetch with custom request headers", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(req.headers.get("x-req-id") ?? "");
      },
    });
    try {
      const res = await fetch(`${server.url}`, {
        headers: { "x-req-id": "abc123" },
      });
      expect(await res.text()).toBe("abc123");
    } finally {
      await server.stop(true);
    }
  });

  test("404 response status is preserved", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const res = await fetch(`${server.url}`);
      expect(res.status).toBe(404);
    } finally {
      await server.stop(true);
    }
  });

  test("fetch AbortController cancels request", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(5000);
        return new Response("late");
      },
    });
    const ac = new AbortController();
    try {
      ac.abort();
      await expect(fetch(`${server.url}`, { signal: ac.signal })).rejects.toThrow();
    } finally {
      await server.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Bun.dns — DNS resolution
// ---------------------------------------------------------------------------

describe("Bun.dns — DNS resolution", () => {
  test("lookup('localhost') returns 127.0.0.1 or ::1", async () => {
    const results = await dns.lookup("localhost");
    expect(results.length).toBeGreaterThan(0);
    const addrs = results.map((r) => r.address);
    expect(addrs.some((a) => a === "127.0.0.1" || a === "::1")).toBe(true);
  });

  test("lookup result has address and family fields", async () => {
    const [first] = await dns.lookup("localhost");
    expect(typeof first.address).toBe("string");
    expect(first.family === 4 || first.family === 6).toBe(true);
  });

  test("lookup with family:4 returns only IPv4 addresses", async () => {
    const results = await dns.lookup("localhost", { family: 4 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.family).toBe(4);
  });

  test("getCacheStats returns expected shape", () => {
    const stats = dns.getCacheStats();
    expect(typeof stats.cacheHitsCompleted).toBe("number");
    expect(typeof stats.cacheMisses).toBe("number");
    expect(typeof stats.size).toBe("number");
  });

  test("prefetch is callable without error", () => {
    expect(() => dns.prefetch("localhost", 80)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bun.listen / Bun.connect — raw TCP
// ---------------------------------------------------------------------------

describe("Bun.listen / Bun.connect — TCP", () => {
  test("server echoes data back to client", async () => {
    const received: string[] = [];
    const clientReceived: string[] = [];

    const server = Bun.listen<{ id: number }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          socket.write(data); // echo
        },
        open() {},
        close() {},
        error() {},
      },
    });

    const reply = new Promise<string>((resolve) => {
      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write("ping");
          },
          data(_socket, data) {
            resolve(Buffer.from(data).toString());
          },
          close() {},
          error() {},
        },
      });
    });

    try {
      expect(await reply).toBe("ping");
    } finally {
      server.stop(true);
    }
  });

  test("server receives the exact bytes the client sends", async () => {
    const serverGot = new Promise<string>((resolve) => {
      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(_socket, data) {
            resolve(Buffer.from(data).toString());
            server.stop(true);
          },
          open() {},
          close() {},
          error() {},
        },
      });

      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write("hello tcp");
            socket.end();
          },
          data() {},
          close() {},
          error() {},
        },
      });
    });

    expect(await serverGot).toBe("hello tcp");
  });

  test("server.port is a valid port number", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, open() {}, close() {}, error() {} },
    });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.port).toBeLessThanOrEqual(65535);
    } finally {
      server.stop(true);
    }
  });

  test("multiple clients can connect concurrently", async () => {
    const count = { value: 0 };
    const allDone = new Promise<void>((resolve) => {
      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open() {
            count.value++;
            if (count.value === 3) {
              resolve();
              server.stop(true);
            }
          },
          data() {},
          close() {},
          error() {},
        },
      });

      for (let i = 0; i < 3; i++) {
        Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open() {}, data() {}, close() {}, error() {} },
        });
      }
    });

    await allDone;
    expect(count.value).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Bun.udpSocket — UDP
// ---------------------------------------------------------------------------

describe("Bun.udpSocket — UDP", () => {
  test("can create and close a UDP socket", async () => {
    const sock = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data() {},
        error() {},
      },
    });
    expect(sock.port).toBeGreaterThan(0);
    sock.close();
  });

  test("UDP socket has expected properties", async () => {
    const sock = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, error() {} },
    });
    expect(typeof sock.port).toBe("number");
    expect(typeof sock.hostname).toBe("string");
    expect(sock.closed).toBe(false);
    sock.close();
  });

  test("UDP send and receive", async () => {
    const received = new Promise<Buffer>((resolve) => {
      Bun.udpSocket({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(_sock, data) {
            resolve(Buffer.from(data));
          },
          error() {},
        },
      }).then((server) => {
        Bun.udpSocket({
          hostname: "127.0.0.1",
          port: 0,
          socket: { data() {}, error() {} },
        }).then((client) => {
          client.send(Buffer.from("udp-hello"), server.port, "127.0.0.1");
        });
      });
    });

    const data = await received;
    expect(data.toString()).toBe("udp-hello");
  });
});
