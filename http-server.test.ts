import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import type { Server } from "bun";

const FIXTURES = join(import.meta.dir, "fixtures");

// ---------------------------------------------------------------------------
// Shared server — spin up once on a random port, stop after all tests
// ---------------------------------------------------------------------------

let server: Server;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0, // random available port
    routes: {
      // ── Static routes ───────────────────────────────────────────────────
      "/health": new Response("OK", { status: 200 }),

      "/api/static-json": Response.json({ hello: "bun" }),

      // ── Parameterised routes ────────────────────────────────────────────
      "/users/:id": (req) => Response.json({ id: req.params.id }),

      "/orgs/:org/repos/:repo": (req) => Response.json({ org: req.params.org, repo: req.params.repo }),

      // ── HTTP verb routing ────────────────────────────────────────────────
      "/api/items": {
        GET: () => Response.json([{ id: 1 }, { id: 2 }]),
        POST: async (req) => {
          const body = await req.json();
          return Response.json({ created: true, ...body }, { status: 201 });
        },
        PUT: async (req) => {
          const body = await req.json();
          return Response.json({ updated: true, ...body });
        },
        DELETE: () => new Response(null, { status: 204 }),
        PATCH: async (req) => {
          const body = await req.json();
          return Response.json({ patched: true, ...body });
        },
      },

      // ── Body parsing ─────────────────────────────────────────────────────
      "/echo/json": async (req) => Response.json(await req.json()),
      "/echo/text": async (req) => new Response(await req.text()),
      "/echo/formdata": async (req) => {
        const fd = await req.formData();
        return Response.json({ name: fd.get("name"), age: fd.get("age") });
      },
      "/echo/urlencoded": async (req) => {
        const params = new URLSearchParams(await req.text());
        return Response.json({
          user: params.get("user"),
          pass: params.get("pass"),
        });
      },
      "/echo/arraybuffer": async (req) => {
        const buf = await req.arrayBuffer();
        return new Response(buf, {
          headers: { "Content-Type": "application/octet-stream" },
        });
      },

      // ── File streaming ───────────────────────────────────────────────────
      "/file/stream": () => new Response(Bun.file(join(FIXTURES, "sample.txt"))),

      // ── Response streaming (async generator) ─────────────────────────────
      "/stream/generator": (req, srv) => {
        srv.timeout(req, 0);
        return new Response(
          async function* () {
            yield "chunk-1\n";
            yield "chunk-2\n";
            yield "chunk-3\n";
          },
          { headers: { "Content-Type": "text/plain" } },
        );
      },

      // ── SSE ───────────────────────────────────────────────────────────────
      "/sse": (req, srv) => {
        srv.timeout(req, 0);
        return new Response(
          async function* () {
            yield "data: hello\n\n";
            yield "data: world\n\n";
          },
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
        );
      },

      // ── Wildcard ──────────────────────────────────────────────────────────
      "/api/*": () => new Response("wildcard", { status: 200 }),
    },

    // ── Error handler ─────────────────────────────────────────────────────
    error(err) {
      return new Response(`error:${err.message}`, { status: 500 });
    },

    // ── Fallback for unmatched routes ─────────────────────────────────────
    fetch(req) {
      return new Response("not found", { status: 404 });
    },
  });

  base = server.url.toString().replace(/\/$/, "");
});

afterAll(async () => {
  await server.stop(true);
});

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

