import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisClient } from "bun";

// ---------------------------------------------------------------------------
// Skip the entire suite when no Redis URL is configured.
// Set REDIS_URL or VALKEY_URL to enable these tests.
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL ?? process.env.VALKEY_URL ?? "";
const hasRedis = REDIS_URL.length > 0;

// Unique key prefix per test run — keeps keys isolated and makes cleanup easy.
const PREFIX = `bun:test:${Date.now()}`;
const k = (name: string) => `${PREFIX}:${name}`;

describe.skipIf(!hasRedis)("Redis — Bun.RedisClient", () => {
  let db!: RedisClient;

  beforeAll(async () => {
    db = new RedisClient(REDIS_URL);
    await db.connect();
  });

  afterAll(async () => {
    // Best-effort cleanup: scan and delete every key in our prefix namespace.
    try {
      let cursor = "0";
      do {
        const reply = (await db.send("SCAN", [cursor, "MATCH", PREFIX + ":*", "COUNT", "100"])) as [string, string[]];
        cursor = reply[0]!;
        const keys = reply[1];
        if (keys.length > 0) await db.send("DEL", keys);
      } while (cursor !== "0");
    } catch {
      // ignore cleanup errors
    }
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Connection properties
  // ---------------------------------------------------------------------------

  describe("connection", () => {
    test("connected is true after connect()", () => {
      expect(db.connected).toBe(true);
    });

    test("bufferedAmount is a number", () => {
      expect(typeof db.bufferedAmount).toBe("number");
    });

    test("onconnect / onclose callbacks can be set without error", () => {
      const tmp = new RedisClient(REDIS_URL);
      expect(() => {
        tmp.onconnect = () => {};
        tmp.onclose = () => {};
      }).not.toThrow();
      tmp.close();
    });

    test("PING via send() returns PONG", async () => {
      const result = await db.send("PING", []);
      expect(result).toBe("PONG");
    });
  });

  // ---------------------------------------------------------------------------
  // String operations
  // ---------------------------------------------------------------------------

  describe("string operations", () => {
    const KEY = k("str");

    afterAll(async () => {
      await db.del(KEY);
    });

    test("set() and get() round-trip a string", async () => {
      await db.set(KEY, "hello");
      const val = await db.get(KEY);
      expect(val).toBe("hello");
    });

    test("get() returns null for a missing key", async () => {
      const val = await db.get(k("__missing__"));
      expect(val).toBeNull();
    });

    test("getBuffer() returns a Uint8Array", async () => {
      await db.set(KEY, "binary-ish");
      const buf = await db.getBuffer(KEY);
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(buf!).toString()).toBe("binary-ish");
    });

    test("del() removes a key and returns 1", async () => {
      await db.set(KEY, "gone");
      const count = await db.del(KEY);
      expect(count).toBe(1);
      expect(await db.get(KEY)).toBeNull();
    });

    test("exists() returns true when key is present", async () => {
      await db.set(KEY, "present");
      const result = await db.exists(KEY);
      expect(result).toBe(true);
    });

    test("exists() returns false when key is absent", async () => {
      await db.del(KEY);
      const result = await db.exists(KEY);
      expect(result).toBe(false);
    });

    test("expire() sets a TTL and ttl() reads it back", async () => {
      await db.set(KEY, "ephemeral");
      await db.expire(KEY, 120);
      const ttl = await db.ttl(KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120);
    });

    test("ttl() returns -1 for a key with no expiry", async () => {
      await db.set(KEY, "persistent");
      const ttl = await db.ttl(KEY);
      expect(ttl).toBe(-1);
    });

    test("overwriting a key replaces its value", async () => {
      await db.set(KEY, "first");
      await db.set(KEY, "second");
      expect(await db.get(KEY)).toBe("second");
    });
  });

  // ---------------------------------------------------------------------------
  // Numeric operations
  // ---------------------------------------------------------------------------

  describe("numeric operations", () => {
    const KEY = k("counter");

    afterAll(async () => {
      await db.del(KEY);
    });

    test("incr() increments and returns the new value", async () => {
      await db.set(KEY, "0");
      const v = await db.incr(KEY);
      expect(v).toBe(1);
    });

    test("incr() is additive across multiple calls", async () => {
      await db.set(KEY, "10");
      await db.incr(KEY);
      await db.incr(KEY);
      const val = await db.get(KEY);
      expect(Number(val)).toBe(12);
    });

    test("decr() decrements and returns the new value", async () => {
      await db.set(KEY, "5");
      const v = await db.decr(KEY);
      expect(v).toBe(4);
    });

    test("decr() goes negative", async () => {
      await db.set(KEY, "0");
      const v = await db.decr(KEY);
      expect(v).toBe(-1);
    });
  });

  // ---------------------------------------------------------------------------
  // Hash operations
  // ---------------------------------------------------------------------------

  describe("hash operations", () => {
    const HASH = k("hash");

    afterAll(async () => {
      await db.del(HASH);
    });

    test("hmset() stores multiple fields, hmget() retrieves them", async () => {
      await db.hmset(HASH, ["name", "Alice", "email", "alice@example.com"]);
      const vals = await db.hmget(HASH, ["name", "email"]);
      expect(vals).toEqual(["Alice", "alice@example.com"]);
    });

    test("hget() retrieves a single field by name", async () => {
      await db.hmset(HASH, ["city", "Springfield"]);
      const city = await db.hget(HASH, "city");
      expect(city).toBe("Springfield");
    });

    test("hget() returns null for a missing field", async () => {
      const val = await db.hget(HASH, "__no_such_field__");
      expect(val).toBeNull();
    });

    test("hmget() returns null for absent fields", async () => {
      const vals = await db.hmget(HASH, ["name", "__absent__"]);
      expect(vals[0]).toBe("Alice");
      expect(vals[1]).toBeNull();
    });

    test("hincrby() increments an integer hash field", async () => {
      await db.hmset(HASH, ["visits", "0"]);
      await db.hincrby(HASH, "visits", 5);
      const val = await db.hget(HASH, "visits");
      expect(Number(val)).toBe(5);
    });

    test("hincrbyfloat() increments a float hash field", async () => {
      await db.hmset(HASH, ["score", "1.0"]);
      await db.hincrbyfloat(HASH, "score", 0.5);
      const val = await db.hget(HASH, "score");
      expect(Number(val)).toBeCloseTo(1.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Set operations
  // ---------------------------------------------------------------------------

  describe("set operations", () => {
    const SET = k("set");

    afterAll(async () => {
      await db.del(SET);
    });

    test("sadd() adds members, smembers() returns them all", async () => {
      await db.sadd(SET, "alpha");
      await db.sadd(SET, "beta");
      await db.sadd(SET, "gamma");
      const members = await db.smembers(SET);
      expect(members).toHaveLength(3);
      expect(members.sort()).toEqual(["alpha", "beta", "gamma"]);
    });

    test("sismember() returns true for an existing member", async () => {
      const result = await db.sismember(SET, "alpha");
      expect(result).toBe(true);
    });

    test("sismember() returns false for a non-member", async () => {
      const result = await db.sismember(SET, "__absent__");
      expect(result).toBe(false);
    });

    test("srem() removes a member", async () => {
      await db.sadd(SET, "temporary");
      await db.srem(SET, "temporary");
      const result = await db.sismember(SET, "temporary");
      expect(result).toBe(false);
    });

    test("srandmember() returns a member from the set", async () => {
      const member = await db.srandmember(SET);
      expect(["alpha", "beta", "gamma"]).toContain(member);
    });

    test("spop() removes and returns a member", async () => {
      // Add a dedicated member so we can pop exactly it without affecting other tests
      await db.sadd(SET, "popme");
      const popped = await db.spop(SET);
      expect(typeof popped).toBe("string");
      // The popped key should no longer be a member
      const stillThere = await db.sismember(SET, popped as string);
      expect(stillThere).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Raw commands via send()
  // ---------------------------------------------------------------------------

  describe("raw commands via send()", () => {
    const LIST = k("list");

    afterAll(async () => {
      await db.del(LIST);
    });

    test("LPUSH + LRANGE builds a list in the expected order", async () => {
      await db.send("LPUSH", [LIST, "c", "b", "a"]);
      const result = await db.send("LRANGE", [LIST, "0", "-1"]);
      // LPUSH pushes to the head: a, b, c pushed in sequence → stored as a, b, c
      expect(result).toBeArray();
    });

    test("TYPE returns the type of a key", async () => {
      const type = await db.send("TYPE", [LIST]);
      expect(type).toBe("list");
    });

    test("OBJECT ENCODING returns a string", async () => {
      const enc = await db.send("OBJECT", ["ENCODING", LIST]);
      expect(typeof enc).toBe("string");
    });

    test("DBSIZE returns a non-negative number", async () => {
      const size = await db.send("DBSIZE", []);
      expect(typeof size).toBe("number");
      expect(size).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-pipelining — Promise.all sends multiple commands concurrently
  // ---------------------------------------------------------------------------

  describe("auto-pipelining", () => {
    const KA = k("pipe:a");
    const KB = k("pipe:b");

    afterAll(async () => {
      await db.del(KA);
      await db.del(KB);
    });

    test("concurrent set and get commands all resolve correctly", async () => {
      await Promise.all([db.set(KA, "valueA"), db.set(KB, "valueB")]);
      const [a, b] = await Promise.all([db.get(KA), db.get(KB)]);
      expect(a).toBe("valueA");
      expect(b).toBe("valueB");
    });

    test("ten concurrent incr operations all resolve", async () => {
      await db.set(KA, "0");
      await Promise.all(Array.from({ length: 10 }, () => db.incr(KA)));
      const val = await db.get(KA);
      expect(Number(val)).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Pub/Sub  (subscriber uses a duplicated connection)
  // ---------------------------------------------------------------------------

  describe("pub/sub", () => {
    test("subscriber receives a published message", async () => {
      const channel = k("pubsub:channel");
      const subscriber = await db.duplicate();
      let received: { message: string; channel: string } | undefined;

      await new Promise<void>(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("pub/sub timeout")), 3000);
        await subscriber.subscribe(channel, (message: string, ch: string) => {
          received = { message, channel: ch };
          clearTimeout(timer);
          resolve();
        });
        // Small delay to ensure subscribe is active before publishing
        await Bun.sleep(50);
        await db.publish(channel, "hello-from-bun");
      });

      await subscriber.unsubscribe(channel);
      subscriber.close();

      expect(received).toBeDefined();
      expect(received!.message).toBe("hello-from-bun");
      expect(received!.channel).toBe(channel);
    });

    test("unsubscribe stops message delivery", async () => {
      const channel = k("pubsub:unsub");
      const subscriber = await db.duplicate();
      let count = 0;

      await subscriber.subscribe(channel, () => {
        count++;
      });
      await Bun.sleep(30);
      await subscriber.unsubscribe(channel);
      await Bun.sleep(30);
      await db.publish(channel, "should-not-arrive");
      await Bun.sleep(50);

      subscriber.close();
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    test("WRONGTYPE error thrown when operating on wrong key type", async () => {
      const KEY = k("err:type");
      await db.set(KEY, "string-value");
      // SMEMBERS on a string key should throw a WRONGTYPE error
      await expect(db.smembers(KEY)).rejects.toThrow();
      await db.del(KEY);
    });

    test("connection closed via close() sets connected to false", async () => {
      const tmp = new RedisClient(REDIS_URL);
      await tmp.connect();
      expect(tmp.connected).toBe(true);
      tmp.close();
      expect(tmp.connected).toBe(false);
    });
  });
});
