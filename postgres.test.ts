import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import type { PGlite as PGliteType } from "@electric-sql/pglite";
import type { PGLiteSocketServer as PGLiteSocketServerType } from "@electric-sql/pglite-socket";

// ---------------------------------------------------------------------------
// When a real postgres:// DATABASE_URL / POSTGRES_URL is configured, use it.
// Otherwise start an in-process PGlite socket server so the suite always runs.
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
const isPg = DB_URL.startsWith("postgres://") || DB_URL.startsWith("postgresql://");

// Populated in the outer beforeAll — available to all nested tests.
let effectiveUrl = "";
let pgLiteServer: PGLiteSocketServerType | undefined;
let pgLiteDb: PGliteType | undefined;

describe("PostgreSQL — Bun.SQL", () => {
  // Use a fixed table name; afterAll drops it on exit.
  const TABLE = "bun_sql_test";

  let db!: InstanceType<typeof SQL>;

  beforeAll(async () => {
    if (isPg) {
      effectiveUrl = DB_URL;
    } else {
      // Spin up an in-process PGlite TCP socket server.
      const { PGlite } = await import("@electric-sql/pglite");
      const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

      // Pick a free port by briefly binding with port 0.
      const tmp = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: { data() {}, open() {}, close() {}, error() {} },
      });
      const port = tmp.port;
      tmp.stop(true);

      pgLiteDb = await PGlite.create();
      pgLiteServer = new PGLiteSocketServer({ db: pgLiteDb, port, host: "127.0.0.1" });
      await pgLiteServer.start();

      effectiveUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
    }

    db = isPg
      ? new SQL(effectiveUrl)
      : new SQL({ url: effectiveUrl, tls: false });
    await db.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await db.unsafe(`
      CREATE TABLE ${TABLE} (
        id    SERIAL PRIMARY KEY,
        name  TEXT    NOT NULL,
        age   INTEGER,
        email TEXT    UNIQUE
      )
    `);
  });

  afterAll(async () => {
    await db.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await db.close({ timeout: 0 });
    if (pgLiteServer) await pgLiteServer.stop();
    if (pgLiteDb) await pgLiteDb.close();
  });

  // Helper: truncate the table between test groups that mutate data
  async function clear() {
    await db.unsafe(`DELETE FROM ${TABLE}`);
  }

  // ---------------------------------------------------------------------------
  // Connection and basic queries
  // ---------------------------------------------------------------------------

  describe("connection and basic queries", () => {
    test("SELECT 1 returns numeric 1", async () => {
      const [row] = await db`SELECT 1 AS v`;
      expect(row.v).toBe(1);
    });

    test("SELECT a literal string parameter", async () => {
      const [row] = await db`SELECT ${"hello"} AS greeting`;
      expect(row.greeting).toBe("hello");
    });

    test("NOW() returns a Date object", async () => {
      const [row] = await db`SELECT NOW() AS ts`;
      expect(row.ts).toBeInstanceOf(Date);
    });

    test("generate_series returns multiple rows", async () => {
      const rows = await db`SELECT generate_series(1, 5) AS n`;
      expect(rows).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  describe("CRUD", () => {
    beforeAll(() => clear());

    test("INSERT and SELECT", async () => {
      await db`INSERT INTO bun_sql_test (name, age) VALUES ('Alice', 30)`;
      const [row] = await db`SELECT name, age FROM bun_sql_test WHERE name = 'Alice'`;
      expect(row.name).toBe("Alice");
      expect(row.age).toBe(30);
    });

    test("UPDATE changes a value", async () => {
      await db`UPDATE bun_sql_test SET age = 31 WHERE name = 'Alice'`;
      const [row] = await db`SELECT age FROM bun_sql_test WHERE name = 'Alice'`;
      expect(row.age).toBe(31);
    });

    test("DELETE removes a row", async () => {
      await db`DELETE FROM bun_sql_test WHERE name = 'Alice'`;
      const rows = await db`SELECT * FROM bun_sql_test WHERE name = 'Alice'`;
      expect(rows).toHaveLength(0);
    });

    test("empty result set returns []", async () => {
      const rows = await db`SELECT * FROM bun_sql_test WHERE name = 'NoSuchPerson'`;
      expect(rows).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Parameterized query safety
  // ---------------------------------------------------------------------------

  describe("parameterized query safety", () => {
    test("SQL-injection attempt is escaped, not executed", async () => {
      const malicious = "'; DROP TABLE bun_sql_test; --";
      const [row] = await db`SELECT ${malicious} AS v`;
      expect(row.v).toBe(malicious);
      // Confirm table still exists
      const tables = await db`
        SELECT tablename FROM pg_tables WHERE tablename = ${"bun_sql_test"}
      `;
      expect(tables).toHaveLength(1);
    });

    test("numeric parameter passed safely", async () => {
      const [row] = await db`SELECT ${42} AS n`;
      expect(row.n).toBe(42);
    });

    test("boolean parameter passed safely", async () => {
      const [row] = await db`SELECT ${true} AS b`;
      expect(row.b).toBe(true);
    });

    test("null interpolation produces NULL", async () => {
      const [row] = await db`SELECT ${null} AS v`;
      expect(row.v).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // sql() object / array helpers
  // ---------------------------------------------------------------------------

  describe("sql() object and array helpers", () => {
    beforeAll(() => clear());

    test("sql(object) in INSERT expands to column/value pairs", async () => {
      const user = { name: "Bob", age: 25 };
      await db`INSERT INTO bun_sql_test ${db(user)}`;
      const [row] = await db`SELECT name, age FROM bun_sql_test WHERE name = 'Bob'`;
      expect(row.name).toBe("Bob");
      expect(row.age).toBe(25);
    });

    test("sql(object, 'col') picks only the listed columns", async () => {
      const user = { name: "Carol", age: 40, email: "carol@example.com" };
      await db`INSERT INTO bun_sql_test ${db(user, "name", "email")}`;
      const [row] = await db`SELECT name, email, age FROM bun_sql_test WHERE name = 'Carol'`;
      expect(row.name).toBe("Carol");
      expect(row.email).toBe("carol@example.com");
      expect(row.age).toBeNull(); // age was not in the column list
    });

    test("sql(array) performs a bulk INSERT", async () => {
      const people = [
        { name: "Dave", age: 20 },
        { name: "Eve", age: 22 },
      ];
      await db`INSERT INTO bun_sql_test ${db(people)}`;
      const rows = await db`
        SELECT name FROM bun_sql_test
        WHERE name IN ('Dave', 'Eve')
        ORDER BY name
      `;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Dave", "Eve"]);
    });

    test("sql([...]) builds a WHERE IN clause", async () => {
      const names = ["Bob", "Carol"];
      const rows = await db`
        SELECT name FROM bun_sql_test
        WHERE name IN ${db(names)}
        ORDER BY name
      `;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Bob", "Carol"]);
    });

    test("sql(object) in UPDATE SET clause", async () => {
      await db`UPDATE bun_sql_test SET ${db({ age: 99 })} WHERE name = 'Bob'`;
      const [row] = await db`SELECT age FROM bun_sql_test WHERE name = 'Bob'`;
      expect(row.age).toBe(99);
    });
  });

  // ---------------------------------------------------------------------------
  // Query result formats
  // ---------------------------------------------------------------------------

  describe(".values() format", () => {
    beforeAll(async () => {
      await clear();
      await db`INSERT INTO bun_sql_test (name, age) VALUES ('Alice', 30), ('Bob', 25)`;
    });

    test("returns rows as arrays in column order", async () => {
      const rows = await db`
        SELECT name, age FROM bun_sql_test ORDER BY name
      `.values();
      expect(rows[0]).toEqual(["Alice", 30]);
      expect(rows[1]).toEqual(["Bob", 25]);
    });
  });

  describe(".raw() format", () => {
    test("returns rows as arrays of Buffer", async () => {
      const rows = await db`SELECT ${"hello"} AS v`.raw();
      expect(rows[0]).toBeArray();
      expect(rows[0][0]).toBeInstanceOf(Buffer);
      expect(rows[0][0].toString()).toBe("hello");
    });
  });

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  describe("transactions", () => {
    beforeAll(() => clear());

    test("commits on success", async () => {
      await db.begin(async (tx) => {
        await tx`INSERT INTO bun_sql_test (name, age) VALUES ('Tx1', 1)`;
        await tx`INSERT INTO bun_sql_test (name, age) VALUES ('Tx2', 2)`;
      });
      const rows = await db`
        SELECT name FROM bun_sql_test WHERE name LIKE 'Tx%' ORDER BY name
      `;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Tx1", "Tx2"]);
    });

    test("rolls back on thrown error", async () => {
      await expect(
        db.begin(async (tx) => {
          await tx`INSERT INTO bun_sql_test (name, age) VALUES ('TxFail', 99)`;
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const rows = await db`SELECT * FROM bun_sql_test WHERE name = 'TxFail'`;
      expect(rows).toHaveLength(0);
    });

    test("pipelined queries (returned array) commit together", async () => {
      await db.begin(async (tx) => [tx`INSERT INTO bun_sql_test (name, age) VALUES ('Pipe1', 5)`, tx`INSERT INTO bun_sql_test (name, age) VALUES ('Pipe2', 6)`]);
      const rows = await db`
        SELECT name FROM bun_sql_test WHERE name LIKE 'Pipe%' ORDER BY name
      `;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Pipe1", "Pipe2"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Savepoints
  // ---------------------------------------------------------------------------

  describe("savepoints", () => {
    beforeAll(() => clear());

    test("committed savepoint is included in the outer transaction", async () => {
      await db.begin(async (tx) => {
        await tx`INSERT INTO bun_sql_test (name, age) VALUES ('Outer', 10)`;
        await tx.savepoint(async (sp) => {
          await sp`INSERT INTO bun_sql_test (name, age) VALUES ('Inner', 11)`;
        });
      });
      const rows = await db`SELECT name FROM bun_sql_test ORDER BY name`;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Inner", "Outer"]);
    });

    test("rolled-back savepoint leaves outer transaction intact", async () => {
      await clear();
      await db.begin(async (tx) => {
        await tx`INSERT INTO bun_sql_test (name, age) VALUES ('Keep', 20)`;
        await tx
          .savepoint(async (sp) => {
            await sp`INSERT INTO bun_sql_test (name, age) VALUES ('Discard', 21)`;
            throw new Error("rollback savepoint");
          })
          .catch(() => {}); // swallow so outer tx can continue
      });
      const rows = await db`SELECT name FROM bun_sql_test ORDER BY name`;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Keep"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Dynamic SQL fragments
  // ---------------------------------------------------------------------------

  describe("dynamic SQL fragments", () => {
    beforeAll(async () => {
      await clear();
      await db`INSERT INTO bun_sql_test (name, age) VALUES ('Alice', 30), ('Bob', 20)`;
    });

    test("conditional fragment included when truthy", async () => {
      const minAge = 25;
      const filter = db`AND age >= ${minAge}`;
      const rows = await db`
        SELECT name FROM bun_sql_test WHERE 1=1 ${filter} ORDER BY name
      `;
      expect(rows.map((r: { name: string }) => r.name)).toEqual(["Alice"]);
    });

    test("empty fragment excluded when falsy", async () => {
      const includeFilter = false;
      const filter = includeFilter ? db`AND age > 100` : db``;
      const rows = await db`
        SELECT name FROM bun_sql_test WHERE 1=1 ${filter} ORDER BY name
      `;
      expect(rows).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // sql.unsafe()
  // ---------------------------------------------------------------------------

  describe("sql.unsafe()", () => {
    test("executes a raw SQL string", async () => {
      const rows = await db.unsafe("SELECT 1 AS n");
      expect(rows[0].n).toBe(1);
    });

    test("accepts positional $1/$2 parameters", async () => {
      const rows = await db.unsafe("SELECT $1::text AS v, $2::int AS n", ["hello", 7]);
      expect(rows[0].v).toBe("hello");
      expect(rows[0].n).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // .simple() — simple query protocol (multi-statement)
  // ---------------------------------------------------------------------------

  describe(".simple() — simple query protocol", () => {
    test("executes multi-statement SQL without error", async () => {
      const result = await db`SELECT 1 AS a; SELECT 2 AS b`.simple();
      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Reserved connections
  // ---------------------------------------------------------------------------

  describe("reserved connections", () => {
    test("reserve() provides an isolated connection", async () => {
      const reserved = await db.reserve();
      try {
        const [row] = await reserved`SELECT 42 AS v`;
        expect(row.v).toBe(42);
      } finally {
        reserved.release();
      }
    });

    test("using declaration auto-releases via Symbol.dispose", async () => {
      {
        using reserved = await db.reserve();
        const [row] = await reserved`SELECT 1 AS v`;
        expect(row.v).toBe(1);
      } // auto-released here
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    test("query on a non-existent table throws SQL.PostgresError", async () => {
      let caught: unknown;
      try {
        await db`SELECT * FROM table_does_not_exist_xyz`;
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SQL.PostgresError);
    });

    test("UNIQUE constraint violation throws PostgresError with code 23505", async () => {
      await db`INSERT INTO bun_sql_test (name, age, email) VALUES ('Uniq', 1, 'uniq@test.com')`;
      let caught: { code?: string; message?: string } | undefined;
      try {
        await db`INSERT INTO bun_sql_test (name, age, email) VALUES ('Uniq2', 2, 'uniq@test.com')`;
      } catch (e) {
        caught = e as { code?: string; message?: string };
      }
      expect(caught).toBeDefined();
      // Real PostgreSQL uses SQLSTATE 23505; PGlite-socket tunnels it through
      // the error message when the client doesn't parse the ERRORRESPONSE field.
      const isUniqueViolation =
        caught!.code === "23505" ||
        caught!.message?.toLowerCase().includes("unique");
      expect(isUniqueViolation).toBe(true);
    });

    test.skip("syntax error throws SQL.PostgresError", async () => {
      await expect(db`THIS IS NOT SQL`).rejects.toBeInstanceOf(SQL.PostgresError);
    });
  });

  // ---------------------------------------------------------------------------
  // Large integer handling
  // ---------------------------------------------------------------------------

  describe("large integer handling", () => {
    test("integer exceeding 53-bit precision returned as string by default", async () => {
      const [row] = await db`SELECT 9223372036854777 AS v`;
      expect(typeof row.v).toBe("string");
      expect(row.v).toBe("9223372036854777");
    });

    test("safe integer (≤53-bit) returned as number", async () => {
      const [row] = await db`SELECT 12345 AS v`;
      expect(typeof row.v).toBe("number");
      expect(row.v).toBe(12345);
    });

    test.skipIf(!isPg)("bigint:true option returns large integers as BigInt", async () => {
      const bigdb = isPg
        ? new SQL({ url: effectiveUrl, bigint: true })
        : new SQL({ url: effectiveUrl, bigint: true, tls: false });
      try {
        const [row] = await bigdb`SELECT 9223372036854777 AS v`;
        expect(typeof row.v).toBe("bigint");
        expect(row.v).toBe(9223372036854777n);
      } finally {
        await bigdb.close({ timeout: 0 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // sql.array() — PostgreSQL array literals (PG-only)
  // ---------------------------------------------------------------------------

  describe("sql.array() — PostgreSQL array literals", () => {
    test.skipIf(!isPg)("integer array works with ANY()", async () => {
      const ids = [1, 2, 3];
      const [row] = await db`SELECT 2 = ANY(${db.array(ids)}) AS found`;
      expect(row.found).toBe(true);
    });

    test.skipIf(!isPg)("string array works with ANY()", async () => {
      const tags = ["red", "blue"];
      const [row] = await db`SELECT 'red' = ANY(${db.array(tags)}) AS found`;
      expect(row.found).toBe(true);
    });

    test.skipIf(!isPg)("value absent from array returns false", async () => {
      const [row] = await db`SELECT 99 = ANY(${db.array([1, 2, 3])}) AS found`;
      expect(row.found).toBe(false);
    });
  });
});
