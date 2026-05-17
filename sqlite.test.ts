import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SQL } from "bun";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a fresh in-memory Database with a standard `users` table. */
function freshDB(opts?: ConstructorParameters<typeof Database>[1]) {
  const db = new Database(":memory:", opts);
  db.run(`
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL,
      age  INTEGER NOT NULL,
      bio  TEXT
    )
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Opening & closing databases
// ---------------------------------------------------------------------------

describe("Database constructor", () => {
  test("opens an in-memory database with :memory:", () => {
    const db = new Database(":memory:");
    expect(db).toBeDefined();
    db.close();
  });

  test("opens an in-memory database with empty string", () => {
    const db = new Database("");
    expect(db).toBeDefined();
    db.close();
  });

  test("opens an in-memory database with no argument", () => {
    const db = new Database();
    expect(db).toBeDefined();
    db.close();
  });

  test(".close() can be called multiple times without error", () => {
    const db = new Database(":memory:");
    db.close();
    expect(() => db.close()).not.toThrow();
  });

  test("using statement auto-closes the database", () => {
    let inner: Database | undefined;
    {
      using db = new Database(":memory:");
      inner = db;
      expect(() => db.query("SELECT 1").get()).not.toThrow();
    }
    // After the block exits, the db should be closed
    expect(() => inner!.query("SELECT 1").get()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Basic CRUD via db.query()
// ---------------------------------------------------------------------------

describe("basic CRUD", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => {
    db.close();
  });

  test(".run() INSERT returns lastInsertRowid and changes", () => {
    const result = db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");
    expect(result.lastInsertRowid).toBe(1);
    expect(result.changes).toBe(1);
  });

  test(".query().get() returns the first matching row as an object", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Bob', 25)");
    const row = db.query("SELECT * FROM users WHERE name = 'Bob'").get() as { name: string; age: number };
    expect(row.name).toBe("Bob");
    expect(row.age).toBe(25);
  });

  test(".query().get() returns null when no row matches", () => {
    const row = db.query("SELECT * FROM users WHERE id = 999").get();
    expect(row).toBeNull();
  });

  test(".query().all() returns all matching rows as an array of objects", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");
    db.run("INSERT INTO users (name, age) VALUES ('Bob', 25)");
    const rows = db.query("SELECT * FROM users ORDER BY name").all() as { name: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe("Alice");
    expect(rows[1]!.name).toBe("Bob");
  });

  test(".query().all() returns empty array when no rows match", () => {
    const rows = db.query("SELECT * FROM users WHERE age > 100").all();
    expect(rows).toEqual([]);
  });

  test("UPDATE reflects change count in .run() result", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");
    db.run("INSERT INTO users (name, age) VALUES ('Bob', 25)");
    const result = db.run("UPDATE users SET age = age + 1 WHERE age < 30");
    expect(result.changes).toBe(1);
  });

  test("DELETE removes rows and reflects change count", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");
    db.run("INSERT INTO users (name, age) VALUES ('Bob', 25)");
    const result = db.run("DELETE FROM users WHERE name = 'Alice'");
    expect(result.changes).toBe(1);
    const remaining = db.query("SELECT * FROM users").all();
    expect(remaining).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Prepared statements & parameter binding
// ---------------------------------------------------------------------------

describe("prepared statements and parameters", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => {
    db.close();
  });

  test("named parameter with $ prefix", () => {
    const stmt = db.query("INSERT INTO users (name, age) VALUES ($name, $age)");
    stmt.run({ $name: "Alice", $age: 30 });
    const row = db.query("SELECT * FROM users").get() as { name: string; age: number };
    expect(row.name).toBe("Alice");
    expect(row.age).toBe(30);
  });

  test("named parameter with : prefix", () => {
    const stmt = db.query("INSERT INTO users (name, age) VALUES (:name, :age)");
    stmt.run({ ":name": "Bob", ":age": 22 });
    const row = db.query("SELECT name FROM users").get() as { name: string };
    expect(row.name).toBe("Bob");
  });

  test("positional ? parameters", () => {
    const stmt = db.query("INSERT INTO users (name, age) VALUES (?, ?)");
    stmt.run("Carol", 40);
    const row = db.query("SELECT name FROM users").get() as { name: string };
    expect(row.name).toBe("Carol");
  });

  test("numbered ?1 ?2 parameters", () => {
    const stmt = db.query("SELECT ?1 AS a, ?2 AS b");
    const row = stmt.get("hello", "world") as { a: string; b: string };
    expect(row.a).toBe("hello");
    expect(row.b).toBe("world");
  });

  test("statement is reusable with different parameters", () => {
    const stmt = db.query("INSERT INTO users (name, age) VALUES ($name, $age)");
    stmt.run({ $name: "Dave", $age: 10 });
    stmt.run({ $name: "Eve", $age: 20 });
    const rows = db.query("SELECT name FROM users ORDER BY name").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["Dave", "Eve"]);
  });

  test("strict mode allows binding without prefixes", () => {
    const strict = new Database(":memory:", { strict: true });
    strict.run("CREATE TABLE t (val TEXT)");
    strict.query("INSERT INTO t VALUES ($val)").run({ val: "no-prefix" });
    const row = strict.query("SELECT val FROM t").get() as { val: string };
    expect(row.val).toBe("no-prefix");
    strict.close();
  });

  test(".values() returns rows as arrays", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");
    db.run("INSERT INTO users (name, age) VALUES ('Bob', 25)");
    const rows = db.query("SELECT name, age FROM users ORDER BY name").values() as [string, number][];
    expect(rows[0]).toEqual(["Alice", 30]);
    expect(rows[1]).toEqual(["Bob", 25]);
  });

  test(".iterate() yields rows one at a time", () => {
    db.run("INSERT INTO users (name, age) VALUES ('A', 1)");
    db.run("INSERT INTO users (name, age) VALUES ('B', 2)");
    const names: string[] = [];
    for (const row of db.query("SELECT name FROM users ORDER BY name").iterate() as Iterable<{ name: string }>) {
      names.push(row.name);
    }
    expect(names).toEqual(["A", "B"]);
  });

  test(".as(Class) maps rows to class instances with methods", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");

    class User {
      name!: string;
      age!: number;
      get isAdult() {
        return this.age >= 18;
      }
    }

    const rows = db.query("SELECT name, age FROM users").as(User).all();
    expect(rows[0]).toBeInstanceOf(User);
    expect(rows[0]!.isAdult).toBe(true);
  });

  test(".finalize() prevents further execution", () => {
    const stmt = db.query("SELECT 1");
    stmt.finalize();
    expect(() => stmt.get()).toThrow();
  });

  test(".toString() reflects the last bound parameter values", () => {
    const stmt = db.query("SELECT $val");
    stmt.get({ $val: 42 });
    expect(stmt.toString()).toContain("42");
  });

  test("columnNames is populated after .get()", () => {
    db.run("INSERT INTO users (name, age) VALUES ('Alice', 30)");
    const stmt = db.query("SELECT name, age FROM users");
    stmt.get();
    expect(stmt.columnNames).toContain("name");
    expect(stmt.columnNames).toContain("age");
  });
});

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

describe("data type round-trips", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.run("CREATE TABLE types (id INTEGER PRIMARY KEY, val ANY)");
  });
  afterEach(() => {
    db.close();
  });

  test("TEXT stores and retrieves a string", () => {
    db.run("INSERT INTO types (val) VALUES (?)", "hello");
    const row = db.query("SELECT val FROM types").get() as { val: string };
    expect(row.val).toBe("hello");
  });

  test("INTEGER stores and retrieves a number", () => {
    db.run("INSERT INTO types (val) VALUES (?)", 42);
    const row = db.query("SELECT val FROM types").get() as { val: number };
    expect(row.val).toBe(42);
  });

  test("REAL stores and retrieves a float", () => {
    db.run("INSERT INTO types (val) VALUES (?)", 3.14);
    const row = db.query("SELECT val FROM types").get() as { val: number };
    expect(row.val).toBeCloseTo(3.14);
  });

  test("NULL stores and retrieves null", () => {
    db.run("INSERT INTO types (val) VALUES (?)", null);
    const row = db.query("SELECT val FROM types").get() as { val: null };
    expect(row.val).toBeNull();
  });

  test("BLOB (Uint8Array) stores and retrieves binary data", () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    db.run("INSERT INTO types (val) VALUES (?)", blob);
    const row = db.query("SELECT val FROM types").get() as { val: Uint8Array };
    expect(row.val).toBeInstanceOf(Uint8Array);
    expect(row.val).toEqual(blob);
  });

  test("Buffer stores and retrieves as Uint8Array", () => {
    const buf = Buffer.from("bun");
    db.run("INSERT INTO types (val) VALUES (?)", buf);
    const row = db.query("SELECT val FROM types").get() as { val: Uint8Array };
    expect(row.val).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(row.val).toString()).toBe("bun");
  });

  test("boolean true stores as 1, retrieves as 1", () => {
    db.run("INSERT INTO types (val) VALUES (?)", true);
    const row = db.query("SELECT val FROM types").get() as { val: number };
    expect(row.val).toBe(1);
  });

  test("boolean false stores as 0, retrieves as 0", () => {
    db.run("INSERT INTO types (val) VALUES (?)", false);
    const row = db.query("SELECT val FROM types").get() as { val: number };
    expect(row.val).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// safeIntegers
// ---------------------------------------------------------------------------

describe("safeIntegers", () => {
  test("default mode returns large integers as number (possibly imprecise)", () => {
    const db = new Database(":memory:");
    const bigVal = BigInt(Number.MAX_SAFE_INTEGER) + 102n;
    const row = db.query(`SELECT ${bigVal} AS v`).get() as { v: number };
    // Without safeIntegers the result is a JS number (may have lost precision)
    expect(typeof row.v).toBe("number");
    db.close();
  });

  test("safeIntegers:true returns large integers as bigint", () => {
    const db = new Database(":memory:", { safeIntegers: true });
    const bigVal = BigInt(Number.MAX_SAFE_INTEGER) + 102n;
    const row = db.query(`SELECT ${bigVal} AS v`).get() as { v: bigint };
    expect(typeof row.v).toBe("bigint");
    expect(row.v).toBe(bigVal);
    db.close();
  });

  test("safeIntegers:true throws when bigint exceeds 64 bits", () => {
    const db = new Database(":memory:", { safeIntegers: true });
    db.run("CREATE TABLE t (v INTEGER)");
    const stmt = db.query("INSERT INTO t VALUES ($v)");
    expect(() => stmt.run({ $v: BigInt(Number.MAX_SAFE_INTEGER) ** 2n })).toThrow();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

describe("transactions", () => {
  let db: Database;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => {
    db.close();
  });

  test("transaction commits on success", () => {
    const insert = db.prepare("INSERT INTO users (name, age) VALUES ($name, $age)");
    const insertMany = db.transaction((people: { $name: string; $age: number }[]) => {
      for (const p of people) insert.run(p);
      return people.length;
    });

    const count = insertMany([
      { $name: "Alice", $age: 30 },
      { $name: "Bob", $age: 25 },
    ]);

    expect(count).toBe(2);
    expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 2 });
  });

  test("transaction rolls back on error", () => {
    const insert = db.prepare("INSERT INTO users (name, age) VALUES ($name, $age)");
    const failTx = db.transaction(() => {
      insert.run({ $name: "Alice", $age: 30 });
      throw new Error("abort!");
    });

    expect(() => failTx()).toThrow("abort!");
    // Nothing should have been committed
    const rows = db.query("SELECT * FROM users").all();
    expect(rows).toHaveLength(0);
  });

  test("transaction return value is propagated", () => {
    const tx = db.transaction(() => {
      db.run("INSERT INTO users (name, age) VALUES ('X', 1)");
      return "done";
    });
    expect(tx()).toBe("done");
  });

  test("nested transactions use savepoints", () => {
    const inner = db.transaction(() => {
      db.run("INSERT INTO users (name, age) VALUES ('Inner', 1)");
    });
    const outer = db.transaction(() => {
      db.run("INSERT INTO users (name, age) VALUES ('Outer', 2)");
      inner(); // nested → savepoint
    });

    outer();
    const rows = db.query("SELECT name FROM users ORDER BY name").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["Inner", "Outer"]);
  });

  test("deferred transaction variant executes successfully", () => {
    const insert = db.prepare("INSERT INTO users (name, age) VALUES ($name, $age)");
    const tx = db.transaction((name: string) => insert.run({ $name: name, $age: 1 }));
    tx.deferred("Alice");
    expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
  });

  test("immediate transaction variant executes successfully", () => {
    const insert = db.prepare("INSERT INTO users (name, age) VALUES ($name, $age)");
    const tx = db.transaction((name: string) => insert.run({ $name: name, $age: 1 }));
    tx.immediate("Bob");
    expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
  });

  test("exclusive transaction variant executes successfully", () => {
    const insert = db.prepare("INSERT INTO users (name, age) VALUES ($name, $age)");
    const tx = db.transaction((name: string) => insert.run({ $name: name, $age: 1 }));
    tx.exclusive("Carol");
    expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 1 });
  });
});

// ---------------------------------------------------------------------------
// Pragmas & WAL mode
// ---------------------------------------------------------------------------

describe("pragmas and WAL mode", () => {
  test("journal_mode = WAL is accepted", () => {
    const db = new Database(":memory:");
    const result = db.query("PRAGMA journal_mode = WAL").get() as { journal_mode: string };
    // In-memory databases always report "memory", but the pragma runs without error
    expect(typeof result.journal_mode).toBe("string");
    db.close();
  });

  test("foreign_keys pragma enables FK enforcement", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    db.run("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    db.run("CREATE TABLE child (id INTEGER, parent_id INTEGER REFERENCES parent(id))");
    expect(() => db.run("INSERT INTO child VALUES (1, 999)")).toThrow();
    db.close();
  });

  test("integrity_check returns 'ok' on a healthy database", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (v TEXT)");
    db.run("INSERT INTO t VALUES ('hello')");
    const row = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
    expect(row.integrity_check).toBe("ok");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// db.serialize() / Database.deserialize()
// ---------------------------------------------------------------------------

describe("serialize / deserialize", () => {
  test("serialize returns a Uint8Array", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (v TEXT)");
    const bytes = db.serialize();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
    db.close();
  });

  test("deserialize reconstructs the database with its data", () => {
    const src = new Database(":memory:");
    src.run("CREATE TABLE items (name TEXT)");
    src.run("INSERT INTO items VALUES ('alpha')");
    src.run("INSERT INTO items VALUES ('beta')");
    const bytes = src.serialize();
    src.close();

    const dst = Database.deserialize(bytes);
    const rows = dst.query("SELECT name FROM items ORDER BY name").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["alpha", "beta"]);
    dst.close();
  });
});

// ---------------------------------------------------------------------------
// Error handling (SQLiteError via bun:sqlite)
// ---------------------------------------------------------------------------

describe("error handling", () => {
  test("syntax error throws", () => {
    const db = new Database(":memory:");
    expect(() => db.run("THIS IS NOT SQL")).toThrow();
    db.close();
  });

  test("UNIQUE constraint violation throws with SQLITE_CONSTRAINT code", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.run("INSERT INTO t VALUES (1)");
    let caught: Error | undefined;
    try {
      db.run("INSERT INTO t VALUES (1)"); // duplicate PK
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/UNIQUE|constraint/i);
    db.close();
  });

  test("NOT NULL constraint violation throws", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    expect(() => db.run("INSERT INTO t (id) VALUES (1)")).toThrow();
    db.close();
  });

  test("query on a closed database throws", () => {
    const db = new Database(":memory:");
    db.close();
    expect(() => db.query("SELECT 1").get()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bun.SQL unified API with SQLite adapter (new in Bun 1.2)
// ---------------------------------------------------------------------------

describe("Bun.SQL unified API — SQLite adapter", () => {
  test("in-memory SQLite via new SQL(':memory:')", async () => {
    const db = new SQL(":memory:");
    await db`CREATE TABLE greet (msg TEXT)`;
    await db`INSERT INTO greet VALUES (${"hello from Bun.SQL"})`;
    const rows = await db`SELECT msg FROM greet`;
    expect(rows[0]!.msg).toBe("hello from Bun.SQL");
    await db.close();
  });

  test("parameterised queries prevent SQL injection", async () => {
    const db = new SQL(":memory:");
    await db`CREATE TABLE items (name TEXT)`;
    const dangerous = "'; DROP TABLE items; --";
    await db`INSERT INTO items VALUES (${dangerous})`;
    const rows = await db`SELECT name FROM items`;
    expect(rows[0]!.name).toBe(dangerous);
    // Table must still exist
    const check = await db`SELECT name FROM items`;
    expect(check).toHaveLength(1);
    await db.close();
  });

  test("Bun.SQL transaction commits on success", async () => {
    const db = new SQL(":memory:");
    await db`CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)`;
    await db`INSERT INTO accounts VALUES (1, 100)`;
    await db`INSERT INTO accounts VALUES (2, 50)`;

    await db.begin(async (tx) => {
      await tx`UPDATE accounts SET balance = balance - 30 WHERE id = 1`;
      await tx`UPDATE accounts SET balance = balance + 30 WHERE id = 2`;
    });

    const rows = (await db`SELECT id, balance FROM accounts ORDER BY id`) as { id: number; balance: number }[];
    expect(rows[0]!.balance).toBe(70);
    expect(rows[1]!.balance).toBe(80);
    await db.close();
  });

  test("Bun.SQL transaction rolls back on error", async () => {
    const db = new SQL(":memory:");
    await db`CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)`;
    await db`INSERT INTO accounts VALUES (1, 100)`;

    await expect(
      db.begin(async (tx) => {
        await tx`UPDATE accounts SET balance = 0 WHERE id = 1`;
        throw new Error("rollback!");
      }),
    ).rejects.toThrow("rollback!");

    const rows = (await db`SELECT balance FROM accounts WHERE id = 1`) as { balance: number }[];
    expect(rows[0]!.balance).toBe(100); // unchanged
    await db.close();
  });

  test("Bun.SQL .values() returns arrays", async () => {
    const db = new SQL(":memory:");
    await db`CREATE TABLE t (a INTEGER, b TEXT)`;
    await db`INSERT INTO t VALUES (1, 'one')`;
    const rows = await db`SELECT a, b FROM t`.values();
    expect(rows[0]).toEqual([1, "one"]);
    await db.close();
  });
});