describe("server lifecycle", () => {
  test("server.url is a valid URL", () => {
    const url = new URL(base);
    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("localhost");
  });

  test("server.port is a positive integer", () => {
    expect(server.port).toBeGreaterThan(0);
    expect(Number.isInteger(server.port)).toBe(true);
  });

  test("server.pendingRequests is a non-negative number", () => {
    expect(server.pendingRequests).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Static routes
// ---------------------------------------------------------------------------

describe("static routes", () => {
  test("GET /health returns 200 OK", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("GET /api/static-json returns pre-built JSON", async () => {
    const res = await fetch(`${base}/api/static-json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json).toEqual({ hello: "bun" });
  });

  test("unmatched route falls through to fetch() handler with 404", async () => {
    const res = await fetch(`${base}/this-does-not-exist`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Parameterised routes
// ---------------------------------------------------------------------------

describe("parameterised routes", () => {
  test("single param :id is captured correctly", async () => {
    const res = await fetch(`${base}/users/42`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("42");
  });

  test("multiple params :org and :repo are captured correctly", async () => {
    const res = await fetch(`${base}/orgs/bunjs/repos/bun`);
    const json = await res.json();
    expect(json.org).toBe("bunjs");
    expect(json.repo).toBe("bun");
  });

  test("URL-encoded param is decoded", async () => {
    const res = await fetch(`${base}/users/hello%20world`);
    const json = await res.json();
    expect(json.id).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// HTTP verb routing
// ---------------------------------------------------------------------------

describe("HTTP verb routing", () => {
  test("GET /api/items returns array", async () => {
    const res = await fetch(`${base}/api/items`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(2);
  });

  test("POST /api/items creates resource with 201", async () => {
    const res = await fetch(`${base}/api/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "widget" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.created).toBe(true);
    expect(json.name).toBe("widget");
  });

  test("PUT /api/items updates resource", async () => {
    const res = await fetch(`${base}/api/items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, name: "gadget" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(true);
  });

  test("DELETE /api/items returns 204 No Content", async () => {
    const res = await fetch(`${base}/api/items`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("PATCH /api/items partially updates resource", async () => {
    const res = await fetch(`${base}/api/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated-widget" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.patched).toBe(true);
    expect(json.name).toBe("updated-widget");
  });
});

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

describe("request body parsing", () => {
  test("JSON body is parsed correctly", async () => {
    const payload = { foo: "bar", num: 99 };
    const res = await fetch(`${base}/echo/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(await res.json()).toEqual(payload);
  });

  test("plain text body is echoed back", async () => {
    const res = await fetch(`${base}/echo/text`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello text",
    });
    expect(await res.text()).toBe("hello text");
  });

  test("FormData body fields are parsed", async () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("age", "30");
    const res = await fetch(`${base}/echo/formdata`, { method: "POST", body: fd });
    const json = await res.json();
    expect(json.name).toBe("Alice");
    expect(json.age).toBe("30");
  });

  test("application/x-www-form-urlencoded body is parsed", async () => {
    const res = await fetch(`${base}/echo/urlencoded`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "user=jeff&pass=secret",
    });
    const json = await res.json();
    expect(json.user).toBe("jeff");
    expect(json.pass).toBe("secret");
  });

  test("ArrayBuffer body round-trips correctly", async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await fetch(`${base}/echo/arraybuffer`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: original,
    });
    const echoed = new Uint8Array(await res.arrayBuffer());
    expect(echoed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// File streaming
// ---------------------------------------------------------------------------

describe("file streaming", () => {
  test("BunFile is streamed as response body", async () => {
    const res = await fetch(`${base}/file/stream`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Hello, Bun!");
  });

  test("streamed file has a content-type header", async () => {
    const res = await fetch(`${base}/file/stream`);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });
});

// ---------------------------------------------------------------------------
// Response streaming (async generator)
// ---------------------------------------------------------------------------

describe("response streaming", () => {
  test("async generator streams chunks in order", async () => {
    const res = await fetch(`${base}/stream/generator`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("chunk-1\nchunk-2\nchunk-3\n");
  });
});

// ---------------------------------------------------------------------------
// Server-Sent Events
// ---------------------------------------------------------------------------

describe("server-sent events", () => {
  test("SSE endpoint returns text/event-stream content-type", async () => {
    const res = await fetch(`${base}/sse`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  test("SSE response body contains valid event frames", async () => {
    const res = await fetch(`${base}/sse`);
    const text = await res.text();
    expect(text).toContain("data: hello\n\n");
    expect(text).toContain("data: world\n\n");
  });
});

// ---------------------------------------------------------------------------
// Wildcard routes
// ---------------------------------------------------------------------------

describe("wildcard routes", () => {
  test("/api/* catches unmatched paths under /api/", async () => {
    const res = await fetch(`${base}/api/unknown/path`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("wildcard");
  });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

describe("error handler", () => {
  test("thrown error in route invokes the error() callback", async () => {
    // Reload server with an intentionally throwing route
    const errorServer = Bun.serve({
      port: 0,
      routes: {
        "/boom": () => {
          throw new Error("intentional");
        },
      },
      error(err) {
        return new Response(`error:${err.message}`, { status: 500 });
      },
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const res = await fetch(`${errorServer.url}boom`);
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("error:intentional");
    } finally {
      await errorServer.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Server metrics
// ---------------------------------------------------------------------------

describe("server metrics", () => {
  test("server.pendingWebSockets starts at 0", () => {
    expect(server.pendingWebSockets).toBe(0);
  });

  test("server.subscriberCount returns 0 for unknown topic", () => {
    expect(server.subscriberCount("nonexistent-topic")).toBe(0);
  });

  test("server.requestIP returns null or SocketAddress for a request", async () => {
    let capturedIP: { address: string; port: number; family: string } | null = null;

    const ipServer = Bun.serve({
      port: 0,
      fetch(req, srv) {
        capturedIP = srv.requestIP(req) as typeof capturedIP;
        return new Response("ok");
      },
    });

    try {
      await fetch(`${ipServer.url}`);
      // requestIP may be null in test environments (unix socket etc.)
      if (capturedIP !== null) {
        expect(typeof capturedIP.address).toBe("string");
        expect(capturedIP.port).toBeGreaterThan(0);
      }
    } finally {
      await ipServer.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// server.reload()
// ---------------------------------------------------------------------------

describe("server.reload()", () => {
  test("routes can be hot-swapped without restarting the server", async () => {
    const reloadServer = Bun.serve({
      port: 0,
      routes: {
        "/api/version": Response.json({ version: "v1" }),
      },
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const v1 = await (await fetch(`${reloadServer.url}api/version`)).json();
      expect(v1.version).toBe("v1");

      reloadServer.reload({
        routes: {
          "/api/version": Response.json({ version: "v2" }),
        },
        fetch() {
          return new Response("not found", { status: 404 });
        },
      });

      const v2 = await (await fetch(`${reloadServer.url}api/version`)).json();
      expect(v2.version).toBe("v2");
    } finally {
      await reloadServer.stop(true);
    }
  });
});
